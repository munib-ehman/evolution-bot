"""Public tunnel boundary: only product callbacks; no local/admin/model API exposure."""
import http.client
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROUTES = {'/public/status': {'GET'}, '/signup/checkout': {'POST'},
          '/webhooks/whatsapp': {'GET','POST'}, '/webhooks/stripe': {'POST'},
          '/webhooks/call': {'POST'}, '/webhooks/sms': {'POST'},
          '/connections/google/callback': {'GET'}}


class Gateway(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self,*_):
        pass

    def reply(self,status,body=b'{"error":"Unavailable"}',mime='application/json'):
        self.send_response(status)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):self.forward()
    def do_POST(self):self.forward()

    def forward(self):
        path=urllib.parse.urlsplit(self.path).path
        if path not in ROUTES:return self.reply(404)
        if self.command not in ROUTES[path]:return self.reply(405)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<0 or length>1000000:return self.reply(413)
            if self.headers.get('Transfer-Encoding'):return self.reply(400)
            body=self.rfile.read(length) if length else None
            headers={key:self.headers[key] for key in ['Content-Type','Origin','Stripe-Signature','X-Hub-Signature-256','X-Twilio-Signature'] if self.headers.get(key)}
            upstream=http.client.HTTPConnection('127.0.0.1',self.server.upstream_port,timeout=60)
            try:
                upstream.request(self.command,self.path,body=body,headers=headers)
                response=upstream.getresponse()
                payload=response.read(1000001)
                if len(payload)>1000000:return self.reply(502)
                return self.reply(response.status,payload,response.getheader('Content-Type','application/json'))
            finally:upstream.close()
        except (ValueError,TimeoutError,OSError,http.client.HTTPException):
            return self.reply(503)


def serve(port=4191,upstream_port=4190):
    server=ThreadingHTTPServer(('127.0.0.1',port),Gateway)
    server.upstream_port=upstream_port
    server.serve_forever()

if __name__=='__main__':serve()
