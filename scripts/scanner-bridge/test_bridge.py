import base64
import importlib.util
import json
import threading
import unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec=importlib.util.spec_from_file_location('bridge',Path(__file__).with_name('bridge.py'))
bridge=importlib.util.module_from_spec(spec); spec.loader.exec_module(bridge)

class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.calls=[]; calls=self.calls
        class Device(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_GET(self):
                calls.append(('GET',self.path))
                if self.path.endswith('ScannerCapabilities'): data=b'<ScannerCapabilities/>'
                elif self.path.endswith('NextDocument'):
                    if sum(path.endswith('NextDocument') for method,path in calls)>2: self.send_response(404); self.end_headers(); return
                    data=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLPcAAAAASUVORK5CYII='); self.send_response(200); self.send_header('Content-Type','image/png'); self.end_headers(); self.wfile.write(data); return
                else: self.send_response(404); self.end_headers(); return
                self.send_response(200); self.end_headers(); self.wfile.write(data)
            def do_POST(self):
                calls.append(('POST',self.path)); content=self.rfile.read(int(self.headers['Content-Length']))
                assert b'<scan:InputSource>Feeder</scan:InputSource>' in content
                assert b'<scan:Duplex>true</scan:Duplex>' in content
                self.send_response(201); self.send_header('Location','/eSCL/ScanJobs/1'); self.end_headers()
            def do_DELETE(self): calls.append(('DELETE',self.path)); self.send_response(200); self.end_headers()
        self.device=ThreadingHTTPServer(('127.0.0.1',0),Device)
        self.local=ThreadingHTTPServer(('127.0.0.1',0),bridge.handler_for(bridge.ScannerBridge('test-token',['http://localhost:3000'],{'mock':f'http://127.0.0.1:{self.device.server_port}/eSCL'})))
        for server in [self.device,self.local]: threading.Thread(target=server.serve_forever,daemon=True).start()
        self.root=f'http://127.0.0.1:{self.local.server_port}'
    def tearDown(self):
        for server in [self.local,self.device]: server.shutdown(); server.server_close()
    def request(self,path,body=None,token='test-token',origin='http://localhost:3000'):
        return urlopen(Request(self.root+path,data=None if body is None else json.dumps(body).encode(),headers={'X-Scanner-Token':token,'Origin':origin,'Content-Type':'application/json'}),timeout=5)
    def test_real_http_escl_batch(self):
        with self.request('/devices') as response: self.assertTrue(any(d['id']=='escl:mock' for d in json.load(response)['devices']))
        with self.request('/scan-batch',{'deviceId':'escl:mock','source':'Feeder','duplex':True,'maxPages':10}) as response:
            self.assertEqual(response.headers['Access-Control-Allow-Origin'],'http://localhost:3000')
            pages=json.load(response)['pages']
            self.assertEqual(len(pages),2)
            self.assertEqual(base64.b64decode(pages[0]['data'])[:8],b'\x89PNG\r\n\x1a\n')
        self.assertIn(('POST','/eSCL/ScanJobs'),self.calls)
        self.assertIn(('DELETE','/eSCL/ScanJobs/1'),self.calls)
    def test_auth_origin(self):
        for token,origin,code in [('wrong','http://localhost:3000',401),('test-token','https://evil.test',403)]:
            with self.assertRaises(HTTPError) as error: self.request('/devices',token=token,origin=origin)
            self.assertEqual(error.exception.code,code)
    def test_unknown_device_cannot_be_requested(self):
        with self.assertRaises(HTTPError) as error: self.request('/scan',{'deviceId':'escl:http://evil.test'})
        self.assertEqual(error.exception.code,503)
        self.assertEqual(self.calls,[])
if __name__=='__main__': unittest.main()
