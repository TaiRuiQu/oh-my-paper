"""Loopback HTTP bridge for real SANE and eSCL scanners. Python standard library."""
import argparse
import base64
import hmac
import json
import re
import secrets
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError

MAX_IMAGE = 32*1024*1024

class ScannerBridge:
    def __init__(self, token, origins, escl=None):
        self.token, self.origins, self.escl = token, set(origins), escl or {}
        self.lock = threading.Lock()

    def devices(self):
        result = []
        if shutil.which('scanimage'):
            try:
                listed = subprocess.run(['scanimage','--list-devices'],capture_output=True,text=True,timeout=2)
            except subprocess.TimeoutExpired:
                listed = None
            if listed is not None and listed.returncode == 0:
                result += [{'id':'sane:'+m.group(1),'name':m.group(2),'backend':'sane'} for m in re.finditer(r"device `([^']+)' is (.+)",listed.stdout)]
        for device_id,url in self.escl.items():
            try:
                with urlopen(url.rstrip('/')+'/ScannerCapabilities',timeout=5) as response:
                    xml = response.read(1024*1024).decode('utf-8')
                result.append({'id':'escl:'+device_id,'name':device_id,'backend':'escl','capabilitiesXml':xml})
            except (OSError,HTTPError) as exc:
                result.append({'id':'escl:'+device_id,'name':device_id,'backend':'escl','unavailable':str(exc)})
        return result

    def scan(self, device_id, resolution=300, source='Platen', duplex=False, max_pages=1):
        if resolution not in [150,200,300,600] or source not in ['Platen','Feeder'] or not 1 <= max_pages <= 100:
            raise ValueError('Invalid scanner settings')
        if not self.lock.acquire(blocking=False): raise ValueError('Scanner is busy')
        try:
            if device_id.startswith('sane:'):
                known = [device['id'] for device in self.devices()]
                if device_id not in known: raise ValueError('Unknown SANE scanner')
                if max_pages != 1: raise ValueError('SANE uses one scan per request; use eSCL for ADF batches')
                command = ['scanimage','--device-name',device_id[5:],'--format=png','--resolution',str(resolution)]
                if source == 'Feeder': command += ['--source','ADF']
                captured = subprocess.run(command,capture_output=True,timeout=120)
                if captured.returncode: raise ValueError(captured.stderr.decode('utf-8',errors='replace')[:1000])
                if len(captured.stdout) > MAX_IMAGE: raise ValueError('Scanner image too large')
                return [('image/png',captured.stdout)]
            if not device_id.startswith('escl:') or device_id[5:] not in self.escl: raise ValueError('Unknown scanner')
            root = self.escl[device_id[5:]].rstrip('/')+'/'
            xml = f'''<?xml version="1.0"?><scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm"><pwg:Version>2.0</pwg:Version><pwg:ScanRegions><pwg:ScanRegion><pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits><pwg:XOffset>0</pwg:XOffset><pwg:YOffset>0</pwg:YOffset><pwg:Width>2480</pwg:Width><pwg:Height>3508</pwg:Height></pwg:ScanRegion></pwg:ScanRegions><scan:InputSource>{source}</scan:InputSource><scan:Duplex>{str(duplex).lower()}</scan:Duplex><scan:ColorMode>RGB24</scan:ColorMode><scan:XResolution>{resolution}</scan:XResolution><scan:YResolution>{resolution}</scan:YResolution><pwg:DocumentFormat>image/png</pwg:DocumentFormat><scan:DocumentFormatExt>image/png</scan:DocumentFormatExt></scan:ScanSettings>'''
            with urlopen(Request(root+'ScanJobs',data=xml.encode(),headers={'Content-Type':'text/xml'},method='POST'),timeout=30) as response:
                if response.status != 201 or not response.headers.get('Location'): raise ValueError('Scanner did not create a scan job')
                job = urljoin(root,response.headers['Location'])
                if urlsplit(job).netloc != urlsplit(root).netloc: raise ValueError('Scanner returned a foreign scan job location')
            pages = []
            try:
                for _ in range(max_pages):
                    deadline = time.monotonic()+120
                    while True:
                        try:
                            with urlopen(job.rstrip('/')+'/NextDocument',timeout=30) as response:
                                data = response.read(MAX_IMAGE+1)
                                mime = response.headers.get_content_type()
                            if len(data) > MAX_IMAGE or mime not in ['image/png','image/jpeg']: raise ValueError('Unsupported or oversized scanner image')
                            pages.append((mime,data)); break
                        except HTTPError as exc:
                            if exc.code in [404,410] and pages: return pages
                            if exc.code not in [503,409] or time.monotonic() > deadline: raise
                            time.sleep(.3)
                return pages
            finally:
                try: urlopen(Request(job,method='DELETE'),timeout=5).close()
                except OSError: pass
        finally: self.lock.release()

def handler_for(bridge):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,fmt,*args): pass
        def send(self,status,data,mime='application/json'):
            self.send_response(status)
            origin = self.headers.get('Origin')
            if origin in bridge.origins: self.send_header('Access-Control-Allow-Origin',origin)
            self.send_header('Vary','Origin')
            self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers','Content-Type, X-Scanner-Token')
            self.send_header('Access-Control-Allow-Private-Network','true')
            self.send_header('Content-Type',mime)
            self.send_header('Content-Length',str(len(data)))
            self.send_header('Cache-Control','no-store')
            self.end_headers(); self.wfile.write(data)
        def authorized(self):
            if self.headers.get('Origin') and self.headers['Origin'] not in bridge.origins: self.send(403,b'{"error":"Origin rejected"}'); return False
            if not hmac.compare_digest(self.headers.get('X-Scanner-Token',''),bridge.token): self.send(401,b'{"error":"Token rejected"}'); return False
            return True
        def do_OPTIONS(self):
            if self.headers.get('Origin') not in bridge.origins: self.send(403,b'{"error":"Origin rejected"}'); return
            self.send(204,b'')
        def do_GET(self):
            if not self.authorized(): return
            if self.path != '/devices': self.send(404,b'{}'); return
            try: self.send(200,json.dumps({'devices':bridge.devices()}).encode())
            except (OSError,ValueError,subprocess.TimeoutExpired) as exc: self.send(503,json.dumps({'error':str(exc)}).encode())
        def do_POST(self):
            if not self.authorized(): return
            if self.path not in ['/scan','/scan-batch']: self.send(404,b'{}'); return
            try:
                size = int(self.headers.get('Content-Length',0))
                if not 0 < size <= 8192: raise ValueError('Invalid request size')
                options = json.loads(self.rfile.read(size))
                pages = bridge.scan(options['deviceId'],options.get('resolution',300),options.get('source','Platen'),options.get('duplex',False),options.get('maxPages',1) if self.path == '/scan-batch' else 1)
                if not pages: raise ValueError('Scanner returned no pages')
                if self.path == '/scan': self.send(200,pages[0][1],pages[0][0])
                else: self.send(200,json.dumps({'pages':[{'mime':mime,'data':base64.b64encode(data).decode()} for mime,data in pages]}).encode())
            except (OSError,ValueError,KeyError,TypeError,subprocess.TimeoutExpired) as exc: self.send(503,json.dumps({'error':str(exc)}).encode())
    return Handler

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=17863)
    parser.add_argument('--origin',action='append',required=True)
    parser.add_argument('--token',default=None)
    parser.add_argument('--escl',action='append',default=[],help='name=http://scanner-address/eSCL')
    args=parser.parse_args(); devices={}
    for entry in args.escl:
        name,url=entry.split('=',1)
        if urlsplit(url).scheme not in ['http','https']: raise ValueError('eSCL URL must use HTTP(S)')
        devices[name]=url
    token=args.token or secrets.token_urlsafe(32)
    print(json.dumps({'url':f'http://127.0.0.1:{args.port}','token':token,'origins':args.origin}),flush=True)
    server=ThreadingHTTPServer(('127.0.0.1',args.port),handler_for(ScannerBridge(token,args.origin,devices)))
    server.serve_forever()
if __name__=='__main__': main()
