"""Official provider adapters. Secrets are supplied by the environment."""
import base64
import hashlib
import hmac
import json
import os
import secrets
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


def whatsapp_welcome(phone_id, recipient):
    """A configured Meta-approved template starts the paid owner's conversation."""
    payload = {'messaging_product': 'whatsapp', 'to': recipient, 'type': 'template',
               'template': {'name': os.environ['WHATSAPP_WELCOME_TEMPLATE'],
                            'language': {'code': os.environ.get('WHATSAPP_WELCOME_LANGUAGE', 'en_US')}}}
    result = json.loads(request(f"https://graph.facebook.com/{os.environ['META_GRAPH_VERSION']}/{phone_id}/messages",
                               json.dumps(payload).encode(), {'Authorization': 'Bearer ' + os.environ['WHATSAPP_ACCESS_TOKEN'],
                                                             'Content-Type': 'application/json'}))
    return result['messages'][0]['id']


def sms_send(from_number, recipient, text):
    """Send an SMS through Twilio's official REST API and return its SID."""
    account = os.environ['TWILIO_ACCOUNT_SID']
    credentials = base64.b64encode((account + ':' + os.environ['TWILIO_AUTH_TOKEN']).encode()).decode()
    data = urllib.parse.urlencode({'From': from_number, 'To': recipient, 'Body': text}).encode()
    result = json.loads(request(
        f'https://api.twilio.com/2010-04-01/Accounts/{urllib.parse.quote(account, safe="")}/Messages.json',
        data, {'Authorization': 'Basic ' + credentials,
               'Content-Type': 'application/x-www-form-urlencoded'}, method='POST'))
    return result['sid']


def call_owner(recipient, action_id=None):
    account = os.environ['TWILIO_ACCOUNT_SID']
    public = os.environ['NOVA_PUBLIC_URL'].rstrip('/')
    if urllib.parse.urlsplit(public).scheme != 'https':
        raise ValueError('Calls require a public HTTPS callback')
    credentials = base64.b64encode((account + ':' + os.environ['TWILIO_AUTH_TOKEN']).encode()).decode()
    callback = public + '/webhooks/call'
    if action_id:
        callback += '?' + urllib.parse.urlencode({'owner_call': action_id})
    payload = {'From': os.environ['NOVA_CALL_FROM_NUMBER'], 'To': '+' + recipient,
               'Url': callback, 'Method': 'POST', 'TimeLimit': '900'}
    result = json.loads(request(f'https://api.twilio.com/2010-04-01/Accounts/{urllib.parse.quote(account, safe="")}/Calls.json',
                               urllib.parse.urlencode(payload).encode(), {'Authorization': 'Basic ' + credentials,
                               'Content-Type': 'application/x-www-form-urlencoded'}, method='POST'))
    return result['sid']


def whatsapp_media(media_id, *, mime_types, limit):
    """Retrieve validated metadata and bytes through Meta's authenticated media path."""
    if not isinstance(media_id, str) or not media_id.strip() or media_id in {'.', '..'}:
        raise ValueError('Invalid WhatsApp media ID')
    if type(limit) is not int or limit <= 0:
        raise ValueError('Invalid WhatsApp media limit')
    token = os.environ['WHATSAPP_ACCESS_TOKEN']
    version = os.environ['META_GRAPH_VERSION']
    metadata = json.loads(request(f'https://graph.facebook.com/{version}/{urllib.parse.quote(media_id, safe="")}',
                                  headers={'Authorization': 'Bearer ' + token}))
    if not isinstance(metadata, dict):
        raise ValueError('Invalid WhatsApp media metadata')
    size = metadata.get('file_size')
    if type(size) is not int or not 0 < size <= limit:
        raise ValueError('Invalid WhatsApp media size')
    mime = metadata.get('mime_type')
    if not isinstance(mime, str) or mime.split(';', 1)[0].strip().lower() not in mime_types:
        raise ValueError('Unsupported WhatsApp media MIME type')
    media_url = metadata.get('url')
    if not isinstance(media_url, str) or any(c.isspace() or ord(c) < 32 for c in media_url):
        raise ValueError('Invalid WhatsApp media URL')
    url = urllib.parse.urlsplit(media_url)
    if (url.scheme != 'https' or url.hostname not in {'lookaside.fbsbx.com', 'lookaside.facebook.com'}
            or url.username is not None or url.password is not None or url.port not in {None, 443}
            or url.fragment):
        raise ValueError('Unsupported WhatsApp media host')
    body = request(media_url, headers={'Authorization': 'Bearer ' + token}, limit=limit)
    if len(body) > limit or len(body) != size:
        raise ValueError('WhatsApp media size does not match metadata')
    return metadata, body


def whatsapp_document(media_id, filename):
    """Return (source name, UTF-8 text) for a .txt, .csv or .json export (max 2 MB)."""
    if not isinstance(filename, str) or any(ord(c) < 32 for c in filename):
        raise ValueError('Invalid WhatsApp document filename')
    source = filename.replace('\\', '/').rsplit('/', 1)[-1]
    extension = os.path.splitext(source)[1].lower()
    types = {'.txt': {'text/plain'}, '.csv': {'text/plain', 'text/csv', 'application/csv'},
             '.json': {'text/plain', 'application/json', 'text/json'}}
    if extension not in types:
        raise ValueError('Only .txt, .csv and .json exports are supported')
    _, body = whatsapp_media(media_id, mime_types=types[extension], limit=2_000_000)
    text = body.decode('utf-8-sig')
    if not text.strip() or '\x00' in text:
        raise ValueError('WhatsApp document must contain UTF-8 text')
    return source, text


def transcribe(media_id):
    formats = {'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'mp4',
               'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/wav': 'wav',
               'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/opus': 'opus'}
    metadata, audio = whatsapp_media(media_id, mime_types=formats, limit=15_000_000)
    mime = metadata['mime_type'].split(';', 1)[0].strip().lower()
    boundary = 'nova_audio_' + secrets.token_hex(16)
    model = os.environ['NOVA_TRANSCRIPTION_MODEL']
    data = (f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n{model}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.{formats[mime]}"\r\n'
            f'Content-Type: {mime}\r\n\r\n').encode() + audio + f'\r\n--{boundary}--\r\n'.encode()
    result = json.loads(request(os.environ['NOVA_AI_BASE_URL'].rstrip('/') + '/audio/transcriptions', data,
                               {'Authorization': 'Bearer ' + os.environ['NOVA_AI_KEY'],
                                'Content-Type': f'multipart/form-data; boundary={boundary}'}))
    return result['text']


def call_xml(message='', action='/webhooks/call'):
    say = f'<Say>{escape(message[:3500])}</Say>' if message else ''
    return (f'<?xml version="1.0" encoding="UTF-8"?><Response>{say}'
            f'<Gather input="speech" action="{escape(action)}" method="POST" speechTimeout="auto">'
            '<Say>How can I help?</Say></Gather><Say>Goodbye.</Say></Response>')
