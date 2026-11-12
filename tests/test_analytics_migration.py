import copy
import datetime as dt
import json
import sqlite3
import unittest
import budget
import finance_store as store


class AnalyticsMigrationTests(unittest.TestCase):
    def database(self, states):
        db = sqlite3.connect(':memory:')
        db.execute('PRAGMA foreign_keys=ON')
        for name in ('0001_initial.sql', '0002_operations.sql'):
            db.executescript((store.ROOT/'cloudflare/migrations'/name).read_text('utf-8'))
        for uid, state in enumerate(states, 1):
            db.execute('INSERT INTO users(id,login,salt,password,state,revision) VALUES(?,?,?,?,?,?)', (uid,str(uid),'salt','hash',json.dumps(state),7))
            db.execute('INSERT INTO operations VALUES(?,?,?)',(uid,'receipt-id','payload-hash'))
        db.commit()
        for name in ('0003_normalized_finances.sql', '0004_merge_groceries.sql'):
            db.executescript((store.ROOT/'cloudflare/migrations'/name).read_text('utf-8'))
        return db

    def state(self, incoming=0, outgoing=0, closed=0):
        state=budget.apply({'months':{}},dict(type='budget',month='2026-11',amount=300000),'2026-11-13')
        for i in range(closed):
            state=budget.apply(state,dict(type='close',month='2026-11',week=i,mode='next'),'2026-11-13')
        m=state['months']['2026-11']
        m['incoming']=incoming;m['outgoing']=outgoing
        # Produce the old effective allocation, then verify cancellation against the new engine.
        original=m['budget'];m['budget']+=incoming-outgoing
        budget.redistribute(m);m['budget']=original
        return state

    def test_cancel_transfers_matches_domain_for_open_and_closed_months(self):
        for closed in (0,1,6):
            for incoming,outgoing in ((0,0),(50000,0),(0,50000)):
                state=self.state(incoming,outgoing,closed)
                expected=copy.deepcopy(state);m=expected['months']['2026-11']
                m.pop('incoming');m.pop('outgoing')
                if incoming or outgoing:budget.redistribute(m)
                db=self.database([state])
                try:
                    store.remove_transfers(db)
                    self.assertEqual(store.load(db,1),expected)
                    self.assertEqual(db.execute('SELECT revision FROM users').fetchone()[0],7)
                    self.assertEqual(db.execute('SELECT * FROM operations').fetchall(),[(1,'receipt-id','payload-hash')])
                    self.assertFalse(db.execute('PRAGMA foreign_key_check').fetchall())
                    store.remove_transfers(db)
                finally:db.close()

    def test_incompatible_closed_limits_roll_back_all_accounts(self):
        valid=self.state(100,0)
        invalid=self.state(500000,0,1)
        invalid['months']['2026-11']['weeks'][0]['settled']=400000
        db=self.database([valid,invalid])
        try:
            before=[store.load(db,i) for i in (1,2)]
            with self.assertRaises(sqlite3.IntegrityError):store.remove_transfers(db)
            self.assertEqual([store.load(db,i) for i in (1,2)],before)
            self.assertIn('incoming',[r[1] for r in db.execute('PRAGMA table_info(months)')])
        finally:db.close()

    def test_future_dates_atomic_and_midnight(self):
        item=dict(date='2026-11-13',amount=100,category='Кофейни')
        original={'months':{}}
        saved=budget.apply(original,dict(type='expenses',items=[item]),'2026-11-13')
        self.assertEqual(len(saved['months']['2026-11']['expenses']),1)
        with self.assertRaisesRegex(ValueError,'будущем'):
            budget.apply(original,dict(type='expenses',items=[item,dict(item,date='2026-11-14')]),'2026-11-13')
        self.assertEqual(original,{'months':{}})
        self.assertEqual(budget.today_at(dt.datetime(2026,11,12,18,59,59,tzinfo=dt.timezone.utc)),'2026-11-12')
        self.assertEqual(budget.today_at(dt.datetime(2026,11,12,19,tzinfo=dt.timezone.utc)),'2026-11-13')
