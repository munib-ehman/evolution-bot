"""Offline Google OAuth/Calendar contract tests; every provider request is mocked."""
import concurrent.futures
import hashlib
import io
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import connections
from store import Store


class ConnectionsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.filename = str(Path(self.directory.name) / 'nova.sqlite')
        self.env = patch.dict(os.environ, {
            'GOOGLE_CLIENT_ID': 'client-id', 'GOOGLE_CLIENT_SECRET': 'client-secret',
            'NOVA_PUBLIC_URL': 'https://nova.example/base/',
            'NOVA_TOKEN_ENCRYPTION_KEY': Fernet.generate_key().decode()})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.store = Store(self.filename)
        self.addCleanup(self.store.db.close)
        self.store.add_business('travel', 'Travel', '15555550101', 'wa-travel')
        self.store.add_business('detail', 'Detail', '15555550202', 'wa-detail')
        connections.setup(self.store)
        self.request = patch.object(connections.channels, 'request').start()
        self.addCleanup(patch.stopall)
        self.request.side_effect = AssertionError('Unexpected provider request')
        self.args = {'summary': 'Family trip', 'start': '2026-12-01T10:00:00+05:00',
                     'end': '2026-12-01T11:00:00+05:00', 'timezone': 'Asia/Karachi'}

    def token_response(self, **changes):
        result = {'access_token': 'access-secret', 'refresh_token': 'refresh-secret',
                  'expires_in': 3600, 'token_type': 'Bearer',
                  'scope': connections.REQUIRED_SCOPE}
        result.update(changes)
        return result

    def state(self, business='travel'):
        link = connections.connection_link(self.store, business)
        return urllib.parse.parse_qs(urllib.parse.urlsplit(link['url']).query)['state'][0]

    def connect(self, business='travel', response=None):
        state = self.state(business)
        self.request.side_effect = None
        self.request.return_value = json.dumps(response or self.token_response()).encode()
        result = connections.callback(self.store, state, 'authorization-secret')
        self.request.reset_mock()
        return result

    def stored(self, business='travel'):
        row = self.store.db.execute('SELECT tokens FROM connections WHERE business=?', (business,)).fetchone()
        cipher = Fernet(os.environ['NOVA_TOKEN_ENCRYPTION_KEY'].encode())
        return json.loads(cipher.decrypt(row['tokens']))

    def respond_event(self, url, data=None, headers=None, method=None):
        return json.dumps({'id': json.loads(data)['id']}).encode()

    def http_error(self, status):
        return urllib.error.HTTPError(connections.EVENTS_URL, status,
                                      'access-secret client-secret', {},
                                      io.BytesIO(b'refresh-secret authorization-secret'))

    def test_setup_is_idempotent_without_environment_or_network(self):
        with patch.dict(os.environ, {}, clear=True):
            connections.setup(self.store)
            connections.setup(self.store)
        tables = {row[0] for row in self.store.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({'oauth_states', 'connections'} <= tables)
        self.request.assert_not_called()

    def test_setup_does_not_commit_existing_transaction(self):
        self.store.db.execute('BEGIN')
        connections.setup(self.store)
        self.assertTrue(self.store.db.in_transaction)
        self.store.db.execute('ROLLBACK')

    def test_link_is_real_offline_consent_url_bound_to_business(self):
        before = time.time()
        result = connections.connection_link(self.store, 'travel')
        url = urllib.parse.urlsplit(result['url'])
        query = urllib.parse.parse_qs(url.query)
        self.assertEqual(url.scheme + '://' + url.netloc + url.path, connections.AUTH_URL)
        self.assertEqual(query['client_id'], ['client-id'])
        self.assertEqual(query['redirect_uri'], ['https://nova.example/base/connections/google/callback'])
        self.assertEqual(query['scope'], [connections.REQUIRED_SCOPE])
        self.assertEqual(query['response_type'], ['code'])
        self.assertEqual(query['access_type'], ['offline'])
        self.assertEqual(query['prompt'], ['consent'])
        state = query['state'][0]
        self.assertGreaterEqual(len(state), 40)
        row = dict(self.store.db.execute('SELECT * FROM oauth_states').fetchone())
        self.assertEqual(row['business'], 'travel')
        self.assertEqual(row['owner'], '15555550101')
        self.assertEqual(row['state_hash'], hashlib.sha256(state.encode()).hexdigest())
        self.assertNotIn(state, json.dumps(row))
        self.assertGreaterEqual(row['expires'], before + connections.STATE_TTL)
        self.assertNotIn('client-secret', result['url'])
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM actions').fetchone()[0], 0)
        self.request.assert_not_called()

    def test_link_rejects_unknown_business_and_bad_configuration(self):
        with self.assertRaises(ValueError):
            self.state('unknown')
        cases = [('NOVA_PUBLIC_URL', 'http://nova.example'),
                 ('NOVA_PUBLIC_URL', 'https://user:password@nova.example'),
                 ('NOVA_PUBLIC_URL', 'https://nova.example?secret=yes'),
                 ('NOVA_PUBLIC_URL', 'https://nova.example/#fragment'),
                 ('GOOGLE_CLIENT_ID', ''), ('GOOGLE_CLIENT_SECRET', ''),
                 ('NOVA_TOKEN_ENCRYPTION_KEY', 'not-a-key')]
        for key, value in cases:
            with self.subTest(key=key, value=value), patch.dict(os.environ, {key: value}):
                with self.assertRaises(ValueError):
                    self.state()
        self.request.assert_not_called()

    def test_callback_consumes_durably_before_exchange_and_encrypts(self):
        state = self.state()
        def exchange(url, data, headers, method=None):
            other = Store(self.filename)
            try:
                self.assertEqual(other.db.execute('SELECT COUNT(*) FROM oauth_states').fetchone()[0], 0)
            finally:
                other.db.close()
            self.assertFalse(self.store.db.in_transaction)
            self.assertEqual(url, connections.TOKEN_URL)
            self.assertEqual(method, 'POST')
            fields = urllib.parse.parse_qs(data.decode())
            self.assertEqual(fields['code'], ['authorization-secret'])
            self.assertEqual(fields['client_secret'], ['client-secret'])
            self.assertEqual(fields['grant_type'], ['authorization_code'])
            self.assertEqual(fields['redirect_uri'], ['https://nova.example/base/connections/google/callback'])
            self.assertEqual(headers['Content-Type'], 'application/x-www-form-urlencoded')
            return json.dumps(self.token_response()).encode()
        self.request.side_effect = exchange
        result = connections.callback(self.store, state, 'authorization-secret')
        self.assertEqual(result, {'status': 'connected', 'business_id': 'travel', 'provider': 'google'})
        row = dict(self.store.db.execute('SELECT * FROM connections').fetchone())
        for secret in ('access-secret', 'refresh-secret', 'authorization-secret', 'client-secret'):
            self.assertNotIn(secret, str(row))
            self.assertNotIn(secret, json.dumps(result))
        self.assertEqual(self.stored()['tokens']['refresh_token'], 'refresh-secret')
        self.assertEqual(self.stored()['business'], 'travel')
        self.assertEqual(connections.connection_link(self.store, 'travel'), {'status': 'connected'})
        self.assertEqual(self.request.call_count, 1)
        with self.assertRaises(ValueError):
            connections.callback(self.store, state, 'authorization-secret')
        self.assertEqual(self.request.call_count, 1)

    def test_reauth_preserves_refresh_and_replaces_it_when_present(self):
        states = [self.state() for _ in range(3)]
        self.request.side_effect = None
        self.request.return_value = json.dumps(self.token_response()).encode()
        connections.callback(self.store, states[0], 'first')
        response = self.token_response(access_token='replacement-access')
        del response['refresh_token']
        self.request.return_value = json.dumps(response).encode()
        connections.callback(self.store, states[1], 'second')
        self.assertEqual(self.stored()['tokens']['refresh_token'], 'refresh-secret')
        self.assertEqual(self.stored()['tokens']['access_token'], 'replacement-access')
        self.request.return_value = json.dumps(self.token_response(refresh_token='replacement-refresh')).encode()
        connections.callback(self.store, states[2], 'third')
        self.assertEqual(self.stored()['tokens']['refresh_token'], 'replacement-refresh')

    def test_invalid_expired_denied_and_owner_changed_states_never_exchange(self):
        with self.assertRaises(ValueError):
            connections.callback(self.store, 'x' * 43, 'code')
        state = self.state()
        self.store.db.execute('UPDATE oauth_states SET expires=?', (time.time() - 1,))
        with self.assertRaises(ValueError):
            connections.callback(self.store, state, 'code')
        for code in (None, '', 123):
            state = self.state()
            with self.assertRaises(ValueError):
                connections.callback(self.store, state, code)
            self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM oauth_states').fetchone()[0], 0)
        state = self.state()
        self.store.db.execute("UPDATE businesses SET owner='15555550999' WHERE id='travel'")
        with self.assertRaises(ValueError):
            connections.callback(self.store, state, 'code')
        self.request.assert_not_called()

    def test_callback_rejects_changed_client_and_outer_transaction(self):
        state = self.state()
        self.store.db.execute('BEGIN')
        with self.assertRaisesRegex(ValueError, 'own database transaction'):
            connections.callback(self.store, state, 'code')
        self.store.db.execute('ROLLBACK')
        with patch.dict(os.environ, {'GOOGLE_CLIENT_ID': 'different-client'}):
            with self.assertRaises(ValueError):
                connections.callback(self.store, state, 'code')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM oauth_states').fetchone()[0], 0)
        self.request.assert_not_called()

    def test_failed_exchange_burns_state_and_hides_errors(self):
        for failure in (self.http_error(400), TimeoutError('access-secret'),
                        ValueError('client-secret'), b'not-json', b'{"error":"refresh-secret"}'):
            with self.subTest(failure=type(failure).__name__):
                state = self.state()
                self.request.side_effect = failure if isinstance(failure, Exception) else None
                self.request.return_value = failure
                with self.assertRaises(ValueError) as error:
                    connections.callback(self.store, state, 'authorization-secret')
                self.assertNotIn('secret', str(error.exception))
                self.assertTrue(error.exception.__suppress_context__)
                calls = self.request.call_count
                with self.assertRaises(ValueError):
                    connections.callback(self.store, state, 'authorization-secret')
                self.assertEqual(self.request.call_count, calls)
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM connections').fetchone()[0], 0)

    def test_scope_and_token_validation_fail_closed(self):
        bad = [{'scope': 'https://www.googleapis.com/auth/calendar.readonly'}, {'scope': None},
               {'scope': connections.REQUIRED_SCOPE + '.not-really'}, {'expires_in': -1},
               {'expires_in': True}, {'expires_in': float('nan')}, {'expires_in': '3600'},
               {'access_token': 'bad\r\nheader'}, {'token_type': 'Basic'}, {'refresh_token': ''}]
        for changes in bad + [{'scope': 'MISSING'}]:
            with self.subTest(changes=changes):
                state = self.state()
                response = self.token_response(**changes)
                if response['scope'] == 'MISSING':
                    del response['scope']
                self.request.side_effect = None
                self.request.return_value = json.dumps(response).encode()
                with self.assertRaises(ValueError):
                    connections.callback(self.store, state, 'code')
                self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM connections').fetchone()[0], 0)

    def test_failed_reauth_does_not_overwrite_existing_tokens(self):
        first, second = self.state(), self.state()
        self.request.side_effect = None
        self.request.return_value = json.dumps(self.token_response()).encode()
        connections.callback(self.store, first, 'first')
        old = self.stored()
        self.request.return_value = json.dumps(self.token_response(scope='wrong')).encode()
        with self.assertRaises(ValueError):
            connections.callback(self.store, second, 'second')
        self.assertEqual(self.stored(), old)

    def test_concurrent_callbacks_exchange_only_once(self):
        state = self.state()
        barrier = threading.Barrier(2)
        self.request.side_effect = None
        self.request.return_value = json.dumps(self.token_response()).encode()
        def run():
            store = Store(self.filename)
            try:
                barrier.wait(timeout=5)
                try:
                    return connections.callback(store, state, 'code')['status']
                except ValueError:
                    return 'rejected'
            finally:
                store.db.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: run(), range(2)))
        self.assertCountEqual(results, ['connected', 'rejected'])
        self.assertEqual(self.request.call_count, 1)

    def test_tokens_and_state_are_isolated_between_businesses(self):
        self.connect('travel')
        self.assertEqual(connections.connection_link(self.store, 'travel'), {'status': 'connected'})
        self.assertIn('url', connections.connection_link(self.store, 'detail'))
        with self.assertRaises(ValueError):
            connections.calendar_event(self.store, 'detail', 'action', self.args)
        encrypted = self.store.db.execute("SELECT tokens FROM connections WHERE business='travel'").fetchone()[0]
        self.store.db.execute("INSERT INTO connections VALUES('detail','google',?,?)", (encrypted, time.time()))
        with self.assertRaisesRegex(ValueError, 'securely'):
            connections.calendar_event(self.store, 'detail', 'action', self.args)
        self.request.assert_not_called()

    def test_wrong_key_and_tampering_never_send_plaintext(self):
        self.connect()
        with patch.dict(os.environ, {'NOVA_TOKEN_ENCRYPTION_KEY': Fernet.generate_key().decode()}):
            with self.assertRaisesRegex(ValueError, 'securely'):
                connections.calendar_event(self.store, 'travel', 'action', self.args)
        self.store.db.execute("UPDATE connections SET tokens=?", (b'tampered-access-secret',))
        with self.assertRaisesRegex(ValueError, 'securely'):
            connections.calendar_event(self.store, 'travel', 'action', self.args)
        self.request.assert_not_called()

    def test_calendar_event_payload_stable_id_and_tenant_namespace(self):
        self.connect()
        self.connect('detail', self.token_response(access_token='other-access', refresh_token='other-refresh'))
        self.request.side_effect = self.respond_event
        first = connections.calendar_event(self.store, 'travel', 'wa:action-1', self.args)
        url, data, headers = self.request.call_args.args
        body = json.loads(data)
        self.assertEqual(url, connections.EVENTS_URL)
        self.assertEqual(self.request.call_args.kwargs['method'], 'POST')
        self.assertEqual(headers['Authorization'], 'Bearer access-secret')
        self.assertEqual(body['summary'], self.args['summary'])
        self.assertEqual(body['start'], {'dateTime': self.args['start'], 'timeZone': 'Asia/Karachi'})
        self.assertRegex(body['id'], r'^[0-9a-v]{64}$')
        self.assertNotIn('attendees', body)
        repeated = connections.calendar_event(self.store, 'travel', 'wa:action-1', self.args)
        different_action = connections.calendar_event(self.store, 'travel', 'wa:action-2', self.args)
        other_tenant = connections.calendar_event(self.store, 'detail', 'wa:action-1', self.args)
        self.assertEqual(first['event_id'], repeated['event_id'])
        self.assertNotEqual(first['event_id'], different_action['event_id'])
        self.assertNotEqual(first['event_id'], other_tenant['event_id'])
        self.assertNotIn('secret', json.dumps(first))

    def test_calendar_reconciles_duplicates_and_rejects_changed_payload(self):
        self.connect()
        saved = {}
        def duplicate(url, data=None, headers=None, method=None):
            if method == 'POST':
                saved.setdefault('body', json.loads(data))
                raise self.http_error(409)
            self.assertEqual(url, connections.EVENTS_URL + '/' + saved['body']['id'])
            # Google may normalize timestamps to a different equivalent offset.
            body = json.loads(json.dumps(saved['body']))
            body['start']['dateTime'] = '2026-12-01T05:00:00Z'
            body['end']['dateTime'] = '2026-12-01T06:00:00Z'
            return json.dumps(body).encode()
        self.request.side_effect = duplicate
        result = connections.calendar_event(self.store, 'travel', 'action', self.args)
        self.assertEqual(result['status'], 'exists')
        with self.assertRaisesRegex(ValueError, 'different details'):
            connections.calendar_event(self.store, 'travel', 'action', {**self.args, 'summary': 'Changed'})
        saved['body']['start']['dateTime'] = '2026-12-02T10:00:00+05:00'
        saved['body']['status'] = 'cancelled'
        with self.assertRaisesRegex(ValueError, 'different details'):
            connections.calendar_event(self.store, 'travel', 'action', self.args)

    def test_refresh_is_encrypted_preserves_refresh_and_inherits_scope(self):
        self.connect(response=self.token_response(expires_in=1))
        old = self.stored()
        refreshed = self.token_response(access_token='new-access')
        del refreshed['refresh_token']
        del refreshed['scope']
        def respond(url, data=None, headers=None, method=None):
            if url == connections.TOKEN_URL:
                fields = urllib.parse.parse_qs(data.decode())
                self.assertEqual(fields['grant_type'], ['refresh_token'])
                self.assertEqual(fields['refresh_token'], ['refresh-secret'])
                return json.dumps(refreshed).encode()
            self.assertEqual(headers['Authorization'], 'Bearer new-access')
            return self.respond_event(url, data, headers, method)
        self.request.side_effect = respond
        connections.calendar_event(self.store, 'travel', 'action', self.args)
        self.assertEqual(self.request.call_count, 2)
        self.assertGreater(self.stored()['tokens']['expires_at'], old['tokens']['expires_at'])
        self.assertEqual(self.stored()['tokens']['refresh_token'], 'refresh-secret')
        self.assertEqual(self.stored()['tokens']['access_token'], 'new-access')
        raw = self.store.db.execute('SELECT tokens FROM connections').fetchone()[0]
        self.assertNotIn(b'new-access', raw)

    def test_refresh_failures_never_create_event_or_overwrite_tokens(self):
        self.connect(response=self.token_response(expires_in=1))
        old = self.stored()
        for response in (self.token_response(scope='wrong'), {'error': 'invalid_grant'}):
            self.request.side_effect = None
            self.request.return_value = json.dumps(response).encode()
            with self.assertRaises(ValueError):
                connections.calendar_event(self.store, 'travel', 'action', self.args)
            self.assertEqual(self.stored(), old)
            self.assertEqual(self.request.call_args.args[0], connections.TOKEN_URL)

    def test_expired_access_without_refresh_requires_new_link(self):
        response = self.token_response(expires_in=1)
        del response['refresh_token']
        self.connect(response=response)
        with self.assertRaisesRegex(ValueError, 'expired'):
            connections.calendar_event(self.store, 'travel', 'action', self.args)
        self.assertIn('url', connections.connection_link(self.store, 'travel'))
        self.request.assert_not_called()

    def test_invalid_calendar_input_is_rejected_before_network(self):
        self.connect()
        invalid = [{**self.args, 'start': '2026-12-01T10:00:00'},
                   {**self.args, 'start': '2026-12-01'},
                   {**self.args, 'end': self.args['start']},
                   {**self.args, 'end': '2026-12-01T09:00:00+05:00'},
                   {**self.args, 'summary': ' '}, {**self.args, 'timezone': 'Fake/Zone'},
                   {**self.args, 'timezone': 'UTC'}, {**self.args, 'attendees': []},
                   {'summary': 'x'}, None]
        for args in invalid:
            with self.subTest(args=args), self.assertRaises(ValueError):
                connections.calendar_event(self.store, 'travel', 'action', args)
        with self.assertRaises(ValueError):
            connections.calendar_event(self.store, 'travel', '', self.args)
        self.request.assert_not_called()

    def test_utc_and_offsets_do_not_require_named_zone(self):
        self.connect()
        self.request.side_effect = self.respond_event
        args = {'summary': 'UTC appointment', 'start': '2026-12-01T05:00:00Z',
                'end': '2026-12-01T06:00:00+00:00'}
        connections.calendar_event(self.store, 'travel', 'action', args)
        self.assertNotIn('timeZone', json.loads(self.request.call_args.args[1])['start'])

    def test_event_errors_and_wrong_provider_id_are_sanitized(self):
        self.connect()
        for error in (self.http_error(403), TimeoutError('access-secret'), ValueError('refresh-secret')):
            self.request.side_effect = error
            with self.assertRaises(ValueError) as caught:
                connections.calendar_event(self.store, 'travel', 'action', self.args)
            self.assertNotIn('secret', str(caught.exception))
        self.request.side_effect = None
        self.request.return_value = b'{"id":"wrong"}'
        with self.assertRaisesRegex(ValueError, 'expected Calendar event'):
            connections.calendar_event(self.store, 'travel', 'action', self.args)


if __name__ == '__main__':
    unittest.main()
