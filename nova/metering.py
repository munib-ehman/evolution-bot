"""Usage evidence. Provider invoices remain authoritative for third-party charges."""
import json
import math
import os
import time


def setup(store):
    store.db.execute('''CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY, business TEXT REFERENCES businesses(id), category TEXT,
      units REAL, estimated_usd REAL, details TEXT, created REAL
    )''')


def record_model(store, business, result, customer=False):
    usage = result.get('usage', {})
    input_tokens = usage.get('prompt_tokens')
    output_tokens = usage.get('completion_tokens')
    if type(input_tokens) is not int or type(output_tokens) is not int or min(input_tokens, output_tokens) < 0:
        return
    prefix = 'NOVA_CUSTOMER_' if customer and os.environ.get('NOVA_CUSTOMER_AI_MODEL') else 'NOVA_'
    rates = [os.environ.get(prefix + suffix) for suffix in ('INPUT_USD_PER_MILLION', 'OUTPUT_USD_PER_MILLION')]
    cost = None
    if all(rates):
        converted = [float(rate) for rate in rates]
        if not all(math.isfinite(rate) and rate >= 0 for rate in converted):
            raise ValueError('Invalid configured model cost rates')
        cost = (input_tokens * converted[0] + output_tokens * converted[1]) / 1_000_000
    setup(store)
    store.db.execute('INSERT INTO usage_records(business,category,units,estimated_usd,details,created) VALUES(?,?,?,?,?,?)',
                     (business, 'model_tokens', input_tokens + output_tokens, cost,
                      json.dumps({'input_tokens': input_tokens, 'output_tokens': output_tokens}), time.time()))


def summary(store, business):
    setup(store)
    since = time.time() - 7 * 86400
    row = store.db.execute('SELECT COALESCE(SUM(units),0) AS tokens,SUM(estimated_usd) AS cost,COUNT(*) AS count,COUNT(estimated_usd) AS priced FROM usage_records WHERE business=? AND created>=?', (business, since)).fetchone()
    return {'recorded_model_tokens': row['tokens'], 'estimated_model_usd': row['cost'],
            'all_model_calls_priced': row['count'] == row['priced'] and row['count'] > 0,
            'other_provider_costs': 'Not imported; WhatsApp, calls, transcription and hosting costs are additional.'}
