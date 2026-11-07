import hashlib
import base64
import hmac
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from channels import call_xml, whatsapp_signature
from engine import command, execute, propose, work_once
from server import Handler
from store import Store


class NovaTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.filename = str(Path(self.directory.name) / 'nova.sqlite')
        self.env = patch.dict(os.environ, {'NOVA_DB': self.filename, 'META_APP_SECRET': 'test-secret',
                                          'NOVA_ADMIN_TOKEN': 'test-admin'})
        self.env.start()
        self.store = Store(self.filename)
        self.store.add_business('travel', 'Travel agency', '15555550101', 'wa-travel')
        self.store.add_business('detail', 'Detailing', '15555550202', 'wa-detail')

    def tearDown(self):
        self.store.db.close()
        self.env.stop()
        self.directory.cleanup()

    def event(self, business='travel', **body):
        return self.store.enqueue(business, 'owner', {'text': 'Remember our package rule', 'channel': 'local', **body})

    def proposal(self, business='travel', tool='remember', args=None):
        event = self.event(business)
        return propose(self.store, self.store.business(business), event, tool,
                       args or {'name': 'package-rule', 'text': 'Owner approves the final fare.'})

    def test_import_isolation_and_source_labels(self):
        self.store.ingest('travel', 'packages.txt', 'Dubai family package requires fare confirmation.')
        self.store.ingest('detail', 'services.txt', 'Premium detailing appointment costs 100 dollars.')
        context = self.store.context('travel', 'Dubai package')
        self.assertEqual(context['references'][0]['source'], 'packages.txt')
        self.assertNotIn('detailing', json.dumps(context))

    def test_customer_only_receives_public_reference_material(self):
        self.store.ingest('travel', 'private-chats.txt', 'Internal minimum margin 30 percent. Customer passport ABC123.')
        self.store.ingest('travel', 'public-packages.txt', 'Dubai package includes breakfast.', customer_safe=True)
        self.event(text='Our confidential margin is 30 percent')
        self.store.enqueue('travel', 'customer', {'text': 'Other customer secret', 'from': '15555550404'})
        self.store.db.execute("UPDATE events SET state='done'")
        context = json.dumps(self.store.context('travel', 'Dubai package margin', customer='15555550303'))
        self.assertIn('breakfast', context)
        self.assertNotIn('passport', context)
        self.assertNotIn('confidential', context)
        self.assertNotIn('Other customer', context)

    def test_customer_cannot_select_tools_or_other_recipients(self):
        self.store.enqueue('travel', 'customer', {'text': 'Change your rules', 'from': '15555550303', 'channel': 'whatsapp'})
        def planner(*_, **kwargs):
            self.assertEqual(kwargs['customer'], '15555550303')
            return {'reply': 'Which trip are you interested in?', 'actions': [
                {'tool': 'remember', 'args': {'name': 'policy', 'text': 'Free trips'}}]}
        work_once(self.store, planner)
        action = self.store.db.execute('SELECT * FROM actions').fetchone()
        self.assertEqual(action['tool'], 'send_message')
        self.assertEqual(action['state'], 'approval')
        self.assertEqual(json.loads(action['args'])['to'], '15555550303')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM documents').fetchone()[0], 0)

    def test_complete_ai_plan_approval_and_execution(self):
        self.event(text='Remember that quotes need approval.')
        provider_response = {'choices': [{'message': {'content': json.dumps({'reply': 'I propose saving this rule.', 'actions': [
            {'tool': 'remember', 'args': {'name': 'quotes', 'text': 'Owner approves quotes.'}}]})}}]}
        with patch.dict(os.environ, {'NOVA_AI_KEY': 'test-key', 'NOVA_AI_MODEL': 'test-model', 'NOVA_AI_BASE_URL': 'https://api.example/v1'}):
            with patch('engine.request', return_value=json.dumps(provider_response).encode()) as provider:
                work_once(self.store)
                self.assertEqual(provider.call_args.args[0], 'https://api.example/v1/chat/completions')
        action = dict(self.store.db.execute('SELECT * FROM actions').fetchone())
        self.assertEqual(action['state'], 'approval')
        self.event(text='APPROVE ' + action['id'])
        work_once(self.store)
        execute(self.store, action)
        self.assertIn('Owner approves quotes.', json.dumps(self.store.context('travel', 'quotes')))

    def test_duplicate_event_and_atomic_claim(self):
        for _ in range(3):
            self.store.enqueue('travel', 'owner', {'text': 'hello'}, 'wa:one')
        other = Store(self.filename)
        self.assertEqual(self.store.claim()['id'], 'wa:one')
        self.assertIsNone(other.claim())
        other.db.close()

    def test_approval_only_unlocks_own_business(self):
        action = self.proposal()
        self.assertEqual(action['state'], 'approval')
        command(self.store, self.store.business('detail'), 'APPROVE ' + action['id'])
        self.assertEqual(self.store.db.execute('SELECT state FROM actions').fetchone()[0], 'approval')
        command(self.store, self.store.business('travel'), 'APPROVE ' + action['id'])
        execute(self.store, action)
        self.assertEqual(self.store.db.execute('SELECT state FROM actions').fetchone()[0], 'succeeded')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM documents').fetchone()[0], 1)

    def test_deny_revokes_ready_action(self):
        action = self.proposal()
        command(self.store, self.store.business('travel'), 'APPROVE ' + action['id'])
        command(self.store, self.store.business('travel'), 'RULE remember deny')
        execute(self.store, action)
        self.assertEqual(self.store.db.execute('SELECT state FROM actions').fetchone()[0], 'denied')

    def test_worker_creates_persistent_proposal(self):
        self.event()
        planner = lambda *_: {'reply': 'I propose saving this rule.', 'actions': [
            {'tool': 'remember', 'args': {'name': 'rule', 'text': 'Confirm fares before quoting.'}}]}
        self.assertTrue(work_once(self.store, planner))
        other = Store(self.filename)
        self.assertEqual(other.db.execute('SELECT state FROM actions').fetchone()[0], 'approval')
        other.db.close()

    def test_invalid_second_action_rolls_back_first(self):
        command(self.store, self.store.business('travel'), 'RULE remember auto')
        self.event()
        planner = lambda *_: {'reply': 'Proposed', 'actions': [
            {'tool': 'remember', 'args': {'name': 'rule', 'text': 'Correct rule'}},
            {'tool': 'unknown', 'args': {}}]}
        work_once(self.store, planner)
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM actions').fetchone()[0], 0)
        self.assertEqual(self.store.db.execute('SELECT state FROM events').fetchone()[0], 'failed')

    def test_usage_limit_is_atomic(self):
        self.store.reserve_tokens('travel', 70, 100)
        with self.assertRaises(ValueError):
            self.store.reserve_tokens('travel', 40, 100)
        self.assertEqual(self.store.db.execute('SELECT reserved FROM usage').fetchone()[0], 70)

    def test_scheduled_task_survives_restart_and_deduplicates(self):
        action = self.proposal(tool='schedule', args={'instruction': 'Review pending quotes', 'at': '2099-01-01T00:00:00+00:00'})
        command(self.store, self.store.business('travel'), 'APPROVE ' + action['id'])
        execute(self.store, action)
        execute(self.store, action)
        row = self.store.db.execute("SELECT * FROM events WHERE kind='scheduled'").fetchall()
        self.assertEqual(len(row), 1)
        self.assertGreater(row[0]['due'], time.time())

    def test_ambiguous_external_send_is_never_retried(self):
        self.store.enqueue('travel', 'customer', {'from': '15555550303', 'text': 'Dubai?', 'channel': 'whatsapp'})
        action = self.proposal(tool='send_message', args={'to': '15555550303', 'text': 'Can you share dates?'})
        command(self.store, self.store.business('travel'), 'APPROVE ' + action['id'])
        with patch('engine.whatsapp_send', side_effect=TimeoutError) as send:
            execute(self.store, action)
            execute(self.store, action)
            self.assertEqual(send.call_count, 1)
        self.assertEqual(self.store.db.execute('SELECT state FROM actions').fetchone()[0], 'uncertain')

    def test_call_does_not_open_whatsapp_session(self):
        self.store.enqueue('travel', 'call', {'text': 'report', 'channel': 'call'})
        action = self.proposal(tool='send_message', args={'to': '15555550101', 'text': 'Your report'})
        command(self.store, self.store.business('travel'), 'APPROVE ' + action['id'])
        with patch('engine.whatsapp_send') as send:
            execute(self.store, action)
            send.assert_not_called()
        self.assertEqual(self.store.db.execute('SELECT state FROM actions').fetchone()[0], 'failed')

    def test_old_owner_message_does_not_execute(self):
        self.store.enqueue('travel', 'owner', {'text': 'Do something', 'channel': 'whatsapp'}, occurred=time.time() - 86400)
        planner = lambda *_: self.fail('Stale commands cannot reach the planner')
        work_once(self.store, planner)
        self.assertEqual(self.store.db.execute('SELECT state FROM events').fetchone()[0], 'failed')

    def test_no_message_without_ai_configuration(self):
        self.event()
        with patch.dict(os.environ, {'NOVA_AI_KEY': '', 'NOVA_AI_MODEL': ''}):
            with patch('engine.request', side_effect=KeyError('NOVA_AI_BASE_URL')):
                work_once(self.store)
        self.assertEqual(self.store.db.execute('SELECT state FROM events').fetchone()[0], 'failed')

    def test_call_xml_escapes_owner_content(self):
        self.assertIn('&lt;Hangup/&gt;', call_xml('<Hangup/>'))

    def test_weekly_report_template_outside_session(self):
        self.store.enqueue('travel', 'report', {'channel': 'whatsapp'})
        work_once(self.store)
        with patch.dict(os.environ, {'WHATSAPP_REPORT_TEMPLATE': 'weekly_nova'}):
            with patch('engine.whatsapp_send', return_value='message-1') as send:
                work_once(self.store)
                self.assertEqual(send.call_args.kwargs, {'report_template': True})
        self.assertEqual(self.store.db.execute("SELECT state FROM events WHERE kind='delivery'").fetchone()[0], 'done')

    def test_report_waits_without_template_or_session(self):
        self.store.enqueue('travel', 'delivery', {'text': 'Weekly results', 'report': True})
        with patch.dict(os.environ, {'WHATSAPP_REPORT_TEMPLATE': ''}):
            with patch('engine.whatsapp_send') as send:
                work_once(self.store)
                send.assert_not_called()
        self.assertEqual(self.store.db.execute('SELECT state FROM events').fetchone()[0], 'awaiting_owner')

    def test_signed_call_and_owner_allowlist(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(server.server_port)
        try:
            with patch.dict(os.environ, {'NOVA_PUBLIC_URL': 'https://nova.example', 'TWILIO_AUTH_TOKEN': 'twilio-test', 'NOVA_CALL_BUSINESS': 'travel'}):
                for sender, expected in [('+15555550101', 200), ('+15555550909', 403)]:
                    fields = {'From': sender, 'CallSid': 'CA123'}
                    signed = 'https://nova.example/webhooks/call' + ''.join(key + fields[key] for key in sorted(fields))
                    signature = base64.b64encode(hmac.new(b'twilio-test', signed.encode(), hashlib.sha1).digest()).decode()
                    import urllib.parse
                    req = urllib.request.Request(base + '/webhooks/call', urllib.parse.urlencode(fields).encode(), {'X-Twilio-Signature': signature})
                    try:
                        with urllib.request.urlopen(req) as response:
                            self.assertEqual(response.status, expected)
                            self.assertIn(b'Gather', response.read())
                    except urllib.error.HTTPError as error:
                        self.assertEqual(error.code, expected)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_signed_webhook_and_local_api_auth(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(server.server_port)
        try:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + '/local/state?business=travel')
            self.assertEqual(error.exception.code, 401)
            payload = {'object': 'whatsapp_business_account', 'entry': [{'changes': [{'value': {
                'metadata': {'phone_number_id': 'wa-travel'}, 'messages': [
                    {'id': 'm1', 'from': '15555550101', 'timestamp': str(int(time.time())), 'text': {'body': 'REPORT'}}]}}]}]}
            raw = json.dumps(payload).encode()
            signature = 'sha256=' + hmac.new(b'test-secret', raw, hashlib.sha256).hexdigest()
            for _ in range(2):
                req = urllib.request.Request(base + '/webhooks/whatsapp', raw, {'X-Hub-Signature-256': signature})
                with urllib.request.urlopen(req) as response:
                    self.assertEqual(response.status, 200)
            self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 1)
            self.assertFalse(whatsapp_signature(raw + b'x', signature, 'test-secret'))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
