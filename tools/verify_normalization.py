"""Migrate only a new local copy; compare every financial and auth field."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import finance_store
from audit_backup import digest

def verify(source,destination):
    if destination.exists():raise ValueError('Destination exists')
    original=sqlite3.connect(f'file:{source.resolve()}?mode=ro',uri=True)
    target=sqlite3.connect(destination)
    original.backup(target)
    states={uid:json.loads(state) for uid,state in original.execute('SELECT id,state FROM users')}
    preserved={name:original.execute(f'SELECT * FROM {name} ORDER BY 1,2').fetchall() for name in ['sessions','attempts','operations']}
    identities=original.execute('SELECT id,login,salt,password,revision FROM users ORDER BY id').fetchall()
    finance_store.migrate(target)
    after={uid:finance_store.load(target,uid) for uid in states}
    assert states==after,'Financial history changed'
    assert identities==target.execute('SELECT id,login,salt,password,revision FROM users ORDER BY id').fetchall()
    for name,rows in preserved.items():assert rows==target.execute(f'SELECT * FROM {name} ORDER BY 1,2').fetchall(),name
    assert not target.execute('PRAGMA foreign_key_check').fetchall()
    assert target.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert 'state' not in [r[1] for r in target.execute('PRAGMA table_info(users)')]
    report={'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'states_before_sha256':digest(states),'states_after_sha256':digest(after),'identical':True,'users':len(states),'expenses':target.execute('SELECT count(*) FROM expenses').fetchone()[0],'total_kopecks':target.execute('SELECT COALESCE(sum(amount),0) FROM expenses').fetchone()[0],'preserved':['ids','dates','amounts','categories','notes','expense order','months','weeks','limits','closed','settled','credentials','revisions','sessions','receipts'],'normalized_database':str(destination.resolve())}
    destination.with_suffix('.verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps(report,ensure_ascii=True,indent=2))
    target.close();original.close()
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('destination',type=Path);a=p.parse_args();verify(a.source,a.destination)
