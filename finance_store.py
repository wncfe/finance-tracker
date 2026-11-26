"""Relational persistence; the budget engine/API still use an in-memory projection."""
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parent

def migrate(db):
    if 'state' not in [r[1] for r in db.execute('PRAGMA table_info(users)')]:
        merge_categories(db)
        remove_transfers(db)
        migrate_merchants(db)
        migrate_merchant_categories(db)
        migrate_user_categories(db)
        migrate_transport_categories(db)
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
        remove_transfers(db)
        migrate_merchants(db)
        migrate_merchant_categories(db)
        migrate_user_categories(db)
        migrate_transport_categories(db)
    except Exception:
        db.rollback()
        raise

def migrate_transport_categories(db):
    if not db.execute("SELECT 1 FROM categories WHERE id='taxi'").fetchone():
        try:db.executescript('BEGIN IMMEDIATE;\n'+(ROOT/'cloudflare/migrations/0007_transport_categories.sql').read_text('utf-8')+'\nCOMMIT;')
        except Exception:
            db.rollback()
            raise

def merge_categories(db):
    if db.execute("SELECT 1 FROM categories WHERE id='groceries'").fetchone():
        try:db.executescript('BEGIN IMMEDIATE;\n'+(ROOT/'cloudflare/migrations/0004_merge_groceries.sql').read_text('utf-8')+'\nCOMMIT;')
        except Exception:
            db.rollback()
            raise

def migrate_merchants(db):
    if 'merchant_id' not in [r[1] for r in db.execute('PRAGMA table_info(expenses)')]:
        try:db.executescript('BEGIN IMMEDIATE;\n'+(ROOT/'cloudflare/migrations/0006_merchants.sql').read_text('utf-8')+'\nCOMMIT;')
        except Exception:
            db.rollback()
            raise

def migrate_merchant_categories(db):
    if 'user_merchants' in [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'") ] and 'category' not in [r[1] for r in db.execute('PRAGMA table_info(user_merchants)')]:
        try:db.executescript('BEGIN IMMEDIATE;\n'+(ROOT/'cloudflare/migrations'/'0009_merchant_category.sql').read_text('utf-8')+'\nCOMMIT;')
        except Exception:
            db.rollback()
            raise

def migrate_user_categories(db):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_categories'").fetchone():
        try:db.executescript('BEGIN IMMEDIATE;\n'+(ROOT/'cloudflare/migrations'/'0010_user_categories.sql').read_text('utf-8')+'\nCOMMIT;')
        except Exception:
            db.rollback()
            raise

def load(db,user_id):
    state={'months':{}}
    columns=[r[1] for r in db.execute('PRAGMA table_info(months)')]
    legacy='incoming' in columns
    query='SELECT month,budget'+(',incoming,outgoing' if legacy else '')+' FROM months WHERE user_id=? ORDER BY month'
    for row in db.execute(query,(user_id,)):
        state['months'][row[0]]=dict(budget=row[1],weeks=[],expenses=[])
        if legacy:state['months'][row[0]].update(incoming=row[2],outgoing=row[3])
    for key,i,start,end,days,limit,closed,settled in db.execute('SELECT month,week_index,start_day,end_day,days,limit_amount,closed,settled FROM weeks WHERE user_id=? ORDER BY month,week_index',(user_id,)):
        week=dict(start=start,end=end,days=days,limit=limit,closed=bool(closed))
        if settled is not None:week['settled']=settled
        assert i==len(state['months'][key]['weeks']),'Non-contiguous weeks'
        state['months'][key]['weeks'].append(week)
    has_merchants='merchant_id' in [r[1] for r in db.execute('PRAGMA table_info(expenses)')]
    merchant_column='e.merchant_id' if has_merchants else 'NULL'
    for key,identifier,week,amount,date,category,note,merchant_id in db.execute(f'SELECT e.month,e.id,e.week_index,e.amount,e.date,c.name,e.note,{merchant_column} FROM expenses e JOIN categories c ON c.id=e.category_id WHERE e.user_id=? ORDER BY e.month,e.position',(user_id,)):
        expense=dict(id=identifier,week=week,amount=amount,date=date,category=category,note=note)
        if merchant_id is not None:expense['merchantId']=merchant_id
        state['months'][key]['expenses'].append(expense)
    if has_merchants:
        merchants=[dict(id=i,name=n,aliases=json.loads(a),**({'category':c} if c else {}),hidden=bool(h)) for i,n,a,c,h in db.execute('SELECT id,name,aliases,category,hidden FROM user_merchants WHERE user_id=? ORDER BY id',(user_id,))]
        if merchants:state['merchants']=merchants
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_categories'").fetchone():
        custom=[dict(id=i,name=n) for i,n in db.execute('SELECT c.id,c.name FROM user_categories u JOIN categories c ON c.id=u.category_id WHERE u.user_id=? ORDER BY c.id',(user_id,))]
        if custom:state['userCategories']=custom
    return state

def save(db,user_id,before,after):
    """Write only changed rows, in the caller's revision/receipt transaction."""
    surviving_ids={e['id'] for m in after['months'].values() for e in m['expenses']}
    prior_merchants={m['id']:m for m in before.get('merchants',[])}
    for m in after.get('merchants',[]):
        if prior_merchants.get(m['id'])!=m:
            db.execute('INSERT INTO user_merchants(user_id,id,name,aliases,category,hidden) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET name=excluded.name,aliases=excluded.aliases,category=excluded.category,hidden=excluded.hidden',(user_id,m['id'],m['name'],json.dumps(m['aliases'],ensure_ascii=False),m.get('category'),int(m['hidden'])))
    prior_category_ids={c['id'] for c in before.get('userCategories',[])}
    for category in after.get('userCategories',[]):
        if category['id'] in prior_category_ids:continue
        db.execute('INSERT OR IGNORE INTO categories(id,name) VALUES(?,?)',(category['id'],category['name']))
        row=db.execute('SELECT id FROM categories WHERE name=?',(category['name'],)).fetchone()
        if row is None:raise ValueError('Не удалось сохранить категорию')
        db.execute('INSERT OR IGNORE INTO user_categories(user_id,category_id) VALUES(?,?)',(user_id,row[0]))
    for key,m in after['months'].items():
        old=before['months'].get(key)
        if old==m:continue
        values=(m['budget'],)
        if old is None:
            db.execute('INSERT INTO months(user_id,month,budget) VALUES(?,?,?)',(user_id,key,*values))
        elif values!=(old['budget'],):
            db.execute('UPDATE months SET budget=? WHERE user_id=? AND month=?',(*values,user_id,key))
        for i,w in enumerate(m['weeks']):
            if old is not None and old['weeks'][i]==w:continue
            db.execute('INSERT INTO weeks VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,month,week_index) DO UPDATE SET start_day=excluded.start_day,end_day=excluded.end_day,days=excluded.days,limit_amount=excluded.limit_amount,closed=excluded.closed,settled=excluded.settled',
                       (user_id,key,i,w['start'],w['end'],w['days'],w['limit'],int(w['closed']),w.get('settled')))
        previous={e['id']:(i,e) for i,e in enumerate(old['expenses'])} if old else {}
        present={e['id'] for e in m['expenses']}
        for identifier in previous.keys()-present-surviving_ids:db.execute('DELETE FROM expenses WHERE user_id=? AND id=?',(user_id,identifier))
        for i,e in enumerate(m['expenses']):
            if previous.get(e['id'])==(i,e):continue
            category=db.execute('SELECT id FROM categories WHERE name=?',(e['category'],)).fetchone()
            if category is None:raise ValueError('Неизвестная категория')
            db.execute('INSERT INTO expenses(user_id,id,month,week_index,amount,date,category_id,note,position,merchant_id) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET month=excluded.month,week_index=excluded.week_index,amount=excluded.amount,date=excluded.date,category_id=excluded.category_id,note=excluded.note,position=excluded.position,merchant_id=excluded.merchant_id',
                       (user_id,e['id'],key,e['week'],e['amount'],e['date'],category[0],e['note'],i,e.get('merchantId')))


def remove_transfers(db):
    if 'incoming' not in [r[1] for r in db.execute('PRAGMA table_info(months)')]:return
    # Every file-backed local migration has a recovery copy; memory test DBs do not.
    import sqlite3, datetime
    filename=db.execute('PRAGMA database_list').fetchone()[2]
    if filename:
        destination=Path(filename).with_name(Path(filename).stem+'-before-analytics-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.sqlite3')
        db.commit()
        backup=sqlite3.connect(destination)
        try:db.backup(backup)
        finally:backup.close()
    script=(ROOT/'cloudflare/migrations/0005_remove_month_transfers.sql').read_text('utf-8')
    try:
        db.executescript('BEGIN IMMEDIATE;\n'+script+'\nCOMMIT;')
    except Exception:
        db.rollback()
        raise
