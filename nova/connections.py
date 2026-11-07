"""Google Calendar helpers for Nova's authenticated owner conversation.

Call setup once per Store. Only call connection_link after an authenticated owner
explicitly requests a Google connection link; generating that link requires no
separate action approval. The link is a short-lived bearer capability: deliver it
privately to that owner, never to customers. Google's consent confirms account
access ONLY, not permission to create events. calendar_event must go through the
caller's normal owner action/approval gate. These helpers do not authenticate a
chat sender, send messages, or register an HTTP route.

Route GET /connections/google/callback to callback(store, state, code); pass None
for code on denial so the state is still consumed. Do not log callback queries.
Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NOVA_TOKEN_ENCRYPTION_KEY (a
Fernet key), and NOVA_PUBLIC_URL. Register the exact callback URI with Google.
Only the primary calendar and calendar.events scope are supported. Keep the
encryption key stable across restarts; key rotation/revocation is administrator
work. This module follows Store's one-worker-per-database contract.
"""

import hashlib
import json
import math
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet

try:  # Support both Nova's script imports and namespace-package imports.
    from . import channels
except ImportError:
    import channels


REQUIRED_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
STATE_TTL = 600


def setup(store):
    """Create only this adapter's tables; no environment or network required."""
    # Do not use executescript: it would commit a caller's pending transaction.
    store.db.execute('''CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY,
        business TEXT NOT NULL REFERENCES businesses(id),
        owner TEXT NOT NULL, expires REAL NOT NULL,
        redirect_uri TEXT NOT NULL, client_id TEXT NOT NULL
    )''')
    store.db.execute('''CREATE TABLE IF NOT EXISTS connections (
        business TEXT NOT NULL REFERENCES businesses(id),
        provider TEXT NOT NULL, tokens BLOB NOT NULL, updated REAL NOT NULL,
        PRIMARY KEY (business, provider)
    )''')


def _cipher():
    try:
        return Fernet(os.environ['NOVA_TOKEN_ENCRYPTION_KEY'].encode('ascii'))
    except Exception:
        raise ValueError('Google connection encryption is not configured correctly.') from None


def _client():
    client_id = os.environ.get('GOOGLE_CLIENT_ID', '')
    secret = os.environ.get('GOOGLE_CLIENT_SECRET', '')
    if not client_id.strip() or not secret.strip():
        raise ValueError('Google connection credentials are not configured.')
    return client_id, secret


def _redirect_uri():
    public = os.environ.get('NOVA_PUBLIC_URL', '').rstrip('/')
    try:
        url = urllib.parse.urlsplit(public)
        valid = (url.scheme == 'https' and url.hostname and not url.username
                 and not url.password and not url.query and not url.fragment
                 and url.port in {None, 443})
    except ValueError:
        valid = False
    if not valid or any(c.isspace() or ord(c) < 32 for c in public):
        raise ValueError('Configure a public HTTPS Nova URL for Google connections.')
    return public + '/connections/google/callback'


def _load(store, business_id):
    business = store.business(business_id)
    row = store.db.execute(
        "SELECT tokens FROM connections WHERE business=? AND provider='google'",
        (business_id,)).fetchone()
    if row is None:
        return None
    cipher = _cipher()
    try:
        payload = json.loads(cipher.decrypt(row['tokens']))
        # Authenticated encryption alone does not prevent cross-tenant row swaps.
        if (payload['business'] != business_id or payload['provider'] != 'google'
                or payload['owner'] != business['owner']
                or payload['client_id'] != _client()[0]):
            raise ValueError()
        tokens = payload['tokens']
        if (not isinstance(tokens, dict) or REQUIRED_SCOPE not in tokens['scope'].split()
                or not _token_string(tokens['access_token'])
                or not math.isfinite(tokens['expires_at'])
                or ('refresh_token' in tokens and not _token_string(tokens['refresh_token']))):
            raise ValueError()
        return tokens
    except Exception:
        raise ValueError('Google connection cannot be read securely. Ask the administrator to repair it.') from None


def _save(store, business_id, owner, client_id, tokens):
    # Recheck after external calls in case the owner/configuration changed.
    if store.business(business_id)['owner'] != owner or _client()[0] != client_id:
        raise ValueError('Google connection owner or configuration changed. Request a new link.')
    payload = {'business': business_id, 'provider': 'google', 'owner': owner,
               'client_id': client_id, 'tokens': tokens}
    encrypted = _cipher().encrypt(json.dumps(payload).encode())
    store.db.execute('''INSERT INTO connections(business,provider,tokens,updated)
        VALUES(?,'google',?,?) ON CONFLICT(business,provider)
        DO UPDATE SET tokens=excluded.tokens, updated=excluded.updated''',
                     (business_id, encrypted, time.time()))


def connection_link(store, business_id):
    """Return {url, status, expires_in} or {status: connected}; owner-only request.

    Status describes locally stored credentials, not a live Google health check.
    This function never exchanges tokens or performs a network request.
    """
    business = store.business(business_id)
    client_id, _ = _client()
    _cipher()
    tokens = _load(store, business_id)
    if tokens and (tokens.get('refresh_token') or tokens['expires_at'] > time.time() + 60):
        return {'status': 'connected'}
    redirect_uri = _redirect_uri()
    state = secrets.token_urlsafe(32)
    now = time.time()
    store.db.execute('DELETE FROM oauth_states WHERE expires<=?', (now,))
    store.db.execute('''INSERT INTO oauth_states
        (state_hash,business,owner,expires,redirect_uri,client_id) VALUES(?,?,?,?,?,?)''',
                     (hashlib.sha256(state.encode()).hexdigest(), business_id,
                      business['owner'], now + STATE_TTL, redirect_uri, client_id))
    params = {'client_id': client_id, 'redirect_uri': redirect_uri,
              'response_type': 'code', 'scope': REQUIRED_SCOPE, 'state': state,
              'access_type': 'offline', 'prompt': 'consent'}
    return {'status': 'not_connected', 'url': AUTH_URL + '?' + urllib.parse.urlencode(params),
            'expires_in': STATE_TTL}


def _consume_state(store, state):
    if not isinstance(state, str) or not 20 <= len(state) <= 200:
        raise ValueError('Google connection link is invalid or expired. Request a new link.')
    if store.db.in_transaction:
        raise ValueError('Google callback requires its own database transaction.')
    digest = hashlib.sha256(state.encode()).hexdigest()
    store.db.execute('BEGIN IMMEDIATE')
    try:
        row = store.db.execute('SELECT * FROM oauth_states WHERE state_hash=?', (digest,)).fetchone()
        store.db.execute('DELETE FROM oauth_states WHERE state_hash=?', (digest,))
        store.db.execute('COMMIT')
    except Exception:
        store.db.execute('ROLLBACK')
        raise ValueError('Google connection link could not be consumed. Request a new link.') from None
    # Commit consumption BEFORE validation, denial handling, or token exchange.
    if row is None or row['expires'] <= time.time():
        raise ValueError('Google connection link is invalid or expired. Request a new link.')
    return row


class _Conflict(Exception):
    pass


def _google_json(url, data=None, headers=None, method=None, conflict=False):
    try:
        result = json.loads(channels.request(url, data, headers, method=method))
        if not isinstance(result, dict) or 'error' in result:
            raise ValueError()
        return result
    except urllib.error.HTTPError as error:
        if conflict and error.code == 409:
            raise _Conflict() from None
        raise ValueError('Google request failed. Reconnect or try again later.') from None
    except Exception:
        raise ValueError('Google request failed. Reconnect or try again later.') from None


def _token_string(value):
    return isinstance(value, str) and bool(value) and all(32 < ord(c) < 127 for c in value)


def _tokens(response, previous=None, refreshing=False):
    previous = previous or {}
    try:
        scope = response.get('scope', previous.get('scope') if refreshing else None)
        if not isinstance(scope, str) or REQUIRED_SCOPE not in scope.split():
            raise ValueError()
        expiry = response['expires_in']
        if isinstance(expiry, bool) or not isinstance(expiry, (int, float)) or not math.isfinite(expiry) or expiry <= 0:
            raise ValueError()
        if response.get('token_type', '').lower() != 'bearer' or not _token_string(response['access_token']):
            raise ValueError()
        tokens = {'access_token': response['access_token'], 'expires_at': time.time() + expiry,
                  'scope': scope}
        refresh = response.get('refresh_token', previous.get('refresh_token'))
        if refresh is not None:
            if not _token_string(refresh):
                raise ValueError()
            tokens['refresh_token'] = refresh
        return tokens
    except Exception:
        raise ValueError('Google did not grant valid Calendar access. Request a new connection link.') from None


def callback(store, state, code):
    """Consume a one-use state, exchange code, and persist encrypted credentials.

    Tenant and owner come ONLY from stored state, never callback query fields.
    Any failure burns the link, including a declined consent or network timeout.
    Missing scope is rejected on code exchange; refresh may inherit prior scope.
    """
    row = _consume_state(store, state)
    business_id = row['business']
    business = store.business(business_id)
    client_id, secret = _client()
    if row['owner'] != business['owner'] or row['client_id'] != client_id:
        raise ValueError('Google connection owner or configuration changed. Request a new link.')
    if not isinstance(code, str) or not code.strip() or len(code) > 8192:
        raise ValueError('Google connection was not authorized. Request a new link.')
    _cipher()
    previous = _load(store, business_id)
    response = _google_json(TOKEN_URL, urllib.parse.urlencode({
        'client_id': client_id, 'client_secret': secret, 'code': code,
        'grant_type': 'authorization_code', 'redirect_uri': row['redirect_uri']}).encode(),
        {'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
    tokens = _tokens(response, previous)
    _save(store, business_id, row['owner'], client_id, tokens)
    return {'status': 'connected', 'business_id': business_id, 'provider': 'google'}


def _access_token(store, business_id):
    tokens = _load(store, business_id)
    if not tokens:
        raise ValueError('Connect Google Calendar with an owner connection link first.')
    if tokens['expires_at'] > time.time() + 60:
        return tokens['access_token']
    if not tokens.get('refresh_token'):
        raise ValueError('Google Calendar access expired. Request a new connection link.')
    client_id, secret = _client()
    owner = store.business(business_id)['owner']
    response = _google_json(TOKEN_URL, urllib.parse.urlencode({
        'client_id': client_id, 'client_secret': secret,
        'grant_type': 'refresh_token', 'refresh_token': tokens['refresh_token']}).encode(),
        {'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
    tokens = _tokens(response, tokens, refreshing=True)
    _save(store, business_id, owner, client_id, tokens)
    return tokens['access_token']


def _event_body(business_id, action_id, args):
    try:
        if (not isinstance(action_id, str) or not 1 <= len(action_id) <= 1024
                or not action_id.strip() or not isinstance(args, dict)
                or not {'summary', 'start', 'end'} <= set(args)
                or set(args) - {'summary', 'start', 'end', 'timezone'}):
            raise ValueError()
        if not isinstance(args['summary'], str) or not 1 <= len(args['summary'].strip()) <= 1000:
            raise ValueError()
        dates = []
        zone = ZoneInfo(args['timezone']) if 'timezone' in args else None
        for key in ('start', 'end'):
            value = args[key]
            if not isinstance(value, str) or not re.fullmatch(
                    r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})', value):
                raise ValueError()
            date = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if zone and date.astimezone(zone).utcoffset() != date.utcoffset():
                raise ValueError()
            dates.append(date)
        if dates[1] <= dates[0]:
            raise ValueError()
    except Exception:
        raise ValueError('Calendar event needs summary, start and later end in ISO 8601 with explicit offsets; timezone, if supplied, must match an IANA zone.') from None
    # Hex is a subset of Google's base32hex event-ID alphabet; namespace by tenant.
    event_id = hashlib.sha256(json.dumps([business_id, action_id]).encode()).hexdigest()
    body = {'id': event_id, 'summary': args['summary'],
            'start': {'dateTime': args['start']}, 'end': {'dateTime': args['end']}}
    if zone:
        body['start']['timeZone'] = body['end']['timeZone'] = args['timezone']
    fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    body['extendedProperties'] = {'private': {'novaPayload': fingerprint}}
    return body


def calendar_event(store, business_id, action_id, args):
    """Create an approved primary-calendar event with a tenant/action stable ID.

    args: summary, start, end (RFC3339 strings with explicit UTC offsets or Z),
    optional timezone (IANA name matching those offsets). No guest invitations.
    Repeated identical calls reconcile HTTP 409 by reading and verifying the
    existing event. A changed payload with the same action ID fails closed.
    A timeout is ambiguous: retry only with the SAME action ID and arguments.
    """
    store.business(business_id)
    body = _event_body(business_id, action_id, args)
    headers = {'Authorization': 'Bearer ' + _access_token(store, business_id),
               'Content-Type': 'application/json'}
    status = 'created'
    try:
        result = _google_json(EVENTS_URL, json.dumps(body).encode(), headers,
                              method='POST', conflict=True)
    except _Conflict:
        result = _google_json(EVENTS_URL + '/' + body['id'], headers=headers, method='GET')
        status = 'exists'
        # Do not claim a conflicting or subsequently modified event as success.
        if any(result.get(key) != body[key] for key in ('summary', 'extendedProperties')):
            raise ValueError('Calendar event ID already exists with different details.')
        try:
            for key in ('start', 'end'):
                actual = datetime.fromisoformat(result[key]['dateTime'].replace('Z', '+00:00'))
                expected = datetime.fromisoformat(body[key]['dateTime'].replace('Z', '+00:00'))
                if actual.tzinfo is None or actual != expected:
                    raise ValueError()
            if result.get('status') == 'cancelled':
                raise ValueError()
        except Exception:
            raise ValueError('Calendar event ID already exists with different details.') from None
    if result.get('id') != body['id']:
        raise ValueError('Google did not confirm the expected Calendar event.')
    return {'status': status, 'event_id': body['id'], 'provider': 'google'}
