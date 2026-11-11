"""Owner-created, expiring invitations for a first pilot before payment setup."""
import json
import os
import re
import time


def create(store, business_id, name, owner, phone_id, days=7, token_limit=100000, *, whatsapp_welcome=False):
    if type(days) is not int or not 1 <= days <= 30:
        raise ValueError('Pilot duration must be 1 to 30 days')
    if type(token_limit) is not int or not 1000 <= token_limit <= 1000000:
        raise ValueError('Pilot token limit must be 1,000 to 1,000,000')
    if not whatsapp_welcome and not phone_id:
        raise ValueError('Provide the connected business phone ID.')
    operator = os.environ.get('NOVA_WHATSAPP_PHONE_ID', '')
    if whatsapp_welcome and (not re.fullmatch(r'[0-9]{5,32}', operator) or not all(
        os.environ.get(key) for key in ('META_APP_SECRET', 'META_GRAPH_VERSION', 'WHATSAPP_ACCESS_TOKEN',
                                       'WHATSAPP_WELCOME_TEMPLATE')
    )):
        raise ValueError('Connect the Nova operator number and approved welcome template first.')
    store.db.execute('BEGIN IMMEDIATE')
    try:
        if store.db.execute('SELECT 1 FROM businesses WHERE id=? OR owner=?', (business_id, owner)).fetchone():
            raise ValueError('This business or owner already exists. Do not overwrite or extend access implicitly.')
        store.add_business(business_id, name, owner, "nova-owner:" + business_id if whatsapp_welcome else phone_id)
        config = {'subscription_active': False,
                  'pilot': {'expires': time.time() + days * 86400, 'created': time.time()},
                  'monthly_token_limit': token_limit,
                  'onboarding': {'stage': 'welcome', 'detailed': True},
                  'execution_mode': 'automatic', 'rules': {}}
        if whatsapp_welcome:
            config.update(operator_phone_id=operator, onboarding={'stage': 'profile', 'require_inbox': True},
                          execution_mode='review')
            store.enqueue(business_id, 'delivery', {'template': 'welcome', 'pilot_welcome': True},
                          'nova-pilot-welcome:' + business_id)
        store.db.execute('UPDATE businesses SET config=? WHERE id=?', (json.dumps(config), business_id))
        store.db.execute('COMMIT')
    except Exception:
        store.db.execute('ROLLBACK')
        raise
    return {'business': business_id, 'expires': config['pilot']['expires'], 'token_limit': token_limit,
            'message': 'WhatsApp welcome queued. Delivery is pending.' if whatsapp_welcome else 'Pilot created. Owner should message the connected business number to start. No charge or outbound message was made.'}
