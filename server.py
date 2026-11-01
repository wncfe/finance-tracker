"""Local server. Run python server.py; use HTTPS reverse proxy for hosting."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
from contextlib import contextmanager
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from urllib.parse import urlparse
import budget

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'data' / 'finance.sqlite3'
@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=15)
    db.execute('PRAGMA foreign_keys=ON')
    try:
        with db:
            yield db
    finally:
        db.close()

def init():
    DB.parent.mkdir(exist_ok=True)
    with connect() as db:
        db.executescript('''CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, login TEXT UNIQUE, salt TEXT, password TEXT, state TEXT, revision INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user INTEGER REFERENCES users(id), expires REAL);
        CREATE TABLE IF NOT EXISTS attempts(ip TEXT PRIMARY KEY, count INTEGER, until REAL);''')

def password(value,salt):
    return hashlib.scrypt(value.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):
        pass
    def send(self, code, data, cookie=None):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        if cookie: self.send_header('Set-Cookie',cookie)
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def token(self):
        c=SimpleCookie(self.headers.get('Cookie',''))
        return hashlib.sha256(c['session'].value.encode()).hexdigest() if 'session' in c else ''
    def user(self,db):
        return db.execute('SELECT users.id,login,state,revision FROM users JOIN sessions ON sessions.user=users.id WHERE token=? AND expires>?',(self.token(),time.time())).fetchone()
    def do_GET(self):
        if self.path=='/api/config': return self.send(200,{'invitationRequired':False})
        if self.path=='/api/state':
            with connect() as db: user=self.user(db)
            return self.send(200,{'login':user[1],'state':json.loads(user[2]),'revision':user[3]}) if user else self.send(401,{'error':'Войдите в аккаунт'})
        files={'/':'index.html','/app.js':'app.js','/pickers.js':'pickers.js','/style.css':'style.css'}
        filename=files.get(urlparse(self.path).path)
        requested=urlparse(self.path).path
        if requested.startswith('/icons/') and requested.count('/')==2 and requested.endswith('.svg') and (ROOT/'web'/requested[1:]).is_file():
            filename=requested[1:]
        if not filename: return self.send(404,{'error':'Не найдено'})
        body=(ROOT/'web'/filename).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type',{'html':'text/html','js':'text/javascript','css':'text/css','svg':'image/svg+xml'}[filename.split('.')[-1]]+'; charset=utf-8')
        self.send_header('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        origin=self.headers.get('Origin')
        if origin and urlparse(origin).netloc!=self.headers.get('Host'): return self.send(403,{'error':'Недопустимый источник запроса'})
        if self.headers.get('Content-Type','').split(';')[0]!='application/json': return self.send(415,{'error':'Ожидается JSON'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=5_000_000: raise ValueError('Некорректный размер запроса')
            data=json.loads(self.rfile.read(size))
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if self.path in ('/api/login','/api/register'):
                    ip=self.client_address[0]
                    attempt=db.execute('SELECT count,until FROM attempts WHERE ip=?',(ip,)).fetchone()
                    if attempt and attempt[0]>=10 and attempt[1]>time.time(): return self.send(429,{'error':'Слишком много попыток. Повторите через 15 минут'})
                    login=str(data['login']).strip().lower(); pw=str(data['password'])
                    if not 3<=len(login)<=80 or not 10<=len(pw)<=256: raise ValueError('Логин: 3–80 символов. Пароль: 10–256 символов')
                    if self.path=='/api/register':
                        salt=secrets.token_hex(16)
                        try: db.execute('INSERT INTO users(login,salt,password,state) VALUES(?,?,?,?)',(login,salt,password(pw,salt),'{"months":{}}'))
                        except sqlite3.IntegrityError: raise ValueError('Логин уже занят')
                    user=db.execute('SELECT id,salt,password FROM users WHERE login=?',(login,)).fetchone()
                    if not user or not hmac.compare_digest(password(pw,user[1]),user[2]):
                        count=attempt[0]+1 if attempt and attempt[1]>time.time() else 1
                        db.execute('INSERT OR REPLACE INTO attempts VALUES(?,?,?)',(ip,count,time.time()+900)); db.commit()
                        return self.send(401,{'error':'Неверный логин или пароль'})
                    db.execute('DELETE FROM attempts WHERE ip=?',(ip,))
                    token=secrets.token_urlsafe(32)
                    db.execute('DELETE FROM sessions WHERE expires<?',(time.time(),))
                    db.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),user[0],time.time()+604800))
                    db.commit()
                    secure='; Secure' if os.getenv('COOKIE_SECURE')=='1' else ''
                    return self.send(200,{},f'session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800{secure}')
                user=self.user(db)
                if not user: return self.send(401,{'error':'Войдите в аккаунт'})
                if self.path=='/api/logout':
                    db.execute('DELETE FROM sessions WHERE token=?',(self.token(),)); db.commit()
                    return self.send(200,{},'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
                if data.get('revision')!=user[3]: return self.send(409,{'error':'Данные изменены в другой вкладке. Обновите страницу'})
                state=json.loads(user[2])
                if self.path=='/api/action': state=budget.apply(state,data['action'])
                elif self.path=='/api/import':
                    if state['months']: raise ValueError('Импорт доступен только в пустой аккаунт, чтобы не затереть записи')
                    state=budget.migrate(data['backup'])
                else: return self.send(404,{'error':'Не найдено'})
                db.execute('UPDATE users SET state=?,revision=revision+1 WHERE id=?',(json.dumps(state),user[0])); db.commit()
                self.send(200,{'state':state,'revision':user[3]+1})
        except (ValueError,KeyError,TypeError,IndexError) as exc: self.send(400,{'error':str(exc)})
        except Exception:
            self.send(500,{'error':'Не удалось сохранить данные. Повторите запрос'})

if __name__=='__main__':
    init()
    print('Finance tracker: http://127.0.0.1:8000',flush=True)
    ThreadingHTTPServer((os.getenv('HOST','127.0.0.1'),int(os.getenv('PORT','8000'))),Handler).serve_forever()
