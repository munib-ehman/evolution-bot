"""Recurring owner work, stored durably; no burst catch-up after downtime."""
import json
import re
import time
from datetime import datetime, timezone
from store import identifier


def setup(store):
    store.db.execute('''CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY, business TEXT REFERENCES businesses(id), instruction TEXT NOT NULL,
      interval_seconds INTEGER NOT NULL, next_run REAL NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
    )''')


def handle(store, business, text, channel='whatsapp'):
    setup(store)
    normalized = text.strip().lower()
    if normalized == 'list tasks':
        rows = store.db.execute('SELECT * FROM routines WHERE business=? AND enabled=1 ORDER BY next_run', (business['id'],)).fetchall()
        return '\n'.join(row['id'] + ': ' + row['instruction'] + ' (next ' + datetime.fromtimestamp(row['next_run'], timezone.utc).isoformat() + ')' for row in rows) or 'No recurring tasks are running.'
    if normalized.startswith('stop task '):
        key = text.strip().split()[-1]
        store.db.execute('UPDATE routines SET enabled=0 WHERE id=? AND business=?', (key, business['id']))
        store.db.execute("UPDATE events SET state='cancelled' WHERE business=? AND state='pending' AND json_extract(body,'$.routine')=?", (business['id'], key))
        return 'Stopped that recurring task if it belongs to this business. Work already in progress may finish.'
    match = re.fullmatch(r'every\s+(day|week|\d{1,3}\s*h(?:ours?)?)\s+((?:seo|bdr)\s+.+)', text.strip(), re.I | re.S)
    if not match:
        return None
    interval = match[1].lower()
    seconds = 86400 if interval == 'day' else 604800 if interval == 'week' else int(re.search(r'\d+', interval)[0])*3600
    if not 3600 <= seconds <= 31*86400:
        raise ValueError('Use a recurring interval between one hour and 31 days.')
    instruction = match[2].strip()
    if len(instruction) > 6000:
        raise ValueError('Keep the recurring instruction under 6,000 characters.')
    existing = store.db.execute('SELECT id FROM routines WHERE business=? AND instruction=? AND interval_seconds=? AND enabled=1', (business['id'], instruction, seconds)).fetchone()
    if existing:
        return 'This task is already running: ' + existing['id']
    key = identifier()
    store.db.execute('INSERT INTO routines(id,business,instruction,interval_seconds,next_run) VALUES(?,?,?,?,?)', (key, business['id'], instruction, seconds, time.time()))
    return 'Recurring work is on. I will do the first task now and repeat every ' + str(seconds//3600) + ' hours. Task: ' + key + '. Say LIST TASKS or STOP TASK ' + key + '. The worker must stay running.'


def tick(store, channel='whatsapp'):
    setup(store)
    now = time.time()
    count = 0
    store.db.execute('BEGIN IMMEDIATE')
    try:
        for row in store.db.execute('SELECT * FROM routines WHERE enabled=1 AND next_run<=? ORDER BY next_run LIMIT 10', (now,)).fetchall():
            business = store.business(row['business'])
            if business['config'].get('paused') or business['config'].get('onboarding', {}).get('stage', 'active') != 'active':
                continue
            # Job identity uses the persisted due slot. A repeat tick cannot enqueue it twice.
            store.enqueue(row['business'], 'owner', {'text': row['instruction'], 'channel': channel, 'routine': row['id']},
                          'routine:' + row['id'] + ':' + str(row['next_run']))
            store.db.execute('UPDATE routines SET next_run=? WHERE id=?', (now + row['interval_seconds'], row['id']))
            count += 1
        store.db.execute('COMMIT')
    except Exception:
        store.db.execute('ROLLBACK')
        raise
    return count
