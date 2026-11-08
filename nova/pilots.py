"""Owner-created, expiring invitations for a first pilot before payment setup."""
import json
import time


def create(store, business_id, name, owner, phone_id, days=7, token_limit=100000):
    if type(days) is not int or not 1 <= days <= 30:
        raise ValueError('Pilot duration must be 1 to 30 days')
    if type(token_limit) is not int or not 1000 <= token_limit <= 1000000:
        raise ValueError('Pilot token limit must be 1,000 to 1,000,000')
    store.db.execute('BEGIN IMMEDIATE')
    try:
        if store.db.execute('SELECT 1 FROM businesses WHERE id=? OR owner=?', (business_id, owner)).fetchone():
            raise ValueError('This business or owner already exists. Do not overwrite or extend access implicitly.')
        store.add_business(business_id, name, owner, phone_id)
        config = {'subscription_active': False,
                  'pilot': {'expires': time.time() + days * 86400, 'created': time.time()},
                  'monthly_token_limit': token_limit,
                  'onboarding': {'stage': 'welcome', 'detailed': True},
                  'rules': {}}
        store.db.execute('UPDATE businesses SET config=? WHERE id=?', (json.dumps(config), business_id))
        store.db.execute('COMMIT')
    except Exception:
        store.db.execute('ROLLBACK')
        raise
    return {'business': business_id, 'expires': config['pilot']['expires'], 'token_limit': token_limit,
            'message': 'Pilot created. Owner should message the connected business number to start. No charge or outbound message was made.'}
