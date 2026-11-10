"""Read-only operational checklist. Never return secrets or customer data."""
import os
import time
from pathlib import Path
from urllib.parse import urlsplit
import providers


def report(store, probe=False):
    try:
        cfg = providers.configuration()
        ai = {'configured': True, 'provider': cfg['provider'], 'model': cfg['model'], 'reachable': None}
        if probe:
            from channels import request
            import json
            if cfg['provider'] == 'ollama':
                base = cfg['base_url'].removesuffix('/v1')
                result = json.loads(request(base + '/api/tags'))
                ai['reachable'] = any(item.get('name') == cfg['model'] for item in result.get('models', []))
            else:
                result = json.loads(request(cfg['base_url'] + '/models', headers={'Authorization': 'Bearer ' + cfg['key']}))
                ai['reachable'] = any(item.get('id') == cfg['model'] for item in result.get('data', []))
    except Exception:
        ai = {'configured': False, 'reachable': False, 'message': 'Model configuration or connection needs attention.'}
    exists = store.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_status'").fetchone()
    row = store.db.execute("SELECT updated FROM runtime_status WHERE name='worker'").fetchone() if exists else None
    whatsapp = all(os.environ.get(k) for k in ('META_APP_SECRET','META_GRAPH_VERSION','WHATSAPP_ACCESS_TOKEN','WHATSAPP_VERIFY_TOKEN'))
    return {'ai': ai, 'worker_recent': bool(row and 0 <= time.time()-row['updated'] < 120),
            'whatsapp_configured': whatsapp,
            'owner_welcome_template_configured': bool(os.environ.get('WHATSAPP_WELCOME_TEMPLATE')),
            'local_voice_transcription_configured': __import__('speech').configured(),
            'voice_call_configured': all(os.environ.get(k) for k in ('TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','NOVA_CALL_FROM_NUMBER')),
            'calendar_configured': all(os.environ.get(k) for k in ('GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','NOVA_TOKEN_ENCRYPTION_KEY')),
            'public_https_configured': urlsplit(os.environ.get('NOVA_PUBLIC_URL','')).scheme == 'https',
            'data_store': 'SQLite on this host; requires durable disk and backup',
            'live_provider_flow_verified': False,
            'verification_note': 'Configuration and model reachability do not prove WhatsApp delivery, calls or Calendar authorization.'}
