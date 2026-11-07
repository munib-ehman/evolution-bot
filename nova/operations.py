"""Small, shared sales records for the travel and detailing pilots."""
import json
import re
import time
from datetime import datetime
from decimal import Decimal, InvalidOperation

from store import identifier


DESCRIPTIONS = {
    'save_lead': 'Save or update a customer inquiry. Arguments: contact (phone digits), name, need.',
    'prepare_quote': 'Record an owner-approved quote for an existing lead. Arguments: lead_id, description, amount (decimal string), currency (3-letter code). The quote is not automatically sent.',
    'confirm_booking': 'Confirm an approved quote into a booking. Arguments: quote_id, starts_at, ends_at (ISO 8601 with timezones). A local booking does not create an external calendar event.',
}


def setup(store):
    store.db.executescript("""
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY, business TEXT REFERENCES businesses(id), contact TEXT,
        name TEXT, need TEXT, updated REAL, UNIQUE(business,contact)
      );
      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY, business TEXT REFERENCES businesses(id), lead TEXT REFERENCES leads(id),
        description TEXT, amount_minor INTEGER, currency TEXT, action TEXT UNIQUE,
        created REAL
      );
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY, business TEXT REFERENCES businesses(id), quote TEXT UNIQUE REFERENCES quotes(id),
        starts_at REAL, ends_at REAL, action TEXT UNIQUE, created REAL
      );
      CREATE TABLE IF NOT EXISTS suppressed_contacts (
        business TEXT REFERENCES businesses(id), contact TEXT,
        created REAL, PRIMARY KEY(business,contact)
      );
    """)


def validate(tool, args):
    fields = {'save_lead': {'contact', 'name', 'need'},
              'prepare_quote': {'lead_id', 'description', 'amount', 'currency'},
              'confirm_booking': {'quote_id', 'starts_at', 'ends_at'}}[tool]
    if not isinstance(args, dict) or set(args) != fields:
        raise ValueError('Incomplete sales action')
    if not all(isinstance(value, str) and 0 < len(value) <= 3000 for value in args.values()):
        raise ValueError('Sales action values must be nonempty text')
    if tool == 'save_lead' and not re.fullmatch(r'\d{7,16}', args['contact']):
        raise ValueError('Use an international phone number, digits only')
    if tool == 'prepare_quote':
        try:
            amount = Decimal(args['amount'])
            if not amount.is_finite() or amount <= 0 or amount > 10_000_000 or amount != amount.quantize(Decimal('.01')):
                raise ValueError('Quote needs a positive amount with at most two decimal places')
        except InvalidOperation:
            raise ValueError('Invalid quote amount') from None
        if not re.fullmatch('[A-Z]{3}', args['currency']):
            raise ValueError('Use a three-letter currency code')
    if tool == 'confirm_booking':
        start, end = [datetime.fromisoformat(args[field]) for field in ('starts_at', 'ends_at')]
        if not start.tzinfo or not end.tzinfo or start >= end or start.timestamp() <= time.time():
            raise ValueError('Booking needs future start and end times with timezones')


def execute(store, business, action):
    tool, args = action['tool'], json.loads(action['args'])
    validate(tool, args)
    if tool == 'save_lead':
        store.db.execute('INSERT INTO leads VALUES(?,?,?,?,?,?) ON CONFLICT(business,contact) DO UPDATE SET name=excluded.name,need=excluded.need,updated=excluded.updated',
                         (identifier(), business, args['contact'], args['name'], args['need'], time.time()))
        lead = store.db.execute('SELECT id FROM leads WHERE business=? AND contact=?', (business, args['contact'])).fetchone()
        return {'lead_id': lead['id'], 'saved': True}
    if tool == 'prepare_quote':
        lead = store.db.execute('SELECT id FROM leads WHERE business=? AND id=?', (business, args['lead_id'])).fetchone()
        if not lead:
            raise ValueError('Lead is not available in this business')
        store.db.execute('INSERT OR IGNORE INTO quotes VALUES(?,?,?,?,?,?,?,?)',
                         (identifier(), business, lead['id'], args['description'], int(Decimal(args['amount']) * 100), args['currency'], action['id'], time.time()))
        quote = store.db.execute('SELECT id FROM quotes WHERE business=? AND action=?', (business, action['id'])).fetchone()
        return {'quote_id': quote['id'], 'status': 'prepared', 'sent': False}
    quote = store.db.execute('SELECT id FROM quotes WHERE business=? AND id=?', (business, args['quote_id'])).fetchone()
    if not quote:
        raise ValueError('Quote is not available in this business')
    start, end = [datetime.fromisoformat(args[field]).timestamp() for field in ('starts_at', 'ends_at')]
    store.db.execute('BEGIN IMMEDIATE')
    try:
        existing = store.db.execute('SELECT id FROM bookings WHERE business=? AND quote=?', (business, quote['id'])).fetchone()
        if existing:
            raise ValueError('This quote is already booked')
        overlap = store.db.execute('SELECT id FROM bookings WHERE business=? AND starts_at<? AND ends_at>?', (business, end, start)).fetchone()
        if overlap:
            raise ValueError('This time overlaps an existing Nova booking. Confirm capacity with the owner.')
        booking = identifier()
        store.db.execute('INSERT INTO bookings VALUES(?,?,?,?,?,?,?)', (booking, business, quote['id'], start, end, action['id'], time.time()))
        store.db.execute('COMMIT')
        return {'booking_id': booking, 'status': 'confirmed_in_nova', 'calendar_synced': False}
    except Exception:
        store.db.execute('ROLLBACK')
        raise


def context(store, business):
    return {
        'leads': [dict(row) for row in store.db.execute('SELECT id,contact,name,need FROM leads WHERE business=? ORDER BY updated DESC LIMIT 12', (business,))],
        'quotes': [dict(row) for row in store.db.execute('SELECT id,lead,description,amount_minor,currency FROM quotes WHERE business=? ORDER BY created DESC LIMIT 12', (business,))],
        'bookings': [dict(row) for row in store.db.execute('SELECT id,quote,starts_at,ends_at FROM bookings WHERE business=? ORDER BY created DESC LIMIT 12', (business,))],
    }


def report(store, business):
    since = time.time() - 7 * 86400
    return {'quotes_prepared': store.db.execute('SELECT COUNT(*) FROM quotes WHERE business=? AND created>=?', (business, since)).fetchone()[0],
            'bookings_confirmed': store.db.execute('SELECT COUNT(*) FROM bookings WHERE business=? AND created>=?', (business, since)).fetchone()[0]}
