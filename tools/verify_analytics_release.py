"""Read-only production smoke check: exact assets, headers, server date and auth boundary."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import budget

ROOT=Path(__file__).resolve().parents[1]
BASE='https://finance-tracker.alekseip2002.workers.dev'


def fetch(route):
    body=ROOT/'data/analytics-release-body'
    headers=ROOT/'data/analytics-release-headers'
    result=subprocess.run(['curl.exe','--silent','--show-error','--max-time','30','--noproxy','*','--dump-header',str(headers),'--output',str(body),'--write-out','%{http_code}',BASE+route],capture_output=True,check=True)
    return int(result.stdout),body.read_bytes(),headers.read_text('utf-8')


count=0
for path in sorted((ROOT/'web').rglob('*')):
    if not path.is_file() or path.suffix not in ('.html','.js','.css','.svg'):continue
    route='/' if path.name=='index.html' else '/'+path.relative_to(ROOT/'web').as_posix()
    status,content,headers=fetch(route+'?release=analytics-20261113')
    assert status==200,(route,status)
    assert hashlib.sha256(content).digest()==hashlib.sha256(path.read_bytes()).digest(),route+' asset mismatch'
    assert 'content-security-policy:' in headers.lower(),route+' missing CSP'
    count+=1
status,content,_=fetch('/api/config')
assert status==200,('config',status)
config=json.loads(content)
assert config['timeZone']=='Asia/Yekaterinburg'
assert config['today']==budget.today_at()
assert fetch('/api/state')[0]==401
manifest={'url':BASE,'assets_matched':count,'today':config['today'],'timeZone':config['timeZone'],'config':200,'anonymous_state':401,'financial_writes':0}
(ROOT/'data/analytics-release-verification.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf-8')
print(json.dumps(manifest,ensure_ascii=False))
