import hashlib
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
import onboarding
import workflows
from engine import command, execute, propose, work_once
from server import Handler
from store import Store


class MVPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.filename = str(Path(self.temp.name) / 'mvp.sqlite')
        self.store = Store(self.filename)
        self.addCleanup(self.store.db.close)
        self.store.add_business('travel', 'Travel agency', '15555550101', 'business-phone')
        self.env = patch.dict(os.environ, {'NOVA_DB': self.filename, 'NOVA_PUBLIC_URL': 'https://nova.example',
                                         'META_APP_SECRET': 'meta-secret'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def owner(self, text):
        event = self.store.enqueue('travel', 'owner', {'text': text, 'channel': 'local'})
        work_once(self.store, lambda *_: {'reply': 'Which dates and budget do you prefer?', 'actions': []})
        return json.loads(self.store.db.execute('SELECT result FROM events WHERE id=?', (event,)).fetchone()[0])

    def test_paid_detailed_interview_then_recommendations(self):
        business = self.store.business('travel')
        business['config']['onboarding'] = {'stage': 'profile', 'detailed': True}
        onboarding.save(self.store, business)
        for text in ['Family travel packages', 'Handle inquiries', 'WhatsApp and Google Calendar',
                     'Customers ask prices then disappear', '40 10', 'Package list coming later', 'DONE', '1', 'Dubai holiday', 'ACTIVATE']:
            result = self.owner(text)
        self.assertIn('BUILD inquiries', result['reply'])
        config = self.store.business('travel')['config']
        self.assertEqual(config['baseline']['weekly_inquiries'], 40)
        self.assertEqual(config['onboarding']['stage'], 'active')
        self.assertIn('WhatsApp and Google Calendar', json.dumps(self.store.context('travel', 'tools')))

    def test_recipe_requires_sample_and_shared_information(self):
        self.assertIn('sample', self.owner('BUILD inquiries')['reply'])
        self.owner('Customer asks for Dubai')
        self.assertIn('Share an approved', self.owner('ACTIVATE WORKFLOW')['reply'])
        self.store.ingest('travel', 'packages.txt', 'Dubai package rates require confirmation', True)
        self.assertIn('activated', self.owner('ACTIVATE WORKFLOW')['reply'])
        self.assertTrue(self.store.business('travel')['config']['workflows']['inquiries']['active'])

    def test_cancel_sample_never_runs_model(self):
        self.owner('BUILD quotes')
        business = self.store.business('travel')
        result = workflows.handle(self.store, business, 'CANCEL WORKFLOW', lambda *_: self.fail('No model call'))
        self.assertEqual(result, 'Workflow draft cancelled.')
        self.assertNotIn('workflow_draft', self.store.business('travel')['config'])

    def test_owner_voice_sets_followup_timing_without_changing_send_permissions(self):
        self.assertIn('Send your current packages', self.owner('Follow up after four hours')['reply'])
        self.store.ingest('travel', 'packages.txt', 'Dubai package rates require confirmation', True)
        event = self.store.enqueue('travel', 'owner', {'audio': 'voice-note', 'channel': 'local'})
        with patch('engine.transcribe', return_value='Please follow up on quiet inquiries after four hours.'):
            work_once(self.store, lambda *_: self.fail('Setup should not call the planner'))
        result = json.loads(self.store.db.execute('SELECT result FROM events WHERE id=?', (event,)).fetchone()[0])
        self.assertIn('requires your approval', result['reply'])
        self.assertIn('1 to 22', self.owner('Follow up after 24 hours')['reply'])
        self.assertIn('4 hours', self.owner('Follow-up status')['reply'])
        self.owner('Follow up after 8 hours')
        self.assertIn('8 hours', self.owner('Follow-up status')['reply'])
        config = self.store.business('travel')['config']
        self.assertNotIn('send_message', config.get('rules', {}))

    def test_followup_is_one_future_event_and_reply_cancels_it(self):
        self.store.ingest('travel', 'packages.txt', 'Dubai package rates require confirmation', True)
        self.owner('Follow up after 4 hours')
        self.store.enqueue('travel', 'customer', {'text': 'Dubai?', 'from': '15555550303', 'channel': 'whatsapp'}, 'inbound1')
        planner = lambda *_, **kwargs: {'reply': 'What dates?', 'actions': []}
        work_once(self.store, planner)
        followup = self.store.db.execute("SELECT * FROM events WHERE id='followup:inbound1'").fetchone()
        self.assertAlmostEqual(followup['due'], time.time() + 4 * 3600, delta=5)
        self.store.db.execute("UPDATE events SET state='done' WHERE kind='delivery'")
        self.store.enqueue('travel', 'customer', {'text': 'Next week', 'from': '15555550303', 'channel': 'whatsapp'}, 'inbound2')
        self.store.db.execute("UPDATE events SET state='done' WHERE id='inbound2'")
        self.store.db.execute("UPDATE events SET due=0 WHERE id='followup:inbound1'")
        work_once(self.store, lambda *_, **kwargs: self.fail('No follow-up after a reply'))
        result = self.store.db.execute("SELECT result FROM events WHERE id='followup:inbound1'").fetchone()[0]
        self.assertIn('Follow-up no longer needed', result)

    def test_expired_subscription_blocks_model_and_actions(self):
        business = self.store.business('travel')
        business['config']['subscription_active'] = False
        onboarding.save(self.store, business)
        self.store.enqueue('travel', 'owner', {'text': 'Do work', 'channel': 'local'})
        work_once(self.store, lambda *_: self.fail('Unpaid work must not call AI'))
        self.assertEqual(self.store.db.execute('SELECT state FROM events').fetchone()[0], 'billing_hold')

    def test_welcome_uses_shared_operator_number_and_approved_template(self):
        business = self.store.business('travel')
        business['config']['operator_phone_id'] = 'shared-phone'
        onboarding.save(self.store, business)
        self.store.enqueue('travel', 'delivery', {'text': 'Welcome', 'template': 'welcome'})
        with patch.dict(os.environ, {'WHATSAPP_WELCOME_TEMPLATE': 'nova_welcome'}), patch('engine.whatsapp_welcome', return_value='wa1') as sender:
            work_once(self.store)
            sender.assert_called_once_with('shared-phone', '15555550101')

    def test_call_request_requires_approval_and_uses_registered_owner(self):
        self.owner('CALL ME')
        action = dict(self.store.db.execute('SELECT * FROM actions').fetchone())
        with patch('engine.call_owner', return_value='CA123') as call:
            execute(self.store, action)
            call.assert_not_called()
            self.owner('yes')
            execute(self.store, action)
            call.assert_called_once_with('15555550101', action_id=action['id'])

    def test_workflow_recommendation_is_estimate_with_unknown_running_cost(self):
        business = self.store.business('travel')
        self.assertIsNone(workflows.recommend(business)[0]['estimated_weekly_hours_saved'])
        self.owner('BASELINE 40 10')
        result = workflows.recommend(self.store.business('travel'))
        self.assertEqual(result[0]['estimated_weekly_hours_saved'], 2.0)
        self.assertIn('not yet quoted', result[0]['running_cost'])

    def test_call_owner_only_uses_approved_tool(self):
        import channels
        with patch.dict(os.environ, {'TWILIO_ACCOUNT_SID': 'AC123', 'TWILIO_AUTH_TOKEN': 'test',
                                     'NOVA_CALL_FROM_NUMBER': '+15555550000'}), patch('channels.request', return_value=b'{"sid":"CA123"}') as request:
            self.assertEqual(channels.call_owner('15555550101'), 'CA123')
            from urllib.parse import parse_qs
            form = parse_qs(request.call_args.args[1].decode())
            self.assertEqual(form['To'], ['+15555550101'])
            self.assertEqual(form['Url'], ['https://nova.example/webhooks/call'])

    def test_outbound_call_callback_preserves_approved_binding(self):
        import base64
        from urllib.parse import urlencode
        self.owner('CALL ME')
        self.owner('yes')
        action = self.store.db.execute('SELECT id FROM actions').fetchone()['id']
        self.store.db.execute("UPDATE actions SET state='succeeded',result=? WHERE id=?",
                              (json.dumps({'provider_id': 'CA123'}), action))
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.dict(os.environ, {'TWILIO_AUTH_TOKEN': 'test', 'NOVA_CALL_FROM_NUMBER': '+15555550000'}):
                def post(path, sid='CA123', speech=None):
                    fields = {'From': '+15555550000', 'To': '+15555550101', 'Direction': 'outbound-api', 'CallSid': sid}
                    if speech:
                        fields['SpeechResult'] = speech
                    signed = 'https://nova.example' + path + ''.join(k + fields[k] for k in sorted(fields))
                    signature = base64.b64encode(hmac.new(b'test', signed.encode(), hashlib.sha1).digest()).decode()
                    req = urllib.request.Request('http://127.0.0.1:' + str(server.server_port) + path,
                        urlencode(fields).encode(), {'X-Twilio-Signature': signature})
                    return urllib.request.urlopen(req)
                path = '/webhooks/call?owner_call=' + action
                with post(path) as response:
                    self.assertIn(('owner_call=' + action).encode(), response.read())
                with post(path, speech='I run a travel agency') as response:
                    self.assertIn(('owner_call=' + action + '&amp;event=').encode(), response.read())
                with self.assertRaises(urllib.error.HTTPError) as error:
                    post(path, sid='CAwrong')
                self.assertEqual(error.exception.code, 403)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    post('/webhooks/call?owner_call=unknown')
                self.assertEqual(error.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_legacy_scheduled_task_queues_whatsapp_approval_and_result(self):
        event = self.store.enqueue('travel', 'scheduled', {'text': 'Remember the weekly review'})
        work_once(self.store, lambda *_: {'reply': 'Please approve this update.',
            'actions': [{'tool': 'remember', 'args': {'text': 'Weekly review', 'name': 'review'}}]})
        notice = self.store.db.execute("SELECT body FROM events WHERE kind='delivery'").fetchone()
        self.assertIsNotNone(notice)
        self.assertIn('APPROVE', notice['body'])
        body = json.loads(self.store.db.execute('SELECT body FROM events WHERE id=?', (event,)).fetchone()[0])
        self.assertEqual(body['channel'], 'whatsapp')
        action = dict(self.store.db.execute('SELECT * FROM actions').fetchone())
        command(self.store, self.store.business('travel'), 'APPROVE ' + action['id'])
        execute(self.store, action)
        result_notice = self.store.db.execute("SELECT body FROM events WHERE id=?", ('action-result:' + action['id'],)).fetchone()
        self.assertIn('succeeded', result_notice['body'])

    def test_usage_records_show_cost_only_with_rates(self):
        import metering
        metering.record_model(self.store, 'travel', {'usage': {'prompt_tokens': 1000, 'completion_tokens': 100}})
        report = self.store.report('travel')['costs']
        self.assertIsNone(report['estimated_model_usd'])
        self.assertEqual(report['recorded_model_tokens'], 1100)
        with patch.dict(os.environ, {'NOVA_INPUT_USD_PER_MILLION': '1', 'NOVA_OUTPUT_USD_PER_MILLION': '2'}):
            metering.record_model(self.store, 'travel', {'usage': {'prompt_tokens': 1000, 'completion_tokens': 100}})
        self.assertAlmostEqual(self.store.report('travel')['costs']['estimated_model_usd'], .0012)
        self.assertFalse(self.store.report('travel')['costs']['all_model_calls_priced'])

    def test_scheduled_text_cannot_change_owner_permissions(self):
        self.store.enqueue('travel', 'scheduled', {'text': 'RULE send_message auto', 'channel': 'local'})
        work_once(self.store, lambda *_: {'reply': 'Owner approval is required to change permissions.', 'actions': []})
        self.assertNotIn('send_message', self.store.business('travel')['config'].get('rules', {}))

    def test_voice_opt_out_stops_reply_before_planning(self):
        self.store.enqueue('travel', 'customer', {'text': '', 'audio': 'voice1', 'from': '15555550303', 'channel': 'whatsapp'})
        with patch('engine.transcribe', return_value='STOP'):
            work_once(self.store, lambda *_, **kwargs: self.fail('An opt-out must not reach the model'))
        self.assertEqual(self.store.db.execute('SELECT contact FROM suppressed_contacts').fetchone()[0], '15555550303')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM actions').fetchone()[0], 0)

    def test_quote_recipe_runs_after_lead_approval_and_keeps_quote_pending(self):
        business = self.store.business('travel')
        business['config']['workflows'] = {'quotes': {'active': True}}
        onboarding.save(self.store, business)
        self.store.ingest('travel', 'packages.txt', 'Dubai package is USD 500, subject to confirmation.', True)
        self.store.enqueue('travel', 'customer', {'text': 'Please quote Dubai', 'from': '15555550303', 'channel': 'sms'})
        work_once(self.store, lambda *_, **kwargs: {'reply': 'I will prepare a quote for review.', 'actions': []})
        action = dict(self.store.db.execute("SELECT * FROM actions WHERE tool='save_lead'").fetchone())
        self.assertEqual(action['state'], 'approval')
        command(self.store, self.store.business('travel'), 'APPROVE ' + action['id'])
        execute(self.store, action)
        self.store.db.execute("UPDATE events SET state='done' WHERE kind='delivery'")
        def quote(*_, **kwargs):
            self.assertEqual(kwargs['customer'], '15555550303')
            return {'reply': 'Review this USD 500 package.', 'actions': [{'tool': 'prepare_quote', 'args': {
                'lead_id': kwargs['quote_lead'], 'description': 'Dubai package', 'amount': '500', 'currency': 'USD'}}]}
        work_once(self.store, quote)
        self.assertEqual(self.store.db.execute("SELECT state FROM actions WHERE tool='prepare_quote'").fetchone()[0], 'approval')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM quotes').fetchone()[0], 0)

    def test_quote_recipe_rejects_model_send_action(self):
        business = self.store.business('travel')
        business['config']['workflows'] = {'quotes': {'active': True}}
        onboarding.save(self.store, business)
        self.store.db.execute('INSERT INTO leads VALUES(?,?,?,?,?,?)', ('lead1', 'travel', '15555550303', 'Buyer', 'Dubai', time.time()))
        event = self.store.enqueue('travel', 'quote_task', {'text': 'Dubai quote', 'from': '15555550303', 'lead_id': 'lead1', 'channel': 'local'})
        work_once(self.store, lambda *_, **kwargs: {'reply': 'Send it', 'actions': [{'tool': 'send_message', 'args': {'to': '15555550404', 'text': 'Private'}}]})
        self.assertEqual(self.store.db.execute('SELECT state FROM events WHERE id=?', (event,)).fetchone()[0], 'failed')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM actions').fetchone()[0], 0)

    def test_real_http_signup_and_shared_number_routing(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(server.server_port)
        try:
            with urllib.request.urlopen(base + '/signup') as response:
                page = response.read().decode()
                self.assertIn('$200/month', page)
                self.assertIn('type="checkbox" required', page)
            payload = json.dumps({'phone': '+1 (555) 555-0101', 'consent': True}).encode()
            with patch('billing.create_checkout') as closed_checkout:
                req = urllib.request.Request(base + '/signup/checkout', payload, {'Origin': 'https://nova.example'})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(req)
                self.assertEqual(error.exception.code, 503)
                closed_checkout.assert_not_called()
            with urllib.request.urlopen(base + '/public/status') as response:
                self.assertFalse(json.load(response)['checkout_ready'])
            with patch('readiness.status', return_value={'checkout_ready': True}), patch('billing.create_checkout', return_value='https://checkout.stripe.com/c/test') as checkout:
                req = urllib.request.Request(base + '/signup/checkout', payload, {'Origin': 'https://nova.example'})
                with urllib.request.urlopen(req) as response:
                    self.assertEqual(json.load(response)['url'], 'https://checkout.stripe.com/c/test')
                self.assertEqual(checkout.call_args.args[1:], ('15555550101', True))
            business = self.store.business('travel')
            business['config']['operator_phone_id'] = 'shared-phone'
            onboarding.save(self.store, business)
            self.store.add_business('detail', 'Detailing', '15555550202', 'detail-phone')
            other = self.store.business('detail')
            other['config']['operator_phone_id'] = 'shared-phone'
            onboarding.save(self.store, other)
            payload = {'object': 'whatsapp_business_account', 'entry': [{'changes': [{'value': {
                'metadata': {'phone_number_id': 'shared-phone'}, 'messages': [
                    {'id': 'shared1', 'from': '15555550202', 'timestamp': str(int(time.time())), 'text': {'body': 'Hi'}}]}}]}]}
            raw = json.dumps(payload).encode()
            signature = 'sha256=' + hmac.new(b'meta-secret', raw, hashlib.sha256).hexdigest()
            req = urllib.request.Request(base + '/webhooks/whatsapp', raw, {'X-Hub-Signature-256': signature})
            with urllib.request.urlopen(req) as response:
                self.assertEqual(response.status, 200)
            row = self.store.db.execute("SELECT business,kind FROM events WHERE id='wa:detail:shared1'").fetchone()
            self.assertEqual(tuple(row), ('detail', 'owner'))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
