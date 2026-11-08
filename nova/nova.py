#!/usr/bin/env python3
"""Evolution v4 command line. Run server and worker as separate processes."""
import argparse
import fcntl
import json
import os
import time
from pathlib import Path

from engine import execute, work_once
from server import serve
from store import Store


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description='Nova by Evolution — v4')
    commands = parser.add_subparsers(dest='command', required=True)
    add = commands.add_parser('business')
    for field in ['id', 'name', 'owner', 'phone_id']:
        add.add_argument(field)
    ingest = commands.add_parser('import')
    ingest.add_argument('business')
    ingest.add_argument('file')
    ingest.add_argument('--customer-safe', action='store_true', help='Allow use of this document when answering customers')
    configure = commands.add_parser('configure')
    configure.add_argument('business')
    configure.add_argument('file', help='Local JSON file containing rules, limits and connector definitions')
    message = commands.add_parser('message')
    message.add_argument('business')
    message.add_argument('text')
    state = commands.add_parser('state')
    state.add_argument('business')
    pilot = commands.add_parser('pilot', help='Create an expiring invitation without collecting payment')
    for field in ['id', 'name', 'owner', 'phone_id']:
        pilot.add_argument(field)
    pilot.add_argument('--days', type=int, default=7)
    pilot.add_argument('--token-limit', type=int, default=100000)
    doctor = commands.add_parser('doctor', help='Show readiness without exposing credentials')
    doctor.add_argument('--probe-model', action='store_true')
    commands.add_parser('worker')
    server = commands.add_parser('serve')
    server.add_argument('--host', default='127.0.0.1')
    server.add_argument('--port', type=int, default=4190)
    args = parser.parse_args()
    filename = os.environ.get('NOVA_DB', 'data/nova.sqlite')
    store = Store(filename)
    if args.command == 'pilot':
        from pilots import create
        print(json.dumps(create(store, args.id, args.name, args.owner, args.phone_id, args.days, args.token_limit)))
    elif args.command == 'business':
        store.add_business(args.id, args.name, args.owner, args.phone_id)
        import onboarding
        greeting = onboarding.start(store, store.business(args.id))
        business = store.business(args.id)
        business['config']['onboarding']['stage'] = 'welcome'
        onboarding.save(store, business)
        print('Business created. Onboarding starts with the owner’s first message.\n' + greeting)
    elif args.command == 'import':
        path = Path(args.file)
        store.ingest(args.business, path.name, path.read_text(encoding='utf-8-sig'), args.customer_safe)
        print('Imported reference material. Business decisions still require current owner-approved information.')
    elif args.command == 'configure':
        config = json.loads(Path(args.file).read_text())
        if not isinstance(config, dict) or set(config) - {'rules', 'connectors', 'monthly_token_limit', 'sms_number'}:
            raise ValueError('Invalid configuration')
        from engine import TOOLS
        for tool, mode in config.get('rules', {}).items():
            if tool not in TOOLS or mode not in {'auto', 'approve', 'deny'}:
                raise ValueError('Invalid rule')
        if not isinstance(config.get('monthly_token_limit', 500_000), int) or config.get('monthly_token_limit', 500_000) <= 0:
            raise ValueError('Token allowance must be positive')
        if config.get('sms_number'):
            import re
            if not re.fullmatch(r'\+\d{7,16}', config['sms_number']):
                raise ValueError('SMS number must use +country code format')
            other = store.db.execute("SELECT id FROM businesses WHERE json_extract(config,'$.sms_number')=? AND id<>?", (config['sms_number'], args.business)).fetchone()
            if other:
                raise ValueError('SMS number already belongs to another business')
        current = store.business(args.business)['config']
        current.update(config)
        store.db.execute('UPDATE businesses SET config=? WHERE id=?', (json.dumps(current), args.business))
        print('Configuration saved.')
    elif args.command == 'message':
        store.business(args.business)
        print(store.enqueue(args.business, 'owner', {'text': args.text, 'channel': 'local'}))
    elif args.command == 'state':
        print(json.dumps({'report': store.report(args.business), 'events': [dict(row) for row in store.db.execute(
            'SELECT id,kind,state,result FROM events WHERE business=? ORDER BY created DESC LIMIT 20', (args.business,))]}, indent=2))
    elif args.command == 'doctor':
        from diagnostics import report
        print(json.dumps(report(store, args.probe_model), indent=2))
    elif args.command == 'serve':
        store.db.close()
        serve(args.host, args.port)
    else:
        lock = open(filename + '.worker.lock', 'a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        store.db.execute("UPDATE actions SET state='uncertain',result=? WHERE state='executing'", (json.dumps({'error': 'Worker interrupted. Reconcile before retry.'}),))
        store.db.execute("UPDATE events SET state=CASE WHEN kind='delivery' THEN 'uncertain' ELSE 'interrupted' END WHERE state='processing'")
        if os.environ.get('WHATSAPP_WELCOME_TEMPLATE'):
            store.db.execute("UPDATE events SET state='pending' WHERE kind='delivery' AND state='awaiting_template'")
        from readiness import heartbeat
        while True:
            heartbeat(store)
            worked = work_once(store)
            for action in store.db.execute("SELECT * FROM actions WHERE state='ready' ORDER BY created LIMIT 5").fetchall():
                execute(store, dict(action))
                worked = True
            week = time.strftime('%G-W%V', time.gmtime())
            for business in store.db.execute('SELECT id,config FROM businesses').fetchall():
                # The report is saved once per UTC week. Delivery waits for an active WhatsApp session.
                if json.loads(business['config']).get('onboarding', {}).get('stage', 'active') != 'active':
                    continue
                store.enqueue(business['id'], 'report', {'channel': 'whatsapp'}, 'weekly:' + business['id'] + ':' + week)
            if not worked:
                time.sleep(1)


if __name__ == '__main__':
    main()
