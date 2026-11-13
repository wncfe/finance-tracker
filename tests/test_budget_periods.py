import calendar
import copy
import datetime as dt
import unittest
import budget

SCENARIOS = {
    '2026-11': [(1,8),(9,15),(16,22),(23,30)],
    '2026-08': [(1,9),(10,16),(17,23),(24,31)],
    '2026-05': [(1,3),(4,10),(11,17),(18,24),(25,31)],
    '2026-01': [(1,4),(5,11),(12,18),(19,25),(26,31)],
    '2026-04': [(1,5),(6,12),(13,19),(20,26),(27,30)],
    '2027-02': [(1,7),(8,14),(15,21),(22,28)],
    '2028-02': [(1,6),(7,13),(14,20),(21,29)],
}

class PeriodTests(unittest.TestCase):
    def test_requested_calendars(self):
        for key, expected in SCENARIOS.items():
            with self.subTest(month=key):
                self.assertEqual([(w['start'],w['end']) for w in budget.weeks(key)],expected)

    def test_coverage_rounding_and_idempotence(self):
        for year in range(2000,2101):
            for month in range(1,13):
                key=f'{year}-{month:02}'
                ws=budget.weeks(key)
                self.assertEqual([d for w in ws for d in range(w['start'],w['end']+1)],list(range(1,calendar.monthrange(year,month)[1]+1)))
                self.assertTrue(all(w['days']>=3 for w in ws))
                self.assertEqual(sum(budget.allocate(3000000,[w['days'] for w in ws])),3000000)
                self.assertEqual(ws,budget.weeks(key))

    def test_carry_modes_and_month_boundary(self):
        for key in SCENARIOS:
            for mode in ('next','remaining','month'):
                s=budget.apply({'months':{}},dict(type='budget',month=key,amount=3000000))
                s=budget.apply(s,dict(type='expenses',items=[dict(date=key+'-01',amount=12345,category='Кафе')]),'2029-01-01')
                n=len(s['months'][key]['weeks'])
                for i in range(n):
                    s=budget.apply(s,dict(type='close',month=key,week=i,mode=mode))
                    self.assertEqual(sum(budget.accounted(w) for w in s['months'][key]['weeks']),3000000)
                self.assertEqual(list(s['months']),[key])
                self.assertEqual(budget.spent(s['months'][key]),12345)

    def test_existing_month_keeps_history_and_batch_uses_saved_boundaries(self):
        ws=[]
        start=1
        while start<=30:
            end=min(30,start+6-dt.date(2026,11,start).weekday())
            ws.append(dict(start=start,end=end,days=end-start+1,limit=10000*(end-start+1),closed=False))
            start=end+1
        s={'months':{'2026-11':dict(budget=300000,weeks=ws,expenses=[])}}
        s=budget.apply(s,dict(type='expense',month='2026-11',week=0,date='2026-11-01',amount=100,category='Кафе'),'2026-12-31')
        s=budget.apply(s,dict(type='close',month='2026-11',week=0,mode='next'))
        before=copy.deepcopy(s)
        result=budget.apply(s,dict(type='expenses',items=[dict(date='2026-11-09',amount=200,category='Кафе')]),'2026-12-31')
        self.assertEqual(result['months']['2026-11']['expenses'][-1]['week'],2)
        self.assertEqual(result['months']['2026-11']['weeks'],before['months']['2026-11']['weeks'])
        self.assertEqual(s,before)
        self.assertEqual(sum(budget.accounted(w) for w in result['months']['2026-11']['weeks']),300000)
