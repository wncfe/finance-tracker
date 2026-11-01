import http.cookiejar
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
import server

class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (server.ROOT/'data').mkdir(exist_ok=True)
        cls.tmp=tempfile.TemporaryDirectory(dir=server.ROOT/'data')
        cls.original=server.DB
        server.DB=Path(cls.tmp.name)/'test.sqlite3'
        server.init()
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.url=f'http://127.0.0.1:{cls.http.server_port}'
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();server.DB=cls.original;cls.tmp.cleanup()
    def client(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def request(self,client,path,data=None,origin=None):
        headers={'Content-Type':'application/json'}
        if origin: headers['Origin']=origin
        req=urllib.request.Request(self.url+'/api/'+path,data=json.dumps(data).encode() if data is not None else None,headers=headers)
        try:
            with client.open(req) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:
            with e:return e.code,json.load(e)
    def test_sessions_isolation_conflict_logout(self):
        a,b=self.client(),self.client()
        self.assertEqual(self.request(a,'state')[0],401)
        for client,login in ((a,'alice'),(b,'bob')):
            self.assertEqual(self.request(client,'register',{'login':login,'password':'test-password-123'})[0],200)
        code,result=self.request(a,'action',{'revision':0,'action':{'type':'budget','month':'2026-11','amount':10000}})
        self.assertEqual(code,200)
        self.assertEqual(self.request(a,'state')[1]['state'],result['state'])
        self.assertEqual(self.request(b,'state')[1]['state'],{'months':{}})
        self.assertEqual(self.request(a,'action',{'revision':0,'action':{'type':'budget','month':'2026-11','amount':999}})[0],409)
        self.assertEqual(self.request(a,'logout',{},origin='https://evil.example')[0],403)
        self.assertEqual(self.request(a,'logout',{})[0],200)
        self.assertEqual(self.request(a,'state')[0],401)
        self.assertEqual(self.request(a,'login',{'login':'alice','password':'test-password-123'})[0],200)
        self.assertEqual(self.request(a,'state')[1]['state'],result['state'])
