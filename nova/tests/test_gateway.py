import json
import sys
import threading
import unittest
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from gateway import Gateway


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.requests=[]
        captured=self.requests
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def do_POST(self):
                raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
                captured.append((self.path,raw,dict(self.headers)))
                self.send_response(200);self.end_headers();self.wfile.write(b'{"accepted":true}')
            def do_GET(self):
                captured.append((self.path,b'',dict(self.headers)))
                self.send_response(200);self.end_headers();self.wfile.write(b'challenge')
        self.upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Gateway)
        self.server.upstream_port=self.upstream.server_port
        self.threads=[]
        for server in [self.upstream,self.server]:
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();self.threads.append(thread)
        self.base='http://127.0.0.1:'+str(self.server.server_port)

    def tearDown(self):
        for server in [self.server,self.upstream]:server.shutdown();server.server_close()
        for thread in self.threads:thread.join()

    def test_private_paths_are_never_forwarded_even_with_admin_header(self):
        for path in ['/local/state','/local/message','/api/tags','/health','/.env','/webhooks/whatsapp/../local/state']:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(urllib.request.Request(self.base+path,headers={'Authorization':'Bearer test'}))
            self.assertEqual(error.exception.code,404)
        self.assertEqual(self.requests,[])

    def test_raw_signature_and_query_forward_without_private_headers(self):
        raw=b'{ "body": "unaltered" }'
        req=urllib.request.Request(self.base+'/webhooks/whatsapp?example=1',raw,
            {'X-Hub-Signature-256':'sha256=signature','Authorization':'secret','Origin':'https://nova.example','Cookie':'private'})
        with urllib.request.urlopen(req) as response:self.assertEqual(response.status,200)
        path,body,headers=self.requests[0]
        self.assertEqual(path,'/webhooks/whatsapp?example=1');self.assertEqual(body,raw)
        normalized={k.lower():v for k,v in headers.items()}
        self.assertEqual(normalized['x-hub-signature-256'],'sha256=signature')
        self.assertNotIn('authorization',normalized);self.assertNotIn('cookie',normalized)

    def test_verification_challenge_and_method_restriction(self):
        with urllib.request.urlopen(self.base+'/webhooks/whatsapp?hub.challenge=123') as response:
            self.assertEqual(response.read(),b'challenge')
        self.assertEqual(self.requests[0][0],'/webhooks/whatsapp?hub.challenge=123')
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.base+'/signup/checkout')
        self.assertEqual(error.exception.code,405)
