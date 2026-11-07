"""Restore a D1 SQL export locally, without displaying account or payment details."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

def restore(source, destination):
    if destination.exists():
        raise ValueError('Destination already exists; refusing to overwrite')
    db=sqlite3.connect(destination)
    try:
        db.executescript(source.read_text('utf-8-sig'))
        db.commit()
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        users=db.execute('SELECT id,state,revision FROM users ORDER BY id').fetchall()
        states={str(uid):json.loads(state) for uid,state,_ in users}
        months=[month for state in states.values() for month in state['months'].values()]
        expenses=[e for month in months for e in month['expenses']]
        report={'backup_file':str(source.resolve()), 'backup_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                'restored_file':str(destination.resolve()),'users':len(users),'months':len(months),
                'weeks':sum(len(m['weeks']) for m in months),'expenses':len(expenses),
                'expense_total_kopecks':sum(e['amount'] for e in expenses),'states_sha256':digest(states),
                'operations':db.execute('SELECT count(*) FROM operations').fetchone()[0],
                'state_top_keys':sorted(set(k for s in states.values() for k in s)),
                'month_keys':sorted(set(k for m in months for k in m)),
                'week_keys':sorted(set(k for m in months for w in m['weeks'] for k in w)),
                'expense_keys':sorted(set(k for e in expenses for k in e))}
        destination.with_suffix('.manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
        print(json.dumps(report,ensure_ascii=True,indent=2))
    finally: db.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('destination',type=Path)
    args=parser.parse_args();restore(args.source,args.destination)
