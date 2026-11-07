import http.cookiejar
import json
import uuid
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
        if path == 'action': data = dict(data, operationId=data.get('operationId', uuid.uuid4().hex))
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

    def test_operation_retry_and_removed_import(self):
        client=self.client()
        self.assertEqual(self.request(client,'register',{'login':'retry-user','password':'test-password-123'})[0],200)
        body={'revision':0,'operationId':uuid.uuid4().hex,'action':{'type':'expense','month':'2026-11','week':0,'amount':100,'date':'2026-11-01','category':'Кафе'}}
        first=self.request(client,'action',body)
        second=self.request(client,'action',body)
        self.assertEqual(first,second)
        self.assertEqual(first[1]['revision'],1)
        self.assertEqual(len(second[1]['state']['months']['2026-11']['expenses']),1)
        changed=dict(body,action=dict(body['action'],amount=200))
        self.assertEqual(self.request(client,'action',changed)[0],409)
        self.assertEqual(self.request(client,'import',{'revision':1,'backup':{}})[0],404)

    def test_batch_rejection_retry_and_revision(self):
        client=self.client()
        self.assertEqual(self.request(client,'register',{'login':'batch-user','password':'test-password-123'})[0],200)
        item=dict(date='2026-11-02',amount=100,category='Кофейни',note='Кофе')
        body={'revision':0,'operationId':uuid.uuid4().hex,'action':{'type':'expenses','items':[item,dict(item,date='2027-01-01',amount=-1)]}}
        self.assertEqual(self.request(client,'action',body)[0],400)
        current=self.request(client,'state')[1]
        self.assertEqual(current['state'],{'months':{}})
        self.assertEqual(current['revision'],0)
        body['action']['items'][1]['amount']=200
        saved=self.request(client,'action',body)
        self.assertEqual(saved[0],200)
        self.assertEqual(self.request(client,'action',body),saved)
        self.assertEqual(saved[1]['revision'],1)
        self.assertEqual(len(saved[1]['state']['months']['2027-01']['expenses']),1)
