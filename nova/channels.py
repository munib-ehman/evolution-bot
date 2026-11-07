"""Official provider adapters. Secrets are supplied by the environment."""
import base64
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from xml.sax.saxutils import escape


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, data=None, headers=None, method=None, limit=2_000_000):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=45) as response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ValueError('Provider response exceeded limit')
        return body


def whatsapp_signature(raw, signature, secret):
    expected = 'sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return bool(secret) and hmac.compare_digest(expected, signature or '')


def twilio_signature(url, fields, signature, secret):
    message = url + ''.join(key + fields[key] for key in sorted(fields))
    expected = base64.b64encode(hmac.new(secret.encode(), message.encode(), hashlib.sha1).digest()).decode()
    return bool(secret) and hmac.compare_digest(expected, signature or '')


def whatsapp_send(phone_id, recipient, text, report_template=False):
    version = os.environ['META_GRAPH_VERSION']
    payload = {'messaging_product': 'whatsapp', 'to': recipient, 'type': 'text', 'text': {'body': text}}
    if report_template:
        payload = {'messaging_product': 'whatsapp', 'to': recipient, 'type': 'template', 'template': {
            'name': os.environ['WHATSAPP_REPORT_TEMPLATE'],
            'language': {'code': os.environ.get('WHATSAPP_REPORT_LANGUAGE', 'en_US')},
            'components': [{'type': 'body', 'parameters': [{'type': 'text', 'text': text}]}]}}
    data = json.dumps(payload).encode()
    result = json.loads(request(f'https://graph.facebook.com/{version}/{phone_id}/messages', data,
                               {'Authorization': 'Bearer ' + os.environ['WHATSAPP_ACCESS_TOKEN'],
                                'Content-Type': 'application/json'}))
    return result['messages'][0]['id']


def transcribe(media_id):
    token = os.environ['WHATSAPP_ACCESS_TOKEN']
    version = os.environ['META_GRAPH_VERSION']
    metadata = json.loads(request(f'https://graph.facebook.com/{version}/{urllib.parse.quote(media_id, safe="")}',
                                  headers={'Authorization': 'Bearer ' + token}))
    url = urllib.parse.urlparse(metadata['url'])
    if url.scheme != 'https' or url.hostname not in {'lookaside.fbsbx.com', 'lookaside.facebook.com'}:
        raise ValueError('Unsupported WhatsApp media host')
    audio = request(metadata['url'], headers={'Authorization': 'Bearer ' + token}, limit=15_000_000)
    boundary = 'nova_audio_boundary'
    model = os.environ['NOVA_TRANSCRIPTION_MODEL']
    data = (f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n{model}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\n'
            'Content-Type: audio/ogg\r\n\r\n').encode() + audio + f'\r\n--{boundary}--\r\n'.encode()
    result = json.loads(request(os.environ['NOVA_AI_BASE_URL'].rstrip('/') + '/audio/transcriptions', data,
                               {'Authorization': 'Bearer ' + os.environ['NOVA_AI_KEY'],
                                'Content-Type': f'multipart/form-data; boundary={boundary}'}))
    return result['text']


def call_xml(message='', action='/webhooks/call'):
    say = f'<Say>{escape(message[:3500])}</Say>' if message else ''
    return (f'<?xml version="1.0" encoding="UTF-8"?><Response>{say}'
            f'<Gather input="speech" action="{escape(action)}" method="POST" speechTimeout="auto">'
            '<Say>How can I help?</Say></Gather><Say>Goodbye.</Say></Response>')
