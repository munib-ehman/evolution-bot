import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import providers
from pilots import create
from store import Store
from billing import subscription_active
from engine import execute, propose


class PilotProviderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / 'pilot.sqlite')
        self.addCleanup(self.store.db.close)

    def test_free_pilot_needs_no_payment_or_outbound_message(self):
        result = create(self.store, 'pilot', 'Business', '15555550101', 'phone')
        self.assertTrue(subscription_active(self.store, 'pilot'))
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 0)
        self.assertEqual(self.store.business('pilot')['config']['onboarding'], {'stage':'welcome','detailed':True})
        self.assertEqual(result['token_limit'], 100000)

    def test_pilot_expiry_holds_approved_work(self):
        create(self.store, 'pilot', 'Business', '15555550101', 'phone')
        self.store.db.execute("UPDATE businesses SET config=json_set(config,'$.pilot.expires',?,'$.onboarding.stage','active')", (time.time()-1,))
        event = self.store.enqueue('pilot','owner',{'text':'save','channel':'local'})
        action = propose(self.store,self.store.business('pilot'),event,'remember',{'name':'fact','text':'Fact'})
        self.store.db.execute("UPDATE actions SET state='ready'")
        execute(self.store,action)
        self.assertFalse(subscription_active(self.store,'pilot'))
        self.assertEqual(self.store.db.execute('SELECT state FROM actions').fetchone()[0], 'billing_hold')

    def test_duplicate_owner_cannot_get_another_pilot(self):
        create(self.store,'first','Business','15555550101','first-phone')
        with self.assertRaises(ValueError):
            create(self.store,'second','Business','15555550101','second-phone')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM businesses').fetchone()[0],1)

    def test_invalid_pilot_limit_makes_no_business(self):
        for kwargs in [{'days':0},{'days':31},{'token_limit':0},{'token_limit':1000001}]:
            with self.assertRaises(ValueError):
                create(self.store,'pilot','Business','15555550101','phone',**kwargs)
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM businesses').fetchone()[0],0)

    def test_groq_uses_its_own_endpoint_without_paid_fallback(self):
        with patch.dict(os.environ,{'NOVA_AI_PROVIDER':'groq','GROQ_API_KEY':'groq-test','NOVA_AI_MODEL':'selected-model','NOVA_AI_BASE_URL':'https://paid.example/v1'},clear=True):
            cfg=providers.configuration()
            self.assertEqual(cfg['base_url'],'https://api.groq.com/openai/v1')
            self.assertEqual(cfg['key'],'groq-test')

    def test_local_model_requires_no_api_key(self):
        with patch.dict(os.environ,{'NOVA_AI_PROVIDER':'ollama','NOVA_AI_MODEL':'llama3.2:3b'},clear=True):
            cfg=providers.configuration()
            self.assertEqual(cfg['base_url'],'http://127.0.0.1:11434/v1')
            self.assertEqual(cfg['token_parameter'],'max_tokens')

    def test_local_profile_cannot_send_to_remote_http_or_cloud_model(self):
        for base in ['http://remote.example/v1','https://127.0.0.1/v1','http://user:secret@localhost/v1']:
            with patch.dict(os.environ,{'NOVA_AI_PROVIDER':'ollama','NOVA_AI_BASE_URL':base,'NOVA_AI_MODEL':'local'},clear=True):
                with self.assertRaises(ValueError):providers.configuration()
        with patch.dict(os.environ,{'NOVA_AI_PROVIDER':'ollama','NOVA_AI_MODEL':'example:cloud'},clear=True):
            with self.assertRaises(ValueError):providers.configuration()

    def test_transcription_does_not_require_chat_model(self):
        with patch.dict(os.environ,{'NOVA_AI_BASE_URL':'https://ai.example/v1','NOVA_AI_KEY':'key','NOVA_TRANSCRIPTION_MODEL':'speech-model'},clear=True):
            self.assertEqual(providers.configuration(transcription=True)['model'],'speech-model')

    def test_diagnostics_do_not_expose_credentials(self):
        from diagnostics import report
        with patch.dict(os.environ,{'NOVA_AI_PROVIDER':'groq','GROQ_API_KEY':'never-emit-this','NOVA_AI_MODEL':'model'},clear=True):
            result=report(self.store)
            self.assertTrue(result['ai']['configured'])
            self.assertNotIn('never-emit-this', json.dumps(result))
            self.assertFalse(result['live_provider_flow_verified'])

    def test_local_schema_names_match_tool_registry(self):
        from planning_schema import FIELDS,response_format
        from engine import TOOLS
        self.assertEqual(set(FIELDS),set(TOOLS))
        schema=response_format(customer=True)['json_schema']['schema']
        self.assertEqual(schema['properties']['actions']['maxItems'],0)
        quote=response_format(customer=True,quote_lead='lead')['json_schema']['schema']
        variants=quote['properties']['actions']['items']['anyOf']
        self.assertEqual([v['properties']['tool']['const'] for v in variants],['prepare_quote'])

    def test_review_runner_blocks_external_execution_even_if_enabled(self):
        from local_pilot import run
        create(self.store,'local-review','Fictional','15555550101','local-phone')
        self.store.db.execute("UPDATE businesses SET config=json_set(config,'$.onboarding.stage','active','$.rules.send_message','auto')")
        with patch('local_pilot.work_once',return_value=False), patch('local_pilot.execute') as execute:
            run(self.store,'REPORT')
            execute.assert_not_called()
        self.assertEqual(self.store.business('local-review')['config']['rules']['send_message'],'deny')
