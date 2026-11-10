import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from store import Store
import routines
import speech
from channels import transcribe

class RoutineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name+'/test.sqlite')
        self.store.add_business('a','Travel','15555550101','a')
        self.business=self.store.business('a')
    def tearDown(self):
        self.store.db.close();self.temp.cleanup()
    def test_due_slot_is_queued_once_and_no_burst_catchup(self):
        routines.handle(self.store,self.business,'Every day SEO write a guide')
        self.assertEqual(routines.tick(self.store,channel='local'),1)
        self.assertEqual(routines.tick(self.store,channel='local'),0)
        row=self.store.db.execute('SELECT body FROM events').fetchone()
        self.assertEqual(json.loads(row[0])['text'],'SEO write a guide')
        self.store.db.execute('UPDATE routines SET next_run=1')
        self.assertEqual(routines.tick(self.store),1)
        self.assertEqual(routines.tick(self.store),0)
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM events').fetchone()[0],2)
    def test_duplicate_owner_request_does_not_create_duplicate_routine(self):
        for _ in range(2):routines.handle(self.store,self.business,'Every 2h BDR draft a follow-up')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM routines').fetchone()[0],1)
    def test_paused_business_not_queued(self):
        routines.handle(self.store,self.business,'Every day SEO write a guide')
        self.store.db.execute('UPDATE businesses SET config=?',(json.dumps({'paused':True}),))
        self.assertEqual(routines.tick(self.store),0)
    def test_stop_is_business_scoped_and_cancels_pending_work(self):
        routines.handle(self.store,self.business,'Every day SEO write a guide')
        key=self.store.db.execute('SELECT id FROM routines').fetchone()[0]
        self.store.add_business('b','Other','15555550102','b')
        routines.handle(self.store,self.store.business('b'),'STOP TASK '+key)
        self.assertEqual(self.store.db.execute('SELECT enabled FROM routines').fetchone()[0],1)
        routines.tick(self.store)
        routines.handle(self.store,self.business,'STOP TASK '+key)
        self.assertEqual(self.store.db.execute('SELECT state FROM events').fetchone()[0],'cancelled')
    def test_unsupported_commands_and_invalid_interval_not_scheduled(self):
        self.assertIsNone(routines.handle(self.store,self.business,'Every day send money'))
        with self.assertRaises(ValueError):routines.handle(self.store,self.business,'Every 0h SEO write')

class SpeechTests(unittest.TestCase):
    def test_voice_bytes_are_bounded_before_execution(self):
        with patch('speech.subprocess.run') as command:
            for data in (b'',None,b'x'*15000001):
                with self.assertRaises(ValueError):speech.transcribe_bytes(data)
            command.assert_not_called()
    def test_missing_local_model_does_not_call_external_provider(self):
        with patch('speech.configured',return_value=False),patch('speech.subprocess.run') as command:
            with self.assertRaises(ValueError):speech.transcribe_bytes(b'not-audio')
            command.assert_not_called()
    def test_whatsapp_voice_routes_to_local_speech_when_configured(self):
        with patch.dict(os.environ,{'NOVA_TRANSCRIPTION_PROVIDER':'local'}),patch('channels.whatsapp_media',return_value=({},b'audio')),patch('speech.transcribe_bytes',return_value='Write an article') as local:
            self.assertEqual(transcribe('media'),'Write an article');local.assert_called_once_with(b'audio')
