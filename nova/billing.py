"""Stripe billing boundary. Call setup once; wire webhook to the untouched HTTP body.

Only a verified paid Checkout can create a business. Browser returns grant no access.
All provider I/O uses channels.request; callers should retry failed webhook handling.
Shared WhatsApp inbound owner routing must be implemented by the parent integration.
"""
import hashlib
import hmac
import json
import os
import secrets
import time
from urllib.parse import quote, urlencode, urlsplit

import channels


EVENTS = frozenset({'checkout.session.completed', 'checkout.session.async_payment_succeeded',
                    'invoice.paid', 'invoice.payment_failed', 'customer.subscription.created',
                    'customer.subscription.updated', 'customer.subscription.deleted'})


def setup(store):
    store.db.executescript('''
      CREATE TABLE IF NOT EXISTS signups (
        id TEXT PRIMARY KEY, phone TEXT NOT NULL, consent_at REAL NOT NULL,
        price_id TEXT NOT NULL, session_id TEXT UNIQUE, business TEXT UNIQUE REFERENCES businesses(id)
      );
      CREATE TABLE IF NOT EXISTS payment_events (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, created INTEGER NOT NULL, processed REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkout_locks (
        phone TEXT PRIMARY KEY, token TEXT NOT NULL, expires REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY, signup TEXT UNIQUE NOT NULL REFERENCES signups(id),
        business TEXT UNIQUE NOT NULL REFERENCES businesses(id), status TEXT NOT NULL,
        price_id TEXT NOT NULL, period_start INTEGER NOT NULL, period_end INTEGER NOT NULL,
        updated REAL NOT NULL
      );
    ''')


def _api(path, fields=None, key=None):
    headers = {'Authorization': 'Bearer ' + os.environ['NOVA_STRIPE_SECRET_KEY'],
               'Stripe-Version': '2024-06-20'}
    data = None
    if fields is not None:
        data = urlencode(fields).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    if key:
        headers['Idempotency-Key'] = key
    return json.loads(channels.request('https://api.stripe.com/v1/' + path,
                                      data=data, headers=headers,
                                      method='POST' if fields is not None else 'GET'))


def _id(value):
    if isinstance(value, dict):
        value = value.get('id')
    if not isinstance(value, str) or not value or len(value) > 255:
        raise ValueError('Missing Stripe identifier')
    return value


def _price(price, expected):
    recurring = price.get('recurring') or {}
    if (price.get('id') != expected or price.get('currency') != 'usd'
            or type(price.get('unit_amount')) is not int or price['unit_amount'] != 20000
            or price.get('billing_scheme') != 'per_unit' or recurring.get('interval') != 'month'
            or recurring.get('interval_count') != 1 or recurring.get('usage_type') != 'licensed'):
        raise ValueError('Nova requires a fixed USD 200 monthly price')


def _checkout_url(url):
    if not isinstance(url, str):
        raise ValueError('Invalid Stripe Checkout URL')
    parsed = urlsplit(url)
    if (any(c.isspace() or ord(c) < 32 for c in url) or parsed.scheme != 'https'
            or parsed.netloc != 'checkout.stripe.com' or not parsed.path.startswith('/c/')):
        raise ValueError('Invalid Stripe Checkout URL')
    return url


def create_checkout(store, phone, consent):
    """Return official hosted URL; consent must be True, phone international digits."""
    if consent is not True or not isinstance(phone, str) or not phone.isascii() or not phone.isdecimal() or not 7 <= len(phone) <= 16:
        raise ValueError('Explicit consent and international phone digits required')
    token = secrets.token_hex(24)
    store.db.execute('INSERT INTO checkout_locks VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE checkout_locks.expires<?', (phone, token, time.time() + 180, time.time()))
    lock = store.db.execute('SELECT token FROM checkout_locks WHERE phone=?', (phone,)).fetchone()
    if not lock or lock['token'] != token:
        raise ValueError('Checkout is already opening for this number. Please wait.')
    try:
        return _create_checkout(store, phone)
    finally:
        store.db.execute('DELETE FROM checkout_locks WHERE phone=? AND token=?', (phone, token))


def _create_checkout(store, phone):
    existing = store.db.execute("SELECT id FROM businesses WHERE owner=? AND json_extract(config,'$.subscription_active')=1", (phone,)).fetchone()
    if existing:
        raise ValueError('This number already has Nova. Continue in your WhatsApp conversation.')
    attempts = store.db.execute('SELECT COUNT(*) FROM signups WHERE phone=? AND consent_at>?', (phone, time.time() - 3600)).fetchone()[0]
    if attempts >= 3:
        raise ValueError('Too many checkout attempts for this number. Try again in an hour.')
    price_id = os.environ['NOVA_STRIPE_PRICE_ID']
    price = _api('prices/' + quote(price_id, safe=''))
    _price(price, price_id)
    if price.get('active') is not True:
        raise ValueError('Price is inactive')
    pending = store.db.execute('SELECT * FROM signups WHERE phone=? AND business IS NULL ORDER BY consent_at DESC LIMIT 1',
                               (phone,)).fetchone()
    if pending and pending['session_id']:
        existing_session = _api('checkout/sessions/' + quote(pending['session_id'], safe=''))
        if existing_session.get('status') == 'open':
            return _checkout_url(existing_session.get('url'))
        if existing_session.get('status') == 'complete':
            raise ValueError('Your checkout is complete and payment verification is pending. Please wait for Nova’s WhatsApp welcome.')
        if existing_session.get('status') != 'expired':
            raise ValueError('The previous checkout has an unknown status. Reconcile it before starting another.')
        pending = None
    if pending and not pending['session_id'] and pending['consent_at'] < time.time() - 23 * 3600:
        raise ValueError('A previous checkout needs payment-provider reconciliation before another can be created.')
    signup = pending['id'] if pending else secrets.token_hex(24)
    if not pending:
        store.db.execute('INSERT INTO signups(id,phone,consent_at,price_id) VALUES(?,?,?,?)',
                         (signup, phone, time.time(), price_id))
    session = _api('checkout/sessions', {
        'mode': 'subscription', 'line_items[0][price]': price_id, 'line_items[0][quantity]': 1,
        'client_reference_id': signup, 'metadata[signup_id]': signup,
        'subscription_data[metadata][signup_id]': signup,
        'success_url': os.environ['NOVA_STRIPE_SUCCESS_URL'],
        'cancel_url': os.environ['NOVA_STRIPE_CANCEL_URL'],
    }, 'nova-checkout:' + signup)
    url = _checkout_url(session.get('url'))
    store.db.execute('UPDATE signups SET session_id=? WHERE id=?', (_id(session), signup))
    return url


def subscription_active(store, business):
    """Access gate for parent integration; legacy businesses retain existing access."""
    config = store.business(business)['config']
    if 'subscription_active' not in config:
        return True
    if not config['subscription_active']:
        return False
    row = store.db.execute('SELECT status,period_end FROM subscriptions WHERE business=?', (business,)).fetchone()
    return bool(config['subscription_active'] and row and row['status'] == 'active' and row['period_end'] > time.time())


def portal(store, business):
    """Return a private hosted billing link requested by the authenticated owner."""
    row = store.db.execute('SELECT id FROM subscriptions WHERE business=?', (business,)).fetchone()
    if not row:
        raise ValueError('There is no Nova subscription for this account')
    sub = _api('subscriptions/' + quote(row['id'], safe=''))
    session = _api('billing_portal/sessions', {'customer': _id(sub.get('customer')),
                   'return_url': os.environ['NOVA_PUBLIC_URL'].rstrip('/') + '/signup'})
    url = session.get('url', '')
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc != 'billing.stripe.com' or parsed.fragment or any(c.isspace() for c in url):
        raise ValueError('Billing link could not be verified')
    return url


def _verified_event(raw, signature):
    secret = os.environ['NOVA_STRIPE_WEBHOOK_SECRET']
    if not secret or not isinstance(raw, bytes) or not isinstance(signature, str):
        raise ValueError('Invalid webhook signature')
    try:
        parts = [part.strip().split('=', 1) for part in signature.split(',')]
        timestamps = [v for k, v in parts if k == 't']
        if len(timestamps) != 1:
            raise ValueError('Invalid webhook timestamp')
        timestamp = int(timestamps[0])
        expected = hmac.new(secret.encode(), timestamps[0].encode() + b'.' + raw, hashlib.sha256).hexdigest()
        if abs(time.time() - timestamp) > 300 or not any(
                hmac.compare_digest(expected, v) for k, v in parts if k == 'v1'):
            raise ValueError('Invalid webhook signature')
        event = json.loads(raw)
        _id(event)
        if type(event['created']) is not int:
            raise ValueError('Invalid event timestamp')
        return event
    except (KeyError, TypeError, UnicodeError) as exc:
        raise ValueError('Invalid webhook') from exc


def _subscription(subscription, expected):
    items = subscription.get('items', {})
    rows = items.get('data', [])
    if items.get('has_more') or len(rows) != 1 or rows[0].get('quantity') != 1:
        raise ValueError('Invalid subscription items')
    _price(rows[0]['price'], expected)
    start, end = subscription.get('current_period_start'), subscription.get('current_period_end')
    if type(start) is not int or type(end) is not int or start >= end or not 27 * 86400 <= end - start <= 32 * 86400:
        raise ValueError('Invalid monthly subscription period')
    return start, end


def webhook(store, raw, signature):
    """Return handled/duplicate/ignored. Raise on invalid data or retryable failures.

    Authoritative reads occur under the write lock so concurrent deliveries cannot
    apply stale snapshots over newer ones. No raw payloads or credentials are saved.
    """
    event = _verified_event(raw, signature)
    kind = event.get('type')
    if kind not in EVENTS:
        return 'ignored'
    store.db.execute('BEGIN IMMEDIATE')
    try:
        if store.db.execute('SELECT 1 FROM payment_events WHERE id=?', (event['id'],)).fetchone():
            store.db.execute('COMMIT')
            return 'duplicate'
        obj = event['data']['object']
        checkout = kind.startswith('checkout.')
        signup = None
        if checkout:
            session_id = _id(obj)
            signup = store.db.execute('SELECT * FROM signups WHERE session_id=?', (session_id,)).fetchone()
            if signup:
                session = _api('checkout/sessions/' + quote(session_id, safe=''))
                if (_id(session) != session_id or session.get('mode') != 'subscription'
                        or session.get('status') != 'complete' or session.get('payment_status') != 'paid'
                        or session.get('client_reference_id') != signup['id']
                        or session.get('metadata', {}).get('signup_id') != signup['id']
                        or session.get('currency') != 'usd' or session.get('amount_total') != 20000):
                    raise ValueError('Checkout is not a verified paid Nova signup')
                sub_id = _id(session.get('subscription'))
        else:
            sub_id = _id(obj if kind.startswith('customer.subscription.') else obj.get('subscription'))
            signup = store.db.execute('SELECT signups.* FROM signups JOIN subscriptions ON subscriptions.signup=signups.id WHERE subscriptions.id=?', (sub_id,)).fetchone()
        if signup:
            sub = _api('subscriptions/' + quote(sub_id, safe=''))
            if _id(sub) != sub_id or sub.get('metadata', {}).get('signup_id') != signup['id']:
                raise ValueError('Subscription signup mismatch')
            start, end = _subscription(sub, signup['price_id'])
            if kind == 'invoice.paid' and (obj.get('paid') is not True or obj.get('currency') != 'usd'
                    or obj.get('amount_paid') != 20000):
                raise ValueError('Invalid paid invoice')
            status = sub.get('status')
            if status not in {'active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'}:
                raise ValueError('Invalid subscription status')
            active = status == 'active' and end > time.time()
            business = signup['business']
            if not business and checkout and active:
                operator = os.environ['NOVA_WHATSAPP_PHONE_ID']
                if not operator.strip():
                    raise ValueError('Missing operator phone ID')
                duplicate = store.db.execute("SELECT id FROM businesses WHERE owner=? AND json_extract(config,'$.subscription_active')=1", (signup['phone'],)).fetchone()
                if duplicate:
                    raise ValueError('A paid business already uses this owner number. Reconcile the second payment before provisioning.')
                business = 'nova-' + signup['id']
                store.add_business(business, 'New business', signup['phone'], 'nova-owner:' + signup['id'])
                store.db.execute('UPDATE signups SET business=? WHERE id=?', (business, signup['id']))
                store.db.execute('UPDATE businesses SET config=? WHERE id=?', (json.dumps({
                    'onboarding': {'stage': 'profile', 'detailed': True}, 'operator_phone_id': operator}), business))
                store.enqueue(business, 'delivery', {'template': 'welcome', 'channel': 'whatsapp',
                    'to': signup['phone'], 'text': 'Hi, I’m Nova by Evolution. What does your business sell, and who are your customers? You can send a voice note.'},
                    key='nova-welcome:' + signup['id'])
            if business:
                store.db.execute('''INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET status=excluded.status, period_start=excluded.period_start,
                  period_end=excluded.period_end, updated=excluded.updated''',
                  (sub_id, signup['id'], business, status, signup['price_id'], start, end, time.time()))
                config = store.business(business)['config']
                config.update(subscription_active=active, billing={'subscription_id': sub_id, 'status': status,
                              'price_id': signup['price_id'], 'period_start': start, 'period_end': end})
                store.db.execute('UPDATE businesses SET config=? WHERE id=?', (json.dumps(config), business))
                if active:
                    # Old approved work requires fresh review after a payment interruption.
                    store.db.execute("UPDATE actions SET state='approval' WHERE business=? AND state='billing_hold'", (business,))
                    store.db.execute("UPDATE events SET state='pending' WHERE business=? AND state='billing_hold' AND created>?", (business, time.time() - 23 * 3600))
        store.db.execute('INSERT INTO payment_events VALUES(?,?,?,?)', (event['id'], kind, event['created'], time.time()))
        store.db.execute('COMMIT')
        return 'handled' if signup else 'ignored'
    except Exception:
        store.db.execute('ROLLBACK')
        raise
