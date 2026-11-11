"""Public launch state. Configuration presence is not provider verification."""
import os
import time

REQUIRED = ('NOVA_STRIPE_SECRET_KEY', 'NOVA_STRIPE_WEBHOOK_SECRET', 'NOVA_STRIPE_PRICE_ID',
            'NOVA_STRIPE_SUCCESS_URL', 'NOVA_STRIPE_CANCEL_URL', 'NOVA_WHATSAPP_PHONE_ID',
            'META_APP_SECRET', 'META_GRAPH_VERSION', 'WHATSAPP_VERIFY_TOKEN',
            'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_WELCOME_TEMPLATE',
            'NOVA_PUBLIC_URL')


def heartbeat(store):
    store.db.execute('CREATE TABLE IF NOT EXISTS runtime_status (name TEXT PRIMARY KEY, updated REAL NOT NULL)')
    store.db.execute("INSERT INTO runtime_status VALUES('worker',?) ON CONFLICT(name) DO UPDATE SET updated=excluded.updated", (time.time(),))


def status(store):
    store.db.execute('CREATE TABLE IF NOT EXISTS runtime_status (name TEXT PRIMARY KEY, updated REAL NOT NULL)')
    row = store.db.execute("SELECT updated FROM runtime_status WHERE name='worker'").fetchone()
    worker = bool(row and time.time() - row['updated'] < 120)
    from providers import configured as model_configured
    configured = all(os.environ.get(key) for key in REQUIRED) and model_configured()
    live_payments = os.environ.get('NOVA_STRIPE_SECRET_KEY', '').startswith(('sk_live_', 'rk_live_'))
    ready = configured and live_payments and worker and os.environ.get('NOVA_ACCEPT_SIGNUPS') == 'true'
    return {'checkout_ready': ready, 'status': 'open' if ready else 'setup_pending',
            'message': 'Ready to start.' if ready else 'Pilot setup is in progress. Checkout will open once Nova is ready.'}
