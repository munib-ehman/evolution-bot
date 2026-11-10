"""New work is persisted and grounded without sending or publishing."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from store import Store
import workproducts
from engine import work_once, command, propose, execute

class WorkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name + '/test.sqlite')
        self.store.add_business('a', 'Travel', '15555550101', 'a')
        self.store.ingest('a', 'Services', 'Family travel planning. Owner confirms pricing.', True)
        self.business = self.store.business('a')
        self.env = patch.dict(os.environ, {'NOVA_AI_PROVIDER': 'ollama', 'NOVA_AI_MODEL': 'llama3.2:3b'})
        self.env.start()

    def tearDown(self):
        self.env.stop(); self.store.db.close(); self.temp.cleanup()

    def answer(self, body='A grounded original article with useful headings.', kind='seo'):
        output = {'title': 'Family travel', 'body': body} if kind != 'seo' else {'title': 'Family travel', 'search_intent': 'Plan a family holiday', 'meta_description': 'A useful travel guide', 'article': body, 'publishing_checklist': 'Verify facts before publication'}
        return json.dumps({'choices': [{'message': {'content': json.dumps(output)}}], 'usage': {'prompt_tokens': 30, 'completion_tokens': 20}}).encode()

    def test_grounded_draft_is_persisted_without_external_actions(self):
        with patch('workproducts.request', return_value=self.answer()) as model:
            result = workproducts.generate(self.store, self.business, 'seo', 'Write a guide')
        payload = json.loads(model.call_args.args[1])
        self.assertIn('Services', payload['messages'][1]['content'])
        self.assertEqual(result['sources'], ['Services'])
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM actions').fetchone()[0], 0)
        self.assertEqual(self.store.db.execute('SELECT state FROM workproducts').fetchone()[0], 'ready')
        self.assertEqual(self.store.report('a')['costs']['recorded_model_tokens'], 50)

    def test_unknown_type_paused_and_missing_facts_do_not_call_model(self):
        with patch('workproducts.request') as model:
            with self.assertRaises(ValueError): workproducts.generate(self.store, self.business, 'publish', 'Go')
            self.business['config']['paused'] = True
            with self.assertRaises(ValueError): workproducts.generate(self.store, self.business, 'seo', 'Go')
            self.business['config']['paused'] = False
            self.store.db.execute('DELETE FROM documents')
            with self.assertRaises(ValueError): workproducts.generate(self.store, self.business, 'seo', 'Go')
            model.assert_not_called()

    def test_no_cross_business_sources(self):
        self.store.add_business('b', 'Other', '15555550102', 'b')
        self.store.ingest('b', 'Other secret', 'Other business secret')
        with patch('workproducts.request', return_value=self.answer(kind='bdr')) as model:
            workproducts.generate(self.store, self.business, 'bdr', 'Help a lead')
        self.assertNotIn('Other business secret', model.call_args.args[1].decode())

    def test_invalid_model_output_is_not_saved(self):
        with patch('workproducts.request', return_value=self.answer('')):
            with self.assertRaises(ValueError): workproducts.generate(self.store, self.business, 'seo', 'Write')
        workproducts.setup(self.store)
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM workproducts').fetchone()[0], 0)

    def test_owner_worker_uses_workproduct_path(self):
        self.store.db.execute("UPDATE businesses SET config=? WHERE id='a'", (json.dumps({'onboarding': {'stage': 'active'}}),))
        event = self.store.enqueue('a', 'owner', {'text': 'SEO write a guide', 'channel': 'local'})
        with patch('workproducts.request', return_value=self.answer()):
            self.assertTrue(work_once(self.store))
        row = self.store.db.execute('SELECT state,result FROM events WHERE id=?', (event,)).fetchone()
        self.assertEqual(row['state'], 'done')
        self.assertIn('Not sent or published', row['result'])
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM workproducts').fetchone()[0], 1)

    def test_explicit_automatic_mode_executes_supported_work_without_approval(self):
        command(self.store, self.business, 'work automatically')
        business = self.store.business('a')
        event = self.store.enqueue('a', 'owner', {'text': 'Remember the policy', 'channel': 'local'})
        action = propose(self.store, business, event, 'remember', {'name': 'Policy', 'text': 'Consultation is free.'})
        self.assertEqual(action['state'], 'ready')
        execute(self.store, action)
        self.assertEqual(self.store.db.execute('SELECT state FROM actions WHERE id=?', (action['id'],)).fetchone()[0], 'succeeded')

    def test_seo_excludes_private_conversations(self):
        self.store.ingest('a', 'Private chat', 'Customer passport DO_NOT_PUBLISH_THIS')
        with patch('workproducts.request', return_value=self.answer()) as model:
            workproducts.generate(self.store, self.business, 'seo', 'Write a guide')
        self.assertNotIn('DO_NOT_PUBLISH_THIS', model.call_args.args[1].decode())
