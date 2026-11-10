"""The local review cannot be used as a cross-site admin or sending endpoint."""
import http.client
import json
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import demo_server

class DemoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = patch.object(demo_server, 'DB', self.temp.name + '/demo.sqlite')
        self.db.start()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), demo_server.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.db.stop();self.temp.cleanup()

    def request(self, path, data=None, host='127.0.0.1:4192', origin=demo_server.ORIGIN, cookie=True):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=3)
        headers = {'Host': host, 'Origin': origin}
        if cookie: headers['Cookie'] = 'nova_demo=' + demo_server.SESSION
        body = json.dumps(data) if data is not None else None
        conn.request('POST' if data is not None else 'GET', path, body, headers)
        response = conn.getresponse();result = response.read();status=response.status;conn.close()
        return status, result

    def test_wrong_host_cross_origin_and_missing_session_rejected(self):
        self.assertEqual(self.request('/api/state',host='evil.example')[0],403)
        self.assertEqual(self.request('/api/state',cookie=False)[0],401)
        self.assertEqual(self.request('/api/import',{'name':'x','text':'x','shared':True},origin='https://evil.example')[0],403)

    def test_imports_stay_private_unless_explicitly_shared(self):
        self.assertEqual(self.request('/api/import',{'name':'Past chat','text':'Private conversation','shared':False})[0],200)
        status,raw=self.request('/api/state');self.assertEqual(status,200)
        self.assertEqual(json.loads(raw)['documents'][0]['customer_safe'],0)
        self.assertEqual(self.request('/api/import',{'name':'bad','text':'x','shared':'true'})[0],400)

    def test_no_approval_or_external_send_endpoint(self):
        self.assertEqual(self.request('/api/approve',{'id':'anything'})[0],404)
        self.assertEqual(self.request('/local/message',{'business':'a','text':'send'})[0],404)

    def test_business_name_is_persisted(self):
        self.assertEqual(self.request('/api/import',{'business_name':'Travel demo','name':'Offer','text':'Current offer','shared':True})[0],200)
        from store import Store
        store=Store(demo_server.DB)
        self.assertEqual(store.business(demo_server.BUSINESS)['name'],'Travel demo')
        store.db.close()
