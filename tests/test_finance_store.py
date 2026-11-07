import copy
import json
import sqlite3
import unittest
from pathlib import Path
import budget
import finance_store as store

class StoreTests(unittest.TestCase):
    def test_merge_groceries_preserves_every_other_field(self):
        state=budget.apply({'months':{}},dict(type='expense',month='2026-11',week=1,date='2026-11-02',amount=12345,category='Супермаркеты',note='Магнит'))
        state['months']['2026-11']['expenses'][0]['category']='Продукты'
        with self.legacy(state) as db:
            store.migrate(db)
            expected=copy.deepcopy(state);expected['months']['2026-11']['expenses'][0]['category']='Супермаркеты'
            self.assertEqual(store.load(db,1),expected)
            self.assertIsNone(db.execute("SELECT id FROM categories WHERE name='Продукты'").fetchone())
            self.assertEqual(db.execute('SELECT revision FROM users WHERE id=1').fetchone()[0],7)
        alias=budget.apply({'months':{}},dict(type='expense',month='2026-11',week=1,date='2026-11-02',amount=1,category='Продукты'))
        self.assertEqual(alias['months']['2026-11']['expenses'][0]['category'],'Супермаркеты')

    def legacy(self,state):
        db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
        for name in ['0001_initial.sql','0002_operations.sql']:
            db.executescript((store.ROOT/'cloudflare/migrations'/name).read_text('utf-8'))
        db.execute('INSERT INTO users(id,login,salt,password,state,revision) VALUES(1,?,?,?,?,7)',('test','salt','hash',json.dumps(state)))
        db.commit();return db

    def test_roundtrip_settled_legacy_category_and_idempotence(self):
        state=budget.apply({'months':{}},dict(type='budget',month='2026-11',amount=100000))
        state=budget.apply(state,dict(type='expense',month='2026-11',week=0,date='2026-11-01',category='Кафе',amount=500,note='История 😀'))
        state=budget.apply(state,dict(type='close',month='2026-11',week=0,mode='next'))
        state['months']['2026-11']['expenses'][0]['category']='Архивная категория'
        with self.legacy(state) as db:
            store.migrate(db);self.assertEqual(store.load(db,1),state)
            store.migrate(db);self.assertEqual(store.load(db,1),state)
            self.assertNotIn('state',[r[1] for r in db.execute('PRAGMA table_info(users)')])
            self.assertEqual(db.execute('SELECT revision FROM users').fetchone()[0],7)

    def test_unsupported_data_rolls_back_schema(self):
        with self.legacy({'months':{},'unknown':'do not drop'}) as db:
            with self.assertRaises(sqlite3.IntegrityError):store.migrate(db)
            self.assertIn('state',[r[1] for r in db.execute('PRAGMA table_info(users)')])
            self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='expenses'").fetchone())

    def test_differential_writes_and_order(self):
        with self.legacy({'months':{}}) as db:
            store.migrate(db);before=store.load(db,1)
            state=budget.apply(before,dict(type='expenses',items=[dict(date='2026-11-02',amount=100,category='Кофейни',note='Первый'),dict(date='2026-12-01',amount=200,category='Супермаркеты',note='Второй')]))
            store.save(db,1,before,state);db.commit()
            self.assertEqual(store.load(db,1),state)
            trace=[];db.set_trace_callback(trace.append)
            after=budget.apply(state,dict(type='expense',month='2026-11',week=1,date='2026-11-02',amount=300,category='Кофейни',note='Третий'))
            store.save(db,1,state,after);db.commit()
            writes=[s for s in trace if s.startswith(('INSERT','UPDATE','DELETE'))]
            self.assertEqual(len(writes),1,writes)
            self.assertEqual(store.load(db,1),after)
            identifier=after['months']['2026-11']['expenses'][0]['id']
            deleted=budget.apply(after,dict(type='delete',month='2026-11',week=1,id=identifier))
            store.save(db,1,after,deleted);self.assertEqual(store.load(db,1),deleted)

    def test_foreign_keys_and_atomic_rollback(self):
        with self.legacy({'months':{}}) as db:
            store.migrate(db)
            state=budget.apply({'months':{}},dict(type='expense',month='2026-11',week=1,date='2026-11-02',amount=100,category='Кофейни'))
            store.save(db,1,{'months':{}},state);db.commit()
            with self.assertRaises(sqlite3.IntegrityError):
                with db:
                    db.execute('UPDATE months SET budget=999 WHERE user_id=1')
                    db.execute("UPDATE expenses SET category_id='missing'")
            self.assertEqual(store.load(db,1),state)
            with self.assertRaises(sqlite3.IntegrityError):db.execute('UPDATE expenses SET amount=-1')

    def test_real_backup_when_available(self):
        path=store.ROOT/'data/backups/cloud-before-normalization-20261107-161731.sqlite3'
        if not path.exists():self.skipTest('Private backup is intentionally not in Git')
        source=sqlite3.connect(f'file:{path}?mode=ro',uri=True);db=sqlite3.connect(':memory:')
        try:
            source.backup(db);db.execute('PRAGMA foreign_keys=ON')
            states={uid:json.loads(s) for uid,s in db.execute('SELECT id,state FROM users')}
            store.migrate(db)
            for uid,state in states.items():self.assertEqual(store.load(db,uid),state)
        finally:db.close();source.close()
