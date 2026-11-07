"""Compare a normalized SQL backup with a local trial or a post-migration export."""
import argparse,copy,json,sqlite3,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import finance_store

def restore(path):
    db=sqlite3.connect(':memory:');db.executescript(path.read_text('utf-8-sig'));db.execute('PRAGMA foreign_keys=ON');return db

def verify(before_file,after_file=None):
    before=restore(before_file);after=restore(after_file or before_file)
    if after_file is None:after.executescript((finance_store.ROOT/'cloudflare/migrations/0004_merge_groceries.sql').read_text('utf-8'))
    users=[r[0] for r in before.execute('SELECT id FROM users')]
    expected={uid:finance_store.load(before,uid) for uid in users};changed=0
    for s in expected.values():
        for m in s['months'].values():
            for e in m['expenses']:
                if e['category']=='Продукты':e['category']='Супермаркеты';changed+=1
    assert expected=={uid:finance_store.load(after,uid) for uid in users}
    for table in ['users','operations','sessions','attempts','months','weeks']:
        assert before.execute(f'SELECT * FROM {table} ORDER BY 1,2').fetchall()==after.execute(f'SELECT * FROM {table} ORDER BY 1,2').fetchall(),table
    assert not after.execute("SELECT id FROM categories WHERE name='Продукты'").fetchall()
    assert not after.execute('PRAGMA foreign_key_check').fetchall()
    result={'verified':True,'recategorized_expenses':changed,'expenses':after.execute('SELECT count(*) FROM expenses').fetchone()[0],'total_kopecks':after.execute('SELECT sum(amount) FROM expenses').fetchone()[0],'all_other_financial_and_account_fields_unchanged':True}
    print(json.dumps(result));return result
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('before',type=Path);p.add_argument('after',type=Path,nargs='?');a=p.parse_args();verify(a.before,a.after)
