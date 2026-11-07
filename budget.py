"""Amounts are integer kopecks; weeks run Monday through Sunday."""
import calendar
import copy
import datetime as dt
import uuid
import re

CATEGORIES = ['Продукты', 'Фастфуд', 'Рестораны', 'Кофейни', 'Транспорт', 'Дом', 'Здоровье', 'Покупки', 'Одежда и обувь', 'Красота', 'Спорт', 'Дети', 'Подарки и творчество', 'Книги и образование', 'Связь и интернет', 'Подписки и цифровые сервисы', 'Путешествия', 'Развлечения', 'Другое', 'Супермаркеты', 'Кафе']

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

def accounted(w):
    # Settlement funds future weeks without rewriting the historical limit.
    return w.get('settled', w['limit'])

def effective_budget(m):
    return m['budget'] + m['incoming'] - m['outgoing']


def redistribute(m):
    """Closed weeks retain history; the final week holds the month residual."""
    available = effective_budget(m)
    if m['outgoing'] and available < spent(m):
        raise ValueError('Средства уже перенесены в следующий месяц')
    ids = [i for i, w in enumerate(m['weeks']) if not w['closed']]
    if ids:
        rebalance(m, ids, available - sum(accounted(w) for w in m['weeks'] if w['closed']))
    else:
        residual = available - sum(accounted(w) for w in m['weeks'][:-1])
        if residual < 0:
            raise ValueError('Бюджета недостаточно для закрытых недель')
        m['weeks'][-1]['limit'] = residual
        m['weeks'][-1].pop('settled', None)


def apply(state, action):
    if action.get('type') == 'expenses':
        items = action.get('items')
        if not isinstance(items, list) or not 1 <= len(items) <= 50:
            raise ValueError('Добавьте от 1 до 50 расходов')
        result = copy.deepcopy(state)
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get('date'), str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', item['date']):
                raise ValueError('Некорректная дата')
            date = dt.date.fromisoformat(item['date'])
            key = date.strftime('%Y-%m')
            index = next(i for i, w in enumerate(weeks(key)) if w['start'] <= date.day <= w['end'])
            result = apply(result, dict(item, type='expense', month=key, week=index))
        return result
    state = copy.deepcopy(state)
    key = action['month']
    weeks(key)
    m = ensure(state, key)
    kind = action['type']
    effective = m['budget'] + m['incoming'] - m['outgoing']
    if kind == 'budget':
        m['budget'] = amount(action['amount'])
        redistribute(m)
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
        redistribute(source)
        redistribute(m)
    else:
        i = action.get('week')
        if type(i) is not int or not 0 <= i < len(m['weeks']):
            raise ValueError('Некорректная неделя')
        w = m['weeks'][i]
        if kind == 'recategorize':
            if set(action)-{'type','month','week','id','category'}:
                raise ValueError('Можно изменить только категорию')
            if action.get('category') not in CATEGORIES:
                raise ValueError('Неизвестная категория')
            expense=next((e for e in m['expenses'] if e['id']==action.get('id') and e['week']==i),None)
            if expense is None:raise ValueError('Расход не найден')
            expense['category']=action['category']
            return state
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
            if len(note.encode('utf-16-le'))//2>200:
                raise ValueError('Описание слишком длинное')
            m['expenses'].append({'id':uuid.uuid4().hex,'week':i,'amount':amount(action['amount'], True),'date':date.isoformat(),'category':category,'note':note})
            if m['outgoing'] and spent(m) > effective:
                raise ValueError('Средства уже перенесены в следующий месяц')
        elif kind == 'delete':
            m['expenses'] = [e for e in m['expenses'] if not(e['id']==action['id'] and e['week']==i)]
        elif kind == 'limit':
            value = amount(action['amount'])
            ids = [j for j,v in enumerate(m['weeks']) if not v['closed'] and j != i]
            rebalance(m, ids, effective-sum(accounted(v) for v in m['weeks'] if v['closed'])-value)
            w['limit'] = value
        elif kind == 'close':
            if any(not previous['closed'] for previous in m['weeks'][:i]):
                raise ValueError('Сначала закройте предыдущие недели')
            mode = action['mode']
            if mode not in ('next','remaining','month'):
                raise ValueError('Выберите способ распределения')
            ids = [j for j,v in enumerate(m['weeks']) if not v['closed'] and j != i and (mode=='month' or j>i)]
            if mode == 'next':
                ids = ids[:1]
            if ids:
                total = sum(m['weeks'][j]['limit'] for j in ids)+w['limit']-spent(m,i)
                rebalance(m, ids, total)
                w['settled'] = spent(m,i)
            w['closed'] = True
        else:
            raise ValueError('Неизвестное действие')
    return state
