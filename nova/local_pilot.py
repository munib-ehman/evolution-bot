#!/usr/bin/env python3
"""Review real local reasoning using isolated fictional business data. No provider sends."""
import argparse
import json
import os
from pathlib import Path
from store import Store
from pilots import create
from engine import work_once, execute


def run(store, text):
    # Reassert safety even when an owner changes a rule during the review.
    business = store.business('local-review')
    for tool in ('send_message','call_owner','connector','calendar_event'):
        business['config'].setdefault('rules', {})[tool] = 'deny'
    store.db.execute('UPDATE businesses SET config=? WHERE id=?', (json.dumps(business['config']), 'local-review'))
    event = store.enqueue('local-review', 'owner', {'text': text, 'channel': 'local'})
    for _ in range(20):
        if not work_once(store):
            break
    for action in store.db.execute("SELECT * FROM actions WHERE business='local-review' AND state='ready'").fetchall():
        if action['tool'] not in {'remember','schedule','save_lead','prepare_quote','confirm_booking'}:
            store.db.execute("UPDATE actions SET state='denied' WHERE id=?", (action['id'],))
        else:
            execute(store, dict(action))
    row = store.db.execute('SELECT state,result FROM events WHERE id=?', (event,)).fetchone()
    result = json.loads(row['result'] or '{}')
    print(result.get('reply', json.dumps(result)))
    for action in store.db.execute('SELECT id,tool,state,args FROM actions WHERE event=?', (event,)):
        print(json.dumps(dict(action)))
    return row['state']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--message', help='Run one owner message, otherwise open an interactive review')
    parser.add_argument('--db', default=str(Path(__file__).resolve().parent / 'data/local-review.sqlite'))
    args = parser.parse_args()
    os.environ.setdefault('NOVA_AI_PROVIDER','ollama')
    os.environ.setdefault('NOVA_AI_MODEL','llama3.2:3b')
    if os.environ['NOVA_AI_PROVIDER'] != 'ollama':
        raise ValueError('This free local review requires Ollama. Configure hosted pilots separately.')
    store = Store(args.db)
    try:
        if not store.db.execute("SELECT 1 FROM businesses WHERE id='local-review'").fetchone():
            create(store,'local-review','Fictional travel business','15555550101','local-review-phone',days=7)
            store.db.execute("UPDATE businesses SET config=json_set(config,'$.onboarding.stage','active') WHERE id='local-review'")
            store.ingest('local-review','Sample catalog','Consultations are free. A sample Dubai package is USD 500 per adult, subject to owner confirmation. Never claim availability or a completed reservation.',True)
        if args.message:
            if run(store,args.message) != 'done':
                raise SystemExit(1)
        else:
            print('Nova local review. Fictional sample business. Type EXIT to leave; REPORT shows activity. No real messages, calls or payments are sent.')
            while True:
                text=input('You: ').strip()
                if text.lower() in {'exit','quit'}:
                    break
                if text:
                    run(store,text)
    finally:
        store.db.close()


if __name__ == '__main__':
    main()
