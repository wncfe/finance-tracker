"""Relational persistence; the budget engine/API still use an in-memory projection."""
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parent

def migrate(db):
    if 'state' not in [r[1] for r in db.execute('PRAGMA table_info(users)')]:
        merge_categories(db)
        return
    script=(ROOT/'cloudflare/migrations/0003_normalized_finances.sql').read_text('utf-8')
    # executescript commits any existing transaction: begin inside the script.
    original={uid:json.loads(state) for uid,state in db.execute('SELECT id,state FROM users')}
    try:
        db.executescript('BEGIN IMMEDIATE;\n'+script)
        for uid,state in original.items():
            if load(db,uid)!=state:raise ValueError('Migration changed financial history; rolled back')
        if db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Foreign key validation failed')
        db.commit()
        merge_categories(db)
    except Exception:
        db.rollback()
        raise

def merge_categories(db):
    if db.execute("SELECT 1 FROM categories WHERE id='groceries'").fetchone():
        try:db.executescript('BEGIN IMMEDIATE;\n'+(ROOT/'cloudflare/migrations/0004_merge_groceries.sql').read_text('utf-8')+'\nCOMMIT;')
        except Exception:
            db.rollback()
            raise

def load(db,user_id):
    state={'months':{}}
    for key,budget,incoming,outgoing in db.execute('SELECT month,budget,incoming,outgoing FROM months WHERE user_id=? ORDER BY month',(user_id,)):
        state['months'][key]=dict(budget=budget,incoming=incoming,outgoing=outgoing,weeks=[],expenses=[])
    for key,i,start,end,days,limit,closed,settled in db.execute('SELECT month,week_index,start_day,end_day,days,limit_amount,closed,settled FROM weeks WHERE user_id=? ORDER BY month,week_index',(user_id,)):
        week=dict(start=start,end=end,days=days,limit=limit,closed=bool(closed))
        if settled is not None:week['settled']=settled
        assert i==len(state['months'][key]['weeks']),'Non-contiguous weeks'
        state['months'][key]['weeks'].append(week)
    for key,identifier,week,amount,date,category,note in db.execute('SELECT e.month,e.id,e.week_index,e.amount,e.date,c.name,e.note FROM expenses e JOIN categories c ON c.id=e.category_id WHERE e.user_id=? ORDER BY e.month,e.position',(user_id,)):
        state['months'][key]['expenses'].append(dict(id=identifier,week=week,amount=amount,date=date,category=category,note=note))
    return state

def save(db,user_id,before,after):
    """Write only changed rows, in the caller's revision/receipt transaction."""
    for key,m in after['months'].items():
        old=before['months'].get(key)
        if old==m:continue
        values=(m['budget'],m['incoming'],m['outgoing'])
        if old is None:
            db.execute('INSERT INTO months VALUES(?,?,?,?,?)',(user_id,key,*values))
        elif values!=(old['budget'],old['incoming'],old['outgoing']):
            db.execute('UPDATE months SET budget=?,incoming=?,outgoing=? WHERE user_id=? AND month=?',(*values,user_id,key))
        for i,w in enumerate(m['weeks']):
            if old is not None and old['weeks'][i]==w:continue
            db.execute('INSERT INTO weeks VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,month,week_index) DO UPDATE SET start_day=excluded.start_day,end_day=excluded.end_day,days=excluded.days,limit_amount=excluded.limit_amount,closed=excluded.closed,settled=excluded.settled',
                       (user_id,key,i,w['start'],w['end'],w['days'],w['limit'],int(w['closed']),w.get('settled')))
        previous={e['id']:(i,e) for i,e in enumerate(old['expenses'])} if old else {}
        present={e['id'] for e in m['expenses']}
        for identifier in previous.keys()-present:db.execute('DELETE FROM expenses WHERE user_id=? AND id=?',(user_id,identifier))
        for i,e in enumerate(m['expenses']):
            if previous.get(e['id'])==(i,e):continue
            category=db.execute('SELECT id FROM categories WHERE name=?',(e['category'],)).fetchone()
            if category is None:raise ValueError('Неизвестная категория')
            db.execute('INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET month=excluded.month,week_index=excluded.week_index,amount=excluded.amount,date=excluded.date,category_id=excluded.category_id,note=excluded.note,position=excluded.position',
                       (user_id,e['id'],key,e['week'],e['amount'],e['date'],category[0],e['note'],i))
