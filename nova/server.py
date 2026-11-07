"""Signed WhatsApp/Twilio webhooks and authenticated local development API."""
import hmac
import json
import os
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.sax.saxutils import escape

from channels import call_xml, twilio_signature, whatsapp_signature
from store import Store


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *_):
        pass  # HTTP URLs can contain verification tokens. Keep payloads out of access logs.

    def respond(self, status, body, mime='application/json'):
        raw = (json.dumps(body) if mime == 'application/json' else body).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        store = Store(os.environ.get('NOVA_DB', 'data/nova.sqlite'))
        try:
            self.route(store)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            self.respond(400, {'error': 'Invalid request or incomplete server configuration'})
        except Exception:
            self.respond(503, {'error': 'Service unavailable'})
        finally:
            store.db.close()

    def route(self, store):
        url = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(url.query)
        if self.command == 'GET' and url.path in {'/', '/signup', '/signup/complete', '/signup/cancel'}:
            from signup import page
            return self.respond(200, page(url.path), 'text/html; charset=utf-8')
        if self.command == 'GET' and url.path == '/health':
            return self.respond(200, {'product': 'Nova by Evolution', 'version': 4, 'status': 'running',
                'ai_configured': all(os.environ.get(key) for key in ['NOVA_AI_BASE_URL', 'NOVA_AI_KEY', 'NOVA_AI_MODEL']),
                'whatsapp_configured': all(os.environ.get(key) for key in ['META_APP_SECRET', 'META_GRAPH_VERSION', 'WHATSAPP_ACCESS_TOKEN'])})
        if self.command == 'GET' and url.path == '/connections/google/callback':
            from connections import setup, callback
            setup(store)
            result = callback(store, query.get('state', [''])[0], query.get('code', [None])[0])
            store.enqueue(result['business_id'], 'delivery', {'text': 'Your Google Calendar is connected. Creating events still follows your approval rules.'})
            return self.respond(200, '<!doctype html><html><head><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>Nova connected</title></head><body><h1>Calendar connected</h1><p>Return to your Nova conversation to continue.</p></body></html>', 'text/html; charset=utf-8')
        if self.command == 'GET' and url.path == '/webhooks/whatsapp':
            token = os.environ.get('WHATSAPP_VERIFY_TOKEN', '')
            if token and query.get('hub.mode') == ['subscribe'] and hmac.compare_digest(query.get('hub.verify_token', [''])[0], token):
                return self.respond(200, query['hub.challenge'][0], 'text/plain')
            return self.respond(403, {'error': 'Verification failed'})
        if self.command not in {'GET', 'POST'}:
            return self.respond(405, {'error': 'Method not allowed'})
        length = int(self.headers.get('Content-Length', '0'))
        if length < 0 or length > 1_000_000:
            return self.respond(413, {'error': 'Request too large'})
        raw = self.rfile.read(length)
        if url.path == '/signup/checkout' and self.command == 'POST':
            origin = self.headers.get('Origin', '')
            expected = os.environ.get('NOVA_PUBLIC_URL', '').rstrip('/')
            if not expected or origin != expected:
                return self.respond(403, {'error': 'Open the signup page to begin checkout'})
            from billing import setup, create_checkout
            setup(store)
            payload = json.loads(raw)
            phone = payload.get('phone')
            if isinstance(phone, str):
                phone = phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '').removeprefix('+')
            result = create_checkout(store, phone, payload.get('consent'))
            return self.respond(200, {'url': result})
        if url.path == '/webhooks/stripe' and self.command == 'POST':
            from billing import setup, webhook
            setup(store)
            result = webhook(store, raw, self.headers.get('Stripe-Signature', ''))
            return self.respond(200, {'status': result})
        if url.path == '/webhooks/whatsapp' and self.command == 'POST':
            if not whatsapp_signature(raw, self.headers.get('X-Hub-Signature-256'), os.environ.get('META_APP_SECRET', '')):
                return self.respond(403, {'error': 'Invalid signature'})
            payload = json.loads(raw)
            if payload.get('object') != 'whatsapp_business_account':
                return self.respond(400, {'error': 'Unsupported event'})
            for entry in payload.get('entry', []):
                for change in entry.get('changes', []):
                    value = change.get('value', {})
                    phone_id = value.get('metadata', {}).get('phone_number_id')
                    for message in value.get('messages', []):
                        sender = message.get('from')
                        if not isinstance(sender, str) or not sender.isdecimal():
                            continue
                        # The Nova contact serves many owners; customer-facing numbers remain business-specific.
                        row = store.db.execute("SELECT id,owner FROM businesses WHERE owner=? AND json_extract(config,'$.operator_phone_id')=?", (sender, phone_id)).fetchone()
                        if not row:
                            row = store.db.execute('SELECT id,owner FROM businesses WHERE phone_id=?', (phone_id,)).fetchone()
                        if not row:
                            continue
                        owner = sender == row['owner']
                        text = message.get('text', {}).get('body', '')
                        audio = message.get('audio', {}).get('id')
                        document = message.get('document') if owner else None
                        if not text and not audio and not document:
                            continue
                        if not isinstance(text, str) or len(text) > 16000:
                            continue
                        occurred = float(message['timestamp'])
                        if occurred > time.time() + 60:
                            continue
                        store.enqueue(row['id'], 'import' if document else 'owner' if owner else 'customer',
                                      {'text': text, 'audio': audio, 'document': document, 'from': sender, 'channel': 'whatsapp'},
                                      'wa:' + row['id'] + ':' + message['id'], occurred=occurred)
                        if owner:
                            store.db.execute("UPDATE events SET state='pending' WHERE business=? AND kind='delivery' AND state='awaiting_owner'", (row['id'],))
            return self.respond(200, {'accepted': True})
        if url.path == '/webhooks/sms' and self.command == 'POST':
            fields = {key: values[0] for key, values in urllib.parse.parse_qs(raw.decode(), keep_blank_values=True).items()}
            public = os.environ['NOVA_PUBLIC_URL'].rstrip('/') + self.path
            if not twilio_signature(public, fields, self.headers.get('X-Twilio-Signature'), os.environ.get('TWILIO_AUTH_TOKEN', '')):
                return self.respond(403, {'error': 'Invalid signature'})
            row = store.db.execute("SELECT id FROM businesses WHERE json_extract(config,'$.sms_number')=?", (fields.get('To'),)).fetchone()
            if not row:
                return self.respond(404, {'error': 'Business number is not configured'})
            sender = fields.get('From', '').lstrip('+')
            if not sender.isdecimal() or not fields.get('MessageSid') or not fields.get('Body') or len(fields['Body']) > 16000:
                raise ValueError('Invalid SMS')
            store.enqueue(row['id'], 'customer', {'from': sender, 'text': fields['Body'], 'channel': 'sms'}, 'sms:' + row['id'] + ':' + fields['MessageSid'])
            return self.respond(200, '<Response/>', 'application/xml')
        if url.path == '/webhooks/call' and self.command == 'POST':
            fields = {key: values[0] for key, values in urllib.parse.parse_qs(raw.decode()).items()}
            public = os.environ['NOVA_PUBLIC_URL'].rstrip('/') + self.path
            if not twilio_signature(public, fields, self.headers.get('X-Twilio-Signature'), os.environ.get('TWILIO_AUTH_TOKEN', '')):
                return self.respond(403, {'error': 'Invalid signature'})
            owner = fields.get('From', '').lstrip('+')
            candidates = store.db.execute("SELECT id FROM businesses WHERE owner=? AND json_extract(config,'$.subscription_active')=1", (owner,)).fetchall()
            if len(candidates) == 1:
                business = store.business(candidates[0]['id'])
            else:
                business = store.business(os.environ['NOVA_CALL_BUSINESS'])
            if fields.get('From', '').lstrip('+') != business['owner']:
                return self.respond(403, '<Response><Reject/></Response>', 'application/xml')
            if query.get('event'):
                event = store.db.execute('SELECT * FROM events WHERE id=? AND business=?', (query['event'][0], business['id'])).fetchone()
                if not event:
                    return self.respond(404, '<Response><Hangup/></Response>', 'application/xml')
                if event['state'] == 'done':
                    result = json.loads(event['result'])
                    reply = result['reply']
                    if result.get('actions'):
                        reply += ' Proposed actions are available in your message history for approval.'
                        details = [result['reply']]
                        for action_id in result['actions']:
                            action = store.db.execute('SELECT tool,args,state FROM actions WHERE business=? AND id=?',
                                                       (business['id'], action_id)).fetchone()
                            details.append(action_id + ' [' + action['state'] + '] ' + action['tool'] + '\n' + action['args'])
                        details.append('Reply APPROVE <id> or REJECT <id>.')
                        full = '\n'.join(details)
                        for offset in range(0, len(full), 3800):
                            store.enqueue(business['id'], 'delivery', {'text': full[offset:offset + 3800]},
                                          'call-result:' + event['id'] + ':' + str(offset))
                    return self.respond(200, call_xml(reply, action='/webhooks/call?turn=' + event['id']), 'application/xml')
                if event['state'] == 'failed' or time.time() - event['created'] > 90:
                    return self.respond(200, call_xml('I could not finish that request. Please message me on WhatsApp.'), 'application/xml')
                redirect = escape('/webhooks/call?event=' + event['id'])
                return self.respond(200, f'<Response><Pause length="2"/><Redirect method="POST">{redirect}</Redirect></Response>', 'application/xml')
            if fields.get('SpeechResult'):
                key = 'call:' + fields['CallSid'] + ':' + query.get('turn', ['first'])[0] + ':' + str(fields.get('SpeechResult'))
                import hashlib
                event = store.enqueue(business['id'], 'call', {'text': fields['SpeechResult'][:8000], 'channel': 'call'},
                                      hashlib.sha256(key.encode()).hexdigest())
                return self.respond(200, f'<Response><Say>Let me work on that.</Say><Pause length="2"/>'
                                    f'<Redirect method="POST">/webhooks/call?event={event}</Redirect></Response>', 'application/xml')
            return self.respond(200, call_xml('Hi, this is Nova, your AI operator.'), 'application/xml')
        token = os.environ.get('NOVA_ADMIN_TOKEN', '')
        if not token or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
            return self.respond(401, {'error': 'Authentication required'})
        if self.command == 'POST' and url.path == '/local/message':
            payload = json.loads(raw)
            store.business(payload['business'])
            if not isinstance(payload['text'], str) or not 1 <= len(payload['text']) <= 16000:
                raise ValueError('Invalid message')
            event = store.enqueue(payload['business'], 'owner', {'text': payload['text'], 'channel': 'local'})
            return self.respond(202, {'event': event})
        if self.command == 'GET' and url.path == '/local/state':
            business = query['business'][0]
            store.business(business)
            events = [dict(row) for row in store.db.execute('SELECT id,kind,state,result FROM events WHERE business=? ORDER BY created DESC LIMIT 30', (business,))]
            actions = [dict(row) for row in store.db.execute('SELECT * FROM actions WHERE business=? ORDER BY created DESC LIMIT 30', (business,))]
            return self.respond(200, {'events': events, 'actions': actions, 'report': store.report(business)})
        return self.respond(404, {'error': 'Unknown endpoint'})


def serve(host, port):
    ThreadingHTTPServer((host, port), Handler).serve_forever()
