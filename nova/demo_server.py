#!/usr/bin/env python3
"""Loopback-only, isolated live Nova review. Never invokes messaging or publishing tools."""
import json
import base64
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from store import Store, identifier
import workproducts
from engine import plan, work_once
import routines

ROOT = Path(__file__).resolve().parent
BUSINESS = 'live-demo'
PORT = 4192
ORIGIN = 'http://127.0.0.1:4192'
SESSION = secrets.token_urlsafe(32)
LOCK = threading.Lock()
DB = str(ROOT / 'data/live-demo.sqlite')


def initial(store):
    if not store.db.execute('SELECT 1 FROM businesses WHERE id=?', (BUSINESS,)).fetchone():
        store.add_business(BUSINESS, 'Nova demonstration', '15555550199', 'isolated-demo')
        store.db.execute('UPDATE businesses SET config=? WHERE id=?',
                         (json.dumps({'onboarding': {'stage': 'active'}, 'monthly_token_limit': 500000}), BUSINESS))
    workproducts.setup(store)
    store.db.execute('''CREATE TABLE IF NOT EXISTS demo_messages (
        id TEXT PRIMARY KEY, role TEXT, body TEXT, created REAL)''')


def message(store, role, body):
    store.db.execute('INSERT INTO demo_messages VALUES(?,?,?,?)', (identifier(), role, body, time.time()))


def state(store):
    return {'messages': [dict(r) for r in store.db.execute('SELECT role,body FROM demo_messages ORDER BY created LIMIT 200')],
            'documents': [dict(r) for r in store.db.execute('SELECT name,customer_safe FROM documents WHERE business=?', (BUSINESS,))],
            'drafts': [dict(r) for r in store.db.execute('SELECT id,kind,title,body,state,sources FROM workproducts WHERE business=? ORDER BY created DESC LIMIT 20', (BUSINESS,))],
            'usage': store.report(BUSINESS).get('costs', {}), 'busy': LOCK.locked(),
            'voice_configured': __import__('speech').configured(), 'channel': 'Local demo. No real messages, calls or publications.'}


def run_job(mode, text, audio=None):
    store = Store(DB)
    try:
        initial(store)
        business = store.business(BUSINESS)
        if audio is not None:
            from speech import transcribe_bytes
            text = transcribe_bytes(audio)
            message(store, 'lead' if mode == 'inbound' else 'you', 'Voice note: ' + text)
        if mode == 'inbound':
            shared = store.db.execute('SELECT 1 FROM documents WHERE business=? AND customer_safe=1', (BUSINESS,)).fetchone()
            if not shared:
                raise ValueError('Add current customer-approved business facts first. Private history is not shared with leads.')
            result = plan(store, business, text, customer='15555550123')
            import operations
            operations.execute(store, BUSINESS, {'id': identifier(), 'tool': 'save_lead', 'args': json.dumps({'contact': '15555550123', 'name': 'Test inbound lead', 'need': text[:3000]})})
            key = workproducts.save(store, BUSINESS, 'lead_reply', 'Response to test inbound lead', result['reply'],
                                    [r[0] for r in store.db.execute('SELECT name FROM documents WHERE business=? AND customer_safe=1', (BUSINESS,))])
            # Keep approval provenance separate from actual delivery and from the customer's factual history.
            store.db.execute('INSERT INTO events(id,business,kind,body,state,result,created,due) VALUES(?,?,?,?,?,?,?,?)',
                             (key, BUSINESS, 'customer', json.dumps({'from': '15555550123', 'text': text, 'channel': 'demo'}),
                              'done', json.dumps({'reply': result['reply'], 'simulation': True, 'delivery': 'local_demo_only'}), time.time(), time.time()))
            message(store, 'nova', result['reply'] + '\n\nReplied in this local simulation. No WhatsApp message was sent.')
        else:
            routine_reply = routines.handle(store, business, text, channel='local')
            if routine_reply is not None:
                message(store, 'nova', routine_reply)
                return
            clean = text.strip()
            prefix, _, rest = clean.partition(' ')
            kind = prefix.lower() if prefix.lower() in {'seo', 'bdr', 'learn'} else ('seo' if any(w in clean.lower() for w in ('article', 'seo', 'blog')) else 'bdr')
            result = workproducts.generate(store, business, kind, rest if prefix.lower() in {'seo', 'bdr', 'learn'} else clean)
            message(store, 'nova', result['title'] + '\n\n' + result['body'] + '\n\nSaved privately. Nothing sent or published.')
    except Exception as error:
        note = str(error) if isinstance(error, ValueError) else 'The local model did not complete this request. Try a shorter message. Nothing sent or published.'
        message(store, 'nova', note)
    finally:
        store.db.close()
        LOCK.release()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, status, data, html=False, cookie=False):
        raw = (data if html else json.dumps(data)).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8' if html else 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        if cookie:
            self.send_header('Set-Cookie', 'nova_demo=' + SESSION + '; HttpOnly; SameSite=Strict; Path=/')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def route(self):
        if self.headers.get('Host') != '127.0.0.1:4192':
            return self.respond(403, {'error': 'Local demo only'})
        if self.path == '/' and self.command == 'GET':
            return self.respond(200, (ROOT / 'demo.html').read_text(), html=True, cookie=True)
        cookies = dict(item.strip().split('=', 1) for item in self.headers.get('Cookie', '').split(';') if '=' in item)
        if not secrets.compare_digest(cookies.get('nova_demo', ''), SESSION):
            return self.respond(401, {'error': 'Open the local demo first'})
        if self.command == 'POST' and self.headers.get('Origin') != ORIGIN:
            return self.respond(403, {'error': 'Same-origin request required'})
        store = Store(DB)
        try:
            initial(store)
            if self.path == '/api/state' and self.command == 'GET':
                return self.respond(200, state(store))
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 8000000:
                return self.respond(413, {'error': 'Request must be at most 8 MB'})
            data = json.loads(self.rfile.read(length))
            if LOCK.locked():
                return self.respond(409, {'error': 'Nova is finishing the current task'})
            if self.path == '/api/import' and self.command == 'POST':
                name, text = data.get('name'), data.get('text')
                if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120 or not isinstance(text, str) or not 1 <= len(text.strip()) <= 100000 or type(data.get('shared')) is not bool:
                    raise ValueError('Add a short file name and 1–100,000 characters of business information.')
                business_name = data.get('business_name', '').strip()
                if len(business_name) > 100:
                    raise ValueError('Business name is too long')
                if business_name:
                    store.db.execute('UPDATE businesses SET name=? WHERE id=?', (business_name, BUSINESS))
                store.ingest(BUSINESS, name.strip(), text, data['shared'])
                message(store, 'nova', 'Saved ' + name.strip() + (' as approved customer information.' if data['shared'] else ' privately. Other customers cannot see these conversations.'))
                return self.respond(200, {'saved': True})
            if self.path in {'/api/chat', '/api/voice'} and self.command == 'POST':
                text, mode = data.get('text'), data.get('mode')
                audio = None
                if self.path == '/api/voice':
                    audio = base64.b64decode(data.get('audio', ''), validate=True)
                    if not 1 <= len(audio) <= 5000000:
                        raise ValueError('Use a voice recording under 5 MB.')
                    text = '[Voice note is being transcribed on your Mac]'
                if not isinstance(text, str) or not 1 <= len(text.strip()) <= 6000 or mode not in {'owner', 'inbound'}:
                    raise ValueError('Send an owner instruction or a test inbound lead, at most 6,000 characters.')
                if not LOCK.acquire(blocking=False):
                    return self.respond(409, {'error': 'Nova is finishing the current task'})
                message(store, 'lead' if mode == 'inbound' else 'you', text.strip())
                threading.Thread(target=run_job, args=(mode, text.strip(), audio), daemon=True).start()
                return self.respond(202, {'queued': True})
            return self.respond(404, {'error': 'Unknown endpoint'})
        except (ValueError, TypeError, KeyError):
            return self.respond(400, {'error': 'Check your input and try again.'})
        finally:
            store.db.close()

    def do_GET(self):
        self.route()

    def do_POST(self):
        self.route()


def background():
    while True:
        if LOCK.acquire(blocking=False):
            store = Store(DB)
            try:
                initial(store)
                routines.tick(store, channel='local')
                pending = store.db.execute("SELECT id FROM events WHERE state='pending' AND due<=? ORDER BY due,created LIMIT 1", (time.time(),)).fetchone()
                if pending:
                    work_once(store)
                    result = store.db.execute('SELECT state,result FROM events WHERE id=?', (pending['id'],)).fetchone()
                    reply = json.loads(result['result'] or '{}').get('reply', 'Task result saved.')
                    message(store, 'nova', 'Background work ' + result['state'] + '\n\n' + reply)
            except Exception:
                message(store, 'nova', 'A background task needs attention. No external message or publication was made.')
            finally:
                store.db.close()
                LOCK.release()
        time.sleep(2)


def main():
    os.environ.setdefault('NOVA_AI_PROVIDER', 'ollama')
    os.environ.setdefault('NOVA_AI_MODEL', 'llama3.2:3b')
    if configuration_provider() != 'ollama':
        raise ValueError('The demo only uses a local model. No paid fallback.')
    threading.Thread(target=background, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    server.serve_forever()


def configuration_provider():
    from providers import configuration
    return configuration()['provider']


if __name__ == '__main__':
    main()
