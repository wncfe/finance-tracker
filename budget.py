"""Amounts are integer kopecks; weeks run Monday through Sunday."""
import calendar
import copy
import datetime as dt
import uuid

CATEGORIES = ['Супермаркеты', 'Кафе', 'Транспорт', 'Дом', 'Здоровье', 'Покупки', 'Развлечения', 'Другое']

def weeks(key):
    y, m = map(int, key.split('-'))
    if not 2000 <= y <= 2100:
        raise ValueError('Месяц вне диапазона')
    end = calendar.monthrange(y, m)[1]
    result, start = [], 1
    while start <= end:
        stop = min(end, start + 6 - dt.date(y, m, start).weekday())
        result.append({'start': start, 'end': stop, 'days': stop-start+1})
        start = stop+1
    return result

def amount(value, positive=False):
    if type(value) is not int or value < (1 if positive else 0) or value > 10**10:
        raise ValueError('Некорректная сумма')
    return value

def allocate(total, weights):
    if total < 0:
        raise ValueError('Бюджета недостаточно для сохранения закрытых лимитов')
    if not weights:
        if total:
            raise ValueError('Нет открытых недель для перераспределения')
        return []
    result, used, cumulative = [], 0, 0
    for w in weights:
        cumulative += w
        target = total * cumulative // sum(weights)
        result.append(target-used)
        used = target
    return result

def rebalance(m, indices, total):
    for i, limit in zip(indices, allocate(total, [m['weeks'][i]['days'] for i in indices])):
        m['weeks'][i]['limit'] = limit

def ensure(state, key):
    if key not in state['months']:
        ws = weeks(key)
        state['months'][key] = {'budget': 0, 'incoming': 0, 'outgoing': 0, 'weeks': [dict(w, limit=0, closed=False) for w in ws], 'expenses': []}
    return state['months'][key]

def spent(m, i=None):
    return sum(e['amount'] for e in m['expenses'] if i is None or e['week'] == i)

def apply(state, action):
    state = copy.deepcopy(state)
    key = action['month']
    weeks(key)
    m = ensure(state, key)
    kind = action['type']
    effective = m['budget'] + m['incoming'] - m['outgoing']
    if kind == 'budget':
        m['budget'] = amount(action['amount'])
        ids = [i for i,w in enumerate(m['weeks']) if not w['closed']]
        rebalance(m, ids, m['budget']+m['incoming']-m['outgoing']-sum(w['limit'] for w in m['weeks'] if w['closed']))
    elif kind == 'transfer':
        y, mon = map(int,key.split('-'))
        previous = (dt.date(y,mon,1)-dt.timedelta(days=1)).strftime('%Y-%m')
        source = state['months'].get(previous)
        if not source or not all(w['closed'] for w in source['weeks']):
            raise ValueError('Сначала закройте все недели предыдущего месяца')
        value = amount(action['amount'], True)
        if value > source['budget']+source['incoming']-source['outgoing']-spent(source):
            raise ValueError('Недостаточно остатка для переноса')
        source['outgoing'] += value
        m['incoming'] += value
        ids = [i for i,w in enumerate(m['weeks']) if not w['closed']]
        rebalance(m, ids, effective+value-sum(w['limit'] for w in m['weeks'] if w['closed']))
    else:
        i = action.get('week')
        if type(i) is not int or not 0 <= i < len(m['weeks']):
            raise ValueError('Некорректная неделя')
        w = m['weeks'][i]
        if w['closed']:
            raise ValueError('Неделя закрыта')
        if kind == 'expense':
            date = dt.date.fromisoformat(action['date'])
            if date.strftime('%Y-%m') != key or not w['start'] <= date.day <= w['end']:
                raise ValueError('Дата должна попадать в выбранную неделю')
            category = action['category']
            if category not in CATEGORIES:
                raise ValueError('Неизвестная категория')
            note = str(action.get('note','')).strip()
            if len(note)>200:
                raise ValueError('Описание слишком длинное')
            m['expenses'].append({'id':uuid.uuid4().hex,'week':i,'amount':amount(action['amount'], True),'date':date.isoformat(),'category':category,'note':note})
        elif kind == 'delete':
            m['expenses'] = [e for e in m['expenses'] if not(e['id']==action['id'] and e['week']==i)]
        elif kind == 'limit':
            value = amount(action['amount'])
            ids = [j for j,v in enumerate(m['weeks']) if not v['closed'] and j != i]
            rebalance(m, ids, effective-sum(v['limit'] for j,v in enumerate(m['weeks']) if v['closed'] or j==i)+w['limit']-value)
            w['limit'] = value
        elif kind == 'close':
            mode = action['mode']
            if mode not in ('remaining','month'):
                raise ValueError('Выберите способ распределения')
            ids = [j for j,v in enumerate(m['weeks']) if not v['closed'] and j != i and (mode=='month' or j>i)]
            if ids:
                total = sum(m['weeks'][j]['limit'] for j in ids)+w['limit']-spent(m,i)
                rebalance(m, ids, total)
                w['limit'] = spent(m,i)
            w['closed'] = True
        else:
            raise ValueError('Неизвестное действие')
    return state

def migrate(raw):
    if raw.get('format') == 'po-nedelyam' and raw.get('version') == 2:
        return validate_state({'months':raw.get('months')})
    if raw.get('format') != 'po-nedelyam' or raw.get('version') != 1 or not isinstance(raw.get('months'),dict):
        raise ValueError('Ожидается резервная копия старой версии')
    state = {'months':{}}
    for key, old in raw['months'].items():
        m = ensure(state,key)
        m['budget'] = amount(old['budget'])
        rebalance(m,list(range(len(m['weeks']))),m['budget'])
        if len(old['spent'])!=len(m['weeks']) or type(old['closed']) is not int or not 0<=old['closed']<=len(m['weeks']):
            raise ValueError('Некорректные недели')
        for i,w in enumerate(m['weeks']):
            value=amount(old['spent'][i])
            if value:
                m['expenses'].append({'id':uuid.uuid4().hex,'week':i,'amount':value,'date':f"{key}-{w['start']:02}",'category':'Другое','note':'Импорт: итог недели'})
            w['closed'] = i<old['closed']
            if w['closed']:
                w['limit'] = value
        ids=[i for i,w in enumerate(m['weeks']) if not w['closed']]
        remaining=m['budget']-sum(w['limit'] for w in m['weeks'] if w['closed'])
        if remaining<0:
            raise ValueError('Старый месяц перерасходован: увеличьте бюджет перед импортом')
        if ids:
            rebalance(m,ids,remaining)
        elif remaining:
            m['weeks'][-1]['limit']+=remaining
    return state

def validate_state(raw):
    if not isinstance(raw,dict) or not isinstance(raw.get('months'),dict) or len(raw['months'])>1300:
        raise ValueError('Некорректная резервная копия')
    for key,m in raw['months'].items():
        expected=weeks(key)
        if not isinstance(m,dict) or len(m['weeks'])!=len(expected) or len(m['expenses'])>100000:
            raise ValueError('Некорректный месяц')
        total=amount(m['budget'])+amount(m['incoming'])
        outgoing=amount(m['outgoing'])
        if outgoing and (not all(w['closed'] for w in m['weeks']) or outgoing>total-spent(m)):
            raise ValueError('Некорректный перенос')
        for w,base in zip(m['weeks'],expected):
            if any(w[k]!=base[k] for k in ('start','end','days')) or type(w['closed']) is not bool:
                raise ValueError('Некорректная неделя')
            amount(w['limit'])
        if sum(w['limit'] for w in m['weeks'])!=total:
            raise ValueError('Сумма лимитов не совпадает с бюджетом')
        ids=set()
        for e in m['expenses']:
            amount(e['amount'],True)
            if type(e['week']) is not int or not 0<=e['week']<len(expected) or e['category'] not in CATEGORIES or not isinstance(e['note'],str) or len(e['note'])>200 or not isinstance(e['id'],str) or not e['id'] or len(e['id'])>100 or e['id'] in ids:
                raise ValueError('Некорректная трата')
            ids.add(e['id'])
            date=dt.date.fromisoformat(e['date']);w=expected[e['week']]
            if date.strftime('%Y-%m')!=key or not w['start']<=date.day<=w['end']:
                raise ValueError('Некорректная дата траты')
    return copy.deepcopy(raw)
