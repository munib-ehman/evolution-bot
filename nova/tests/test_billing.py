import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import billing
from store import Store


class BillingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / 'nova.db')
        self.addCleanup(self.store.db.close)
        billing.setup(self.store)
        self.env = patch.dict(os.environ, {
            'NOVA_STRIPE_SECRET_KEY': 'test-key', 'NOVA_STRIPE_WEBHOOK_SECRET': 'test-secret',
            'NOVA_STRIPE_PRICE_ID': 'price_nova', 'NOVA_WHATSAPP_PHONE_ID': 'shared-phone',
            'NOVA_STRIPE_SUCCESS_URL': 'https://example.test/success',
            'NOVA_STRIPE_CANCEL_URL': 'https://example.test/cancel'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.price = {'id': 'price_nova', 'currency': 'usd', 'unit_amount': 20000,
                      'active': True, 'billing_scheme': 'per_unit',
                      'recurring': {'interval': 'month', 'interval_count': 1, 'usage_type': 'licensed'}}
        now = int(time.time())
        self.sub = {'id': 'sub_test', 'status': 'active', 'current_period_start': now - 100,
                    'current_period_end': now - 100 + 30 * 86400,
                    'items': {'data': [{'price': self.price, 'quantity': 1}]}}
        self.session = {'id': 'cs_test', 'url': 'https://checkout.stripe.com/c/pay/test',
                        'mode': 'subscription', 'status': 'complete', 'payment_status': 'paid',
                        'currency': 'usd', 'amount_total': 20000, 'subscription': 'sub_test'}
        self.http = patch('channels.request', side_effect=self.provider).start()
        self.addCleanup(patch.stopall)

    def provider(self, url, data=None, headers=None, method=None):
        self.assertTrue(url.startswith('https://api.stripe.com/v1/'))
        if url.endswith('/prices/price_nova'):
            result = self.price
        elif method == 'POST':
            fields = parse_qs(data.decode())
            signup = fields['client_reference_id'][0]
            self.assertEqual(fields['metadata[signup_id]'], [signup])
            self.assertEqual(fields['subscription_data[metadata][signup_id]'], [signup])
            self.assertEqual(fields['mode'], ['subscription'])
            self.assertEqual(fields['line_items[0][price]'], ['price_nova'])
            self.assertEqual(headers['Idempotency-Key'], 'nova-checkout:' + signup)
            self.session.update(client_reference_id=signup, metadata={'signup_id': signup})
            self.sub['metadata'] = {'signup_id': signup}
            result = self.session
        elif url.endswith('/checkout/sessions/cs_test'):
            result = self.session
        elif url.endswith('/subscriptions/sub_test'):
            result = self.sub
        else:
            raise AssertionError('Unexpected HTTP')
        return json.dumps(result).encode()

    def checkout(self):
        return billing.create_checkout(self.store, '923001234567', True)

    def event(self, kind='checkout.session.completed', event_id='evt_test', obj=None, timestamp=None):
        raw = json.dumps({'id': event_id, 'created': 100, 'type': kind,
                          'data': {'object': obj or {'id': 'cs_test'}}}).encode()
        timestamp = str(int(time.time()) if timestamp is None else timestamp)
        digest = hmac.new(b'test-secret', timestamp.encode() + b'.' + raw, hashlib.sha256).hexdigest()
        return raw, 't=' + timestamp + ',v1=' + digest

    def paid(self):
        self.checkout()
        self.assertEqual(billing.webhook(self.store, *self.event()), 'handled')
        return self.store.db.execute('SELECT id FROM businesses').fetchone()[0]

    def test_checkout_and_paid_provisioning_are_separate(self):
        self.assertEqual(self.checkout(), self.session['url'])
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM businesses').fetchone()[0], 0)
        billing.webhook(self.store, *self.event())
        row = self.store.db.execute('SELECT * FROM businesses').fetchone()
        self.assertTrue(row['phone_id'].startswith('nova-owner:'))
        self.assertEqual(row['owner'], '923001234567')
        config = json.loads(row['config'])
        self.assertEqual(config['onboarding'], {'stage': 'profile', 'require_inbox': True})
        self.assertEqual(config['operator_phone_id'], 'shared-phone')
        self.assertTrue(billing.subscription_active(self.store, row['id']))
        event = self.store.db.execute('SELECT * FROM events').fetchone()
        self.assertEqual(event['kind'], 'delivery')
        body = json.loads(event['body'])
        self.assertEqual((body['template'], body['channel'], body['to']), ('welcome', 'whatsapp', row['owner']))

    def test_duplicates_and_distinct_checkout_events_welcome_once(self):
        self.paid()
        self.http.reset_mock()
        self.assertEqual(billing.webhook(self.store, *self.event()), 'duplicate')
        self.http.assert_not_called()
        billing.webhook(self.store, *self.event('checkout.session.async_payment_succeeded', 'evt_second'))
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 1)

    def test_cancel_and_delayed_invoice_use_authoritative_status(self):
        business = self.paid()
        self.sub['status'] = 'canceled'
        billing.webhook(self.store, *self.event('customer.subscription.deleted', 'evt_cancel', {'id': 'sub_test'}))
        self.assertFalse(billing.subscription_active(self.store, business))
        billing.webhook(self.store, *self.event('invoice.paid', 'evt_old', {
            'subscription': 'sub_test', 'paid': True, 'currency': 'usd', 'amount_paid': 20000}))
        self.assertFalse(billing.subscription_active(self.store, business))

    def test_wrong_price_and_period_roll_back(self):
        self.checkout()
        for key, value in [('unit_amount', 19999), ('currency', 'eur'), ('id', 'price_other')]:
            with self.subTest(key=key):
                original = self.price[key]
                self.price[key] = value
                with self.assertRaises(ValueError):
                    billing.webhook(self.store, *self.event())
                self.price[key] = original
                self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM businesses').fetchone()[0], 0)
                self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM payment_events').fetchone()[0], 0)
        self.sub['current_period_end'] += 365 * 86400
        with self.assertRaises(ValueError):
            billing.webhook(self.store, *self.event())

    def test_signatures_and_unpaid_checkout(self):
        self.checkout()
        for stamp in [int(time.time()) - 301, int(time.time()) + 301]:
            with self.assertRaises(ValueError):
                billing.webhook(self.store, *self.event(timestamp=stamp))
        raw, signature = self.event()
        with self.assertRaises(ValueError):
            billing.webhook(self.store, raw + b' ', signature)
        self.session['payment_status'] = 'unpaid'
        with self.assertRaises(ValueError):
            billing.webhook(self.store, raw, signature)

    def test_legacy_access_and_consent(self):
        self.store.add_business('legacy', 'Existing', '923001234567', 'old-phone')
        self.assertTrue(billing.subscription_active(self.store, 'legacy'))
        with self.assertRaises(ValueError):
            billing.create_checkout(self.store, '923001234567', False)
        self.http.assert_not_called()

    def test_reject_bad_redirect_and_price_before_provisioning(self):
        self.price['unit_amount'] = 1
        with self.assertRaises(ValueError):
            self.checkout()
        self.price['unit_amount'] = 20000
        self.session['url'] = 'https://checkout.stripe.com.evil.test/c/pay/test'
        with self.assertRaises(ValueError):
            self.checkout()

    def test_storefront_checkout_returns_to_public_domain(self):
        with patch.object(billing, '_api', wraps=billing._api) as provider:
            url = billing.create_checkout(self.store, '923001234567', True,
                                          storefront='https://www.runevolution.io')
        self.assertEqual(url, self.session['url'])
        fields = next(call.args[1] for call in provider.call_args_list
                      if call.args[0] == 'checkout/sessions')
        self.assertEqual(fields['success_url'], 'https://www.runevolution.io/signup/complete')
        self.assertEqual(fields['cancel_url'], 'https://www.runevolution.io/signup/cancel')

    def test_official_stripe_checkout_fragment_is_preserved(self):
        self.session['url'] = 'https://checkout.stripe.com/c/pay/cs_test_sample#fidkdWxOYHwnPyd1blpxYHZxWjA0'
        self.assertEqual(self.checkout(), self.session['url'])

    def test_provider_failure_is_retryable_without_event_receipt(self):
        self.checkout()
        with patch('channels.request', side_effect=TimeoutError('unavailable')):
            with self.assertRaises(TimeoutError):
                billing.webhook(self.store, *self.event())
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM payment_events').fetchone()[0], 0)
        self.assertEqual(billing.webhook(self.store, *self.event()), 'handled')

    def test_untrusted_events_and_subscription_cannot_provision(self):
        self.checkout()
        self.assertEqual(billing.webhook(self.store, *self.event('payment_intent.succeeded')), 'ignored')
        self.assertEqual(billing.webhook(self.store, *self.event('customer.subscription.created',
                         'evt_subscription', {'id': 'sub_test'})), 'ignored')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM businesses').fetchone()[0], 0)
        billing.webhook(self.store, *self.event())
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM businesses').fetchone()[0], 1)

    def test_atomic_rollback_and_retry(self):
        self.checkout()
        with patch.object(self.store, 'enqueue', side_effect=RuntimeError('queue unavailable')):
            with self.assertRaises(RuntimeError):
                billing.webhook(self.store, *self.event())
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM businesses').fetchone()[0], 0)
        self.assertEqual(billing.webhook(self.store, *self.event()), 'handled')

    def test_paid_welcome_and_complete_business_onboarding(self):
        from engine import work_once
        business = self.paid()
        with patch.dict(os.environ, {'WHATSAPP_WELCOME_TEMPLATE': 'nova_welcome'}), patch('engine.whatsapp_welcome', return_value='wa-welcome') as sender:
            work_once(self.store)
            sender.assert_called_once_with('shared-phone', '923001234567')
        def turn(message):
            event = self.store.enqueue(business, 'owner', {'text': message, 'channel': 'local'})
            work_once(self.store, lambda *_: {'reply': 'What dates and budget do you have?', 'actions': []})
            row = self.store.db.execute('SELECT state,result FROM events WHERE id=?', (event,)).fetchone()
            self.assertEqual(row['state'], 'done')
            return json.loads(row['result'])['reply']

        turn('We sell Umrah travel packages')
        turn('Handle inquiries and follow up')
        self.assertIn('Share one current package', turn('DONE'))
        self.store.ingest(business, 'packages.txt', 'Ask for departure city and dates.', True)
        self.assertIn('authorize Nova', turn('DONE'))
        self.assertIn('awaiting an authorized', turn('INBOX STATUS'))
        self.assertIn('Once Evolution has linked', turn('DONE'))
        import onboarding
        with patch('channels.whatsapp_phone', return_value='+1 555 555 0100') as lookup:
            with self.assertRaises(ValueError):
                onboarding.bind_inbox(self.store, business, 'shared-phone')
            lookup.assert_not_called()
            onboarding.bind_inbox(self.store, business, '100001')
            lookup.assert_called_once_with('100001')
        self.assertEqual(self.store.business(business)['phone_id'], '100001')
        self.assertIn('inbox is linked', turn('INBOX STATUS'))
        turn('DONE')
        self.assertIn('Reply 1', turn('CONTINUE'))
        turn('2')
        turn('Umrah package from Chicago')
        self.assertIn('Nova is active', turn('ACTIVATE'))
        self.assertIn('automatic messaging permission', turn('Follow up after four hours'))
        self.assertEqual(self.store.business(business)['config']['rules']['send_message'], 'auto')
        self.assertEqual(self.store.business(business)['config']['onboarding']['stage'], 'active')
        self.assertTrue(billing.subscription_active(self.store, business))

    def test_expired_period_blocks_access_even_without_webhook(self):
        business = self.paid()
        self.store.db.execute('UPDATE subscriptions SET period_end=?', (time.time() - 1,))
        self.assertFalse(billing.subscription_active(self.store, business))

    def test_paid_owner_cannot_start_another_subscription(self):
        self.paid()
        self.http.reset_mock()
        with self.assertRaises(ValueError):
            self.checkout()
        self.http.assert_not_called()

    def test_repeat_checkout_reuses_open_session(self):
        first = self.checkout()
        self.session['status'] = 'open'
        self.store.db.execute('UPDATE signups SET consent_at=?', (time.time() - 7200,))
        self.http.reset_mock()
        self.assertEqual(self.checkout(), first)
        self.assertTrue(all(call.kwargs.get('method') != 'POST' for call in self.http.call_args_list))
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM signups').fetchone()[0], 1)

    def test_unknown_checkout_status_never_creates_another_session(self):
        self.checkout()
        self.session['status'] = 'unknown'
        self.http.reset_mock()
        with self.assertRaisesRegex(ValueError, 'unknown status'):
            self.checkout()
        self.assertTrue(all(call.kwargs.get('method') != 'POST' for call in self.http.call_args_list))

    def test_old_ambiguous_checkout_requires_reconciliation(self):
        self.checkout()
        self.store.db.execute('UPDATE signups SET session_id=NULL,consent_at=?', (time.time() - 24 * 3600,))
        self.http.reset_mock()
        with self.assertRaisesRegex(ValueError, 'reconciliation'):
            self.checkout()
        self.assertTrue(all(call.kwargs.get('method') != 'POST' for call in self.http.call_args_list))

    def test_simultaneous_checkout_is_blocked(self):
        self.store.db.execute('INSERT INTO checkout_locks VALUES(?,?,?)', ('923001234567', 'other-request', time.time() + 60))
        with self.assertRaises(ValueError):
            self.checkout()
        self.http.assert_not_called()


if __name__ == '__main__':
    unittest.main()
