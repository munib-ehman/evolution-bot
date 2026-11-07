"""Durable, business-scoped Nova state. One worker per database."""
import json
import os
import sqlite3
import time
import uuid
from pathlib import Path


def identifier():
    return uuid.uuid4().hex


class Store:
    def __init__(self, filename):
        path = Path(filename)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path, timeout=15, isolation_level=None)
        os.chmod(path, 0o600)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
          PRAGMA journal_mode=WAL;
          PRAGMA foreign_keys=ON;
          CREATE TABLE IF NOT EXISTS businesses (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL,
            phone_id TEXT UNIQUE NOT NULL, config TEXT NOT NULL DEFAULT '{}'
          );
          CREATE TABLE IF NOT EXISTS documents (
            business TEXT REFERENCES businesses(id), name TEXT, body TEXT,
            created REAL, customer_safe INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(business,name)
          );
          CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, business TEXT REFERENCES businesses(id),
            kind TEXT, body TEXT, state TEXT DEFAULT 'pending', result TEXT,
            created REAL, due REAL
          );
          CREATE TABLE IF NOT EXISTS actions (
            id TEXT PRIMARY KEY, business TEXT REFERENCES businesses(id),
            event TEXT REFERENCES events(id), tool TEXT, args TEXT,
            state TEXT, result TEXT, created REAL,
            UNIQUE(event,tool,args)
          );
          CREATE TABLE IF NOT EXISTS usage (
            business TEXT REFERENCES businesses(id), month TEXT,
            reserved INTEGER DEFAULT 0, PRIMARY KEY(business,month)
          );
        """)
        columns = {row[1] for row in self.db.execute('PRAGMA table_info(documents)')}
        if 'customer_safe' not in columns:
            self.db.execute('ALTER TABLE documents ADD COLUMN customer_safe INTEGER NOT NULL DEFAULT 0')
        import operations
        operations.setup(self)

    def business(self, business):
        row = self.db.execute('SELECT * FROM businesses WHERE id=?', (business,)).fetchone()
        if not row:
            raise ValueError('Unknown business')
        return {**dict(row), 'config': json.loads(row['config'])}

    def add_business(self, business, name, owner, phone_id):
        if not owner.isdecimal() or not 7 <= len(owner) <= 16:
            raise ValueError('Owner must be country code and number, digits only')
        self.db.execute('INSERT INTO businesses(id,name,owner,phone_id) VALUES(?,?,?,?)',
                        (business, name, owner, phone_id))

    def ingest(self, business, name, body, customer_safe=False):
        self.business(business)
        if not body.strip() or len(body) > 2_000_000:
            raise ValueError('Import must contain 1 to 2,000,000 characters')
        self.db.execute('INSERT OR REPLACE INTO documents(business,name,body,created,customer_safe) VALUES(?,?,?,?,?)',
                        (business, name, body, time.time(), int(customer_safe)))

    def enqueue(self, business, kind, body, key=None, due=None, occurred=None):
        event = key or identifier()
        self.db.execute('INSERT OR IGNORE INTO events(id,business,kind,body,created,due) VALUES(?,?,?,?,?,?)',
                        (event, business, kind, json.dumps(body), occurred or time.time(), due or time.time()))
        return event

    def claim(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            row = self.db.execute("SELECT * FROM events WHERE state='pending' AND due<=? ORDER BY due,created LIMIT 1",
                                  (time.time(),)).fetchone()
            if row:
                self.db.execute("UPDATE events SET state='processing' WHERE id=?", (row['id'],))
            self.db.execute('COMMIT')
            return dict(row) if row else None
        except Exception:
            self.db.execute('ROLLBACK')
            raise

    def finish(self, event, state, result):
        self.db.execute('UPDATE events SET state=?,result=? WHERE id=?', (state, json.dumps(result), event))

    def context(self, business, query, customer=None):
        # Retrieve individual passages, not whole chat archives. Every item remains source-labelled.
        words = set(query.lower().split())
        passages = []
        for row in self.db.execute('SELECT name,body FROM documents WHERE business=? AND (?=0 OR customer_safe=1)', (business, int(bool(customer)))):
            for offset in range(0, len(row['body']), 1500):
                body = row['body'][offset:offset + 1500]
                score = len(words & set(body.lower().split()))
                passages.append((score, row['name'], offset, body))
        passages.sort(key=lambda item: item[0], reverse=True)
        history = [dict(row) for row in self.db.execute(
            "SELECT kind,body,result FROM events WHERE business=? AND state='done' AND (?='' OR (kind='customer' AND json_extract(body,'$.from')=?)) ORDER BY created DESC LIMIT 6", (business, customer or '', customer or ''))]
        actions = [dict(row) for row in self.db.execute(
            "SELECT id,tool,args,state,result FROM actions WHERE business=? AND (?='' OR (tool='send_message' AND json_extract(args,'$.to')=?)) ORDER BY created DESC LIMIT 12", (business, customer or '', customer or ''))]
        result = {'references': [{'source': name, 'offset': offset, 'text': body}
                                 for _, name, offset, body in passages[:8]], 'recent': history[::-1], 'action_results': actions}
        if not customer:
            import operations
            result['sales'] = operations.context(self, business)
        return result

    def reserve_tokens(self, business, amount, limit):
        month = time.strftime('%Y-%m', time.gmtime())
        self.db.execute('INSERT OR IGNORE INTO usage(business,month) VALUES(?,?)', (business, month))
        cursor = self.db.execute('UPDATE usage SET reserved=reserved+? WHERE business=? AND month=? AND reserved+?<=?',
                                 (amount, business, month, amount, limit))
        if cursor.rowcount != 1:
            raise ValueError('AI usage limit reached. Owner must approve a higher allowance.')

    def report(self, business):
        since = time.time() - 7 * 86400
        counts = [dict(row) for row in self.db.execute(
            'SELECT state,COUNT(*) AS count FROM actions WHERE business=? AND created>=? GROUP BY state',
            (business, since))]
        outstanding = [dict(row) for row in self.db.execute(
            "SELECT id,tool,state FROM actions WHERE business=? AND state IN ('approval','uncertain','failed') ORDER BY created DESC LIMIT 20", (business,))]
        import operations
        month = time.strftime('%Y-%m', time.gmtime())
        usage = self.db.execute('SELECT reserved FROM usage WHERE business=? AND month=?', (business, month)).fetchone()
        limit = self.business(business)['config'].get('monthly_token_limit', 500_000)
        return {'period_days': 7, 'actions': counts, 'needs_attention': outstanding,
                'sales': operations.report(self, business),
                'usage_percent': round(100 * (usage[0] if usage else 0) / limit, 1)}
