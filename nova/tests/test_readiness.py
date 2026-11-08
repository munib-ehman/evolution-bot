import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from store import Store
import readiness


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / 'nova.db')
        self.addCleanup(self.store.db.close)
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_no_config_never_opens_checkout(self):
        readiness.heartbeat(self.store)
        os.environ['NOVA_ACCEPT_SIGNUPS'] = 'true'
        self.assertFalse(readiness.status(self.store)['checkout_ready'])

    def test_config_without_worker_or_launch_verification_is_closed(self):
        os.environ.update({key: 'configured' for key in readiness.REQUIRED})
        os.environ['NOVA_STRIPE_SECRET_KEY'] = 'sk_live_test_fixture'
        os.environ['NOVA_ACCEPT_SIGNUPS'] = 'true'
        self.assertFalse(readiness.status(self.store)['checkout_ready'])
        readiness.heartbeat(self.store)
        os.environ['NOVA_ACCEPT_SIGNUPS'] = 'false'
        self.assertFalse(readiness.status(self.store)['checkout_ready'])

    def test_ready_worker_expiry_closes_checkout(self):
        os.environ.update({key: 'configured' for key in readiness.REQUIRED})
        os.environ['NOVA_STRIPE_SECRET_KEY'] = 'sk_live_test_fixture'
        os.environ['NOVA_ACCEPT_SIGNUPS'] = 'true'
        readiness.heartbeat(self.store)
        self.assertTrue(readiness.status(self.store)['checkout_ready'])
        self.store.db.execute('UPDATE runtime_status SET updated=?', (time.time()-121,))
        self.assertFalse(readiness.status(self.store)['checkout_ready'])

    def test_sandbox_key_never_opens_production_checkout(self):
        os.environ.update({key: 'configured' for key in readiness.REQUIRED})
        os.environ['NOVA_STRIPE_SECRET_KEY'] = 'sk_test_fixture'
        os.environ['NOVA_ACCEPT_SIGNUPS'] = 'true'
        readiness.heartbeat(self.store)
        self.assertFalse(readiness.status(self.store)['checkout_ready'])
