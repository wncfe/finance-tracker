"""Rehearse the analytics migration on a D1 SQL export, or verify its released result.

Never prints account credentials or individual operations. SQL exports stay in ignored data/.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import budget
import finance_store


def restore(path):
    db=sqlite3.connect(':memory:')
    db.executescript(path.read_text('utf-8-sig'))
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    return db


def snapshot(db):
    return {uid:finance_store.load(db,uid) for uid, in db.execute('SELECT id FROM users ORDER BY id')}


def verify(before_path, after_path=None):
    before=restore(before_path)
    try:
        original=snapshot(before);expected=copy.deepcopy(original)
        transfer_months=0
        for state in expected.values():
            for month in state['months'].values():
                incoming=month.pop('incoming');outgoing=month.pop('outgoing')
                if incoming or outgoing:
                    transfer_months+=1
                    budget.redistribute(month)
        identity=before.execute('SELECT id,login,salt,password,revision FROM users ORDER BY id').fetchall()
        receipts=before.execute('SELECT user,id,payload FROM operations ORDER BY user,id').fetchall()
        if after_path:
            after=restore(after_path)
        else:
            after=sqlite3.connect(':memory:');before.backup(after)
            after.executescript('BEGIN;\n'+(finance_store.ROOT/'cloudflare/migrations/0005_remove_month_transfers.sql').read_text('utf-8')+'\nCOMMIT;')
        try:
            assert snapshot(after)==expected,'Financial projection differs from expected cancellation'
            assert after.execute('SELECT id,login,salt,password,revision FROM users ORDER BY id').fetchall()==identity,'Accounts or revisions changed'
            assert after.execute('SELECT user,id,payload FROM operations ORDER BY user,id').fetchall()==receipts,'Operation receipts changed'
            assert not after.execute('PRAGMA foreign_key_check').fetchall()
            assert 'incoming' not in [r[1] for r in after.execute('PRAGMA table_info(months)')]
            rows=after.execute('SELECT user_id,id,month,week_index,amount,date,category_id,note,position FROM expenses ORDER BY user_id,id').fetchall()
            assert rows==before.execute('SELECT user_id,id,month,week_index,amount,date,category_id,note,position FROM expenses ORDER BY user_id,id').fetchall(),'Expenses changed'
            manifest={'verified':'released' if after_path else 'rehearsal','source_sha256':hashlib.sha256(before_path.read_bytes()).hexdigest(),'users':len(identity),'transfer_months':transfer_months,'expenses':len(rows),'expense_total_kopecks':sum(r[4] for r in rows),'expense_rows_sha256':hashlib.sha256(json.dumps(rows,ensure_ascii=False).encode()).hexdigest(),'receipts':len(receipts)}
            output=(after_path or before_path).with_suffix('.verification.json')
            output.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf-8')
            print(json.dumps(manifest,ensure_ascii=False))
        finally:after.close()
    finally:before.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('before',type=Path);parser.add_argument('--after',type=Path)
    args=parser.parse_args();verify(args.before,args.after)
