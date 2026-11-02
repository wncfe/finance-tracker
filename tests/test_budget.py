import copy
import unittest
import budget

class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.state=budget.apply({'months':{}},{'month':'2026-11','type':'budget','amount':300000})
    def act(self,**action):
        self.state=budget.apply(self.state,dict(month='2026-11',**action))
        return self.state['months']['2026-11']
    def test_calendar_and_rounding(self):
        for year in range(2024,2028):
            for month in range(1,13):
                key=f'{year}-{month:02}'
                ws=budget.weeks(key)
                for total in (1,99,10000):
                    self.assertEqual(sum(budget.allocate(total,[w['days'] for w in ws])),total)
    def test_manual_limit_preserves_closed(self):
        m=self.act(type='close',week=0,mode='remaining')
        fixed=m['weeks'][0]['limit']
        m=self.act(type='limit',week=1,amount=80000)
        self.assertEqual(m['weeks'][0]['limit'],fixed)
        self.assertEqual(m['weeks'][1]['limit'],80000)
        self.assertEqual(sum(budget.accounted(w) for w in m['weeks']),300000)
    def test_close_requires_all_previous_weeks(self):
        for mode in ('next','remaining','month'):
            for i in range(1,6):
                original=copy.deepcopy(self.state)
                with self.assertRaisesRegex(ValueError,'предыдущие'):
                    self.act(type='close',week=i,mode=mode)
                self.assertEqual(self.state,original)
        self.act(type='close',week=0,mode='next')
        self.act(type='close',week=1,mode='remaining')
        with self.assertRaises(ValueError): self.act(type='close',week=3,mode='next')
    def test_next_week_only(self):
        for expense in (1000,20000):
            s=budget.apply(self.state,{'month':'2026-11','type':'expense','week':0,'amount':expense,'date':'2026-11-01','category':'Кафе'})
            before=s['months']['2026-11']['weeks']
            result=budget.apply(s,{'month':'2026-11','type':'close','week':0,'mode':'next'})
            after=result['months']['2026-11']['weeks']
            self.assertEqual(after[1]['limit'],before[1]['limit']+before[0]['limit']-expense)
            self.assertEqual(after[2:],before[2:])
            self.assertEqual(sum(budget.accounted(w) for w in after),300000)
    def test_next_sequential_and_keeps_final_residual(self):
        for i in range(5):
            self.act(type='close',week=i,mode='next')
        m=self.state['months']['2026-11']
        previous=m['weeks'][5]['limit']
        m=self.act(type='close',week=5,mode='next')
        self.assertEqual(m['weeks'][5]['limit'],previous)
    def test_overspending_rebalances(self):
        self.act(type='expense',week=0,amount=50000,date='2026-11-01',category='Кафе',note='Обед')
        m=self.act(type='close',week=0,mode='remaining')
        self.assertEqual(m['weeks'][0]['limit'],10000)
        self.assertEqual(m['weeks'][0]['limit']-budget.spent(m,0),-40000)
        self.assertEqual(sum(w['limit'] for w in m['weeks'][1:]),250000)
        original=m['weeks'][0]['limit']
        m=self.act(type='budget',amount=400000)
        self.assertEqual(m['weeks'][0]['limit'],original)
        self.assertEqual(sum(w['limit'] for w in m['weeks'][1:]),350000)
        m=self.act(type='limit',week=1,amount=50000)
        self.assertEqual(sum(w['limit'] for w in m['weeks'][1:]),350000)
        budget.validate_state(self.state)
        self.assertEqual(budget.migrate({'format':'po-nedelyam','version':2,**self.state}),self.state)
        self.assertEqual(sum(budget.accounted(w) for w in m['weeks']),400000)
        with self.assertRaises(ValueError): self.act(type='expense',week=0,amount=1,date='2026-11-01',category='Кафе')
    def test_last_week_keeps_residual(self):
        for i in range(6): self.act(type='close',week=i,mode='remaining')
        self.assertEqual(sum(budget.accounted(w) for w in self.state['months']['2026-11']['weeks']),300000)
    def test_transfer_is_not_duplicated(self):
        for i in range(6): self.act(type='close',week=i,mode='remaining')
        self.state=budget.apply(self.state,{'month':'2026-12','type':'transfer','amount':200000})
        self.assertEqual(self.state['months']['2026-11']['outgoing'],200000)
        with self.assertRaises(ValueError): budget.apply(self.state,{'month':'2026-12','type':'transfer','amount':200000})
        self.assertEqual(self.state['months']['2026-12']['incoming'],200000)
        budget.validate_state(self.state)
        self.assertEqual(budget.migrate({'format':'po-nedelyam','version':2,**self.state}),self.state)
    def test_transfer_and_budget_failure_atomic(self):
        snapshot=copy.deepcopy(self.state)
        with self.assertRaises(ValueError): self.act(type='limit',week=1,amount=9999999)
        self.assertEqual(snapshot,self.state)
        with self.assertRaises(ValueError): budget.apply(self.state,{'month':'2026-12','type':'transfer','amount':1})
    def test_restore(self):
        state=budget.migrate({'format':'po-nedelyam','version':2,**self.state})
        self.assertEqual(state,self.state)
        legacy=budget.migrate({'format':'po-nedelyam','version':1,'months':{'2026-11':{'budget':300000,'spent':[1000,0,0,0,0,0],'closed':1}}})
        self.assertEqual(budget.spent(legacy['months']['2026-11']),1000)
        budget.validate_state(legacy)
    def test_invalid_date(self):
        with self.assertRaises(ValueError): self.act(type='expense',week=0,amount=1,date='2026-11-02',category='Кафе')

if __name__=='__main__': unittest.main()
