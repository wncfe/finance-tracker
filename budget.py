"""Amounts are integer kopecks; weeks run Monday through Sunday."""
import calendar
import copy
import datetime as dt
import uuid
import re
import json
from pathlib import Path

MERCHANT_DEFAULTS = json.loads((Path(__file__).resolve().parent/'web/merchants.json').read_text('utf-8'))

def utf16len(value):
    return len(value.encode('utf-16-le'))//2

CATEGORIES = ['Фастфуд', 'Рестораны', 'Кофейни', 'Транспорт', 'Общественный транспорт', 'Такси', 'Дом', 'Здоровье', 'Покупки', 'Одежда и обувь', 'Красота', 'Спорт', 'Дети', 'Подарки и творчество', 'Книги и образование', 'Связь и интернет', 'Подписки и цифровые сервисы', 'Путешествия', 'Развлечения', 'Другое', 'Супермаркеты', 'Кафе']

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
        state['months'][key] = {'budget': 0, 'weeks': [dict(w, limit=0, closed=False) for w in ws], 'expenses': []}
    return state['months'][key]

def spent(m, i=None):
    return sum(e['amount'] for e in m['expenses'] if i is None or e['week'] == i)

def accounted(w):
    # Settlement funds future weeks without rewriting the historical limit.
    return w.get('settled', w['limit'])

def effective_budget(m):
    return m['budget']


def redistribute(m):
    """Closed weeks retain history; the final week holds the month residual."""
    available = effective_budget(m)
    ids = [i for i, w in enumerate(m['weeks']) if not w['closed']]
    if ids:
        rebalance(m, ids, available - sum(accounted(w) for w in m['weeks'] if w['closed']))
    else:
        residual = available - sum(accounted(w) for w in m['weeks'][:-1])
        if residual < 0:
            raise ValueError('Бюджета недостаточно для закрытых недель')
        m['weeks'][-1]['limit'] = residual
        m['weeks'][-1].pop('settled', None)


def today_at(instant=None):
    # Yekaterinburg is UTC+05:00; no external tzdata dependency on Windows.
    return (instant or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone(dt.timedelta(hours=5))).date().isoformat()


def apply(state, action, today=None):
    today = today or today_at()
    if action.get('type') == 'transfer':
        raise ValueError('Переносы между месяцами больше не поддерживаются')
    if action.get('type') == 'merchant_save':
        item=action.get('merchant')
        if not isinstance(item,dict) or set(item)-{'id','name','aliases','hidden'}:
            raise ValueError('Некорректный магазин')
        identifier=item.get('id')
        if not isinstance(identifier,str) or not (any(m['id']==identifier for m in MERCHANT_DEFAULTS) or re.fullmatch(r'c-[0-9a-f]{32}',identifier)):
            raise ValueError('Некорректный идентификатор магазина')
        name=item.get('name')
        if not isinstance(name,str) or not 1<=utf16len(name.strip())<=100:
            raise ValueError('Название: от 1 до 100 символов')
        aliases=item.get('aliases')
        if not isinstance(aliases,list) or len(aliases)>30 or any(not isinstance(a,str) or not 1<=utf16len(a.strip())<=100 for a in aliases):
            raise ValueError('Некорректные варианты названия')
        if type(item.get('hidden')) is not bool: raise ValueError('Некорректный статус магазина')
        state=copy.deepcopy(state)
        merchants=[m for m in state.get('merchants',[]) if m['id']!=identifier]
        merchants.append(dict(id=identifier,name=name.strip(),aliases=[a.strip() for a in aliases],hidden=item['hidden']))
        state['merchants']=sorted(merchants,key=lambda m:m['id'])
        return state
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
            result = apply(result, dict(item, type='expense', month=key, week=index), today)
        return result
    action = dict(action)
    if action.get('category') == 'Продукты': action['category']='Супермаркеты'
    if action.get('type') == 'expense_update':
        if set(action)-{'type','month','week','id','amount','date','category','merchantId'}:
            raise ValueError('Неизвестные поля изменения расхода')
        if type(action.get('week')) is not int: raise ValueError('Некорректная неделя')
        state=copy.deepcopy(state)
        source=state['months'].get(action.get('month'))
        expense=next((e for e in source['expenses'] if e['id']==action.get('id') and e['week']==action.get('week')),None) if source else None
        if expense is None: raise ValueError('Расход не найден')
        updated=dict(expense)
        updated.update({k:action[k] for k in ('amount','date','category','merchantId') if k in action})
        amount(updated['amount'],True)
        if updated['category'] not in CATEGORIES: raise ValueError('Неизвестная категория')
        if not isinstance(updated['date'],str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',updated['date']): raise ValueError('Некорректная дата')
        date=dt.date.fromisoformat(updated['date'])
        if date.isoformat()>today: raise ValueError('Расход не может быть в будущем')
        key=updated['date'][:7]
        target=ensure(state,key)
        index=next(i for i,w in enumerate(target['weeks']) if w['start']<=date.day<=w['end'])
        if updated['amount']!=expense['amount'] or updated['date']!=expense['date']:
            if source['weeks'][expense['week']]['closed']: raise ValueError('В закрытой неделе нельзя менять сумму и дату')
            if target['weeks'][index]['closed']: raise ValueError('Нельзя перенести расход в закрытую неделю')
        merchant_id=updated.get('merchantId')
        if merchant_id is not None and not isinstance(merchant_id,str): raise ValueError('Неизвестный магазин')
        if merchant_id and merchant_id!=expense.get('merchantId'):
            merchant=next((m for m in state.get('merchants',[]) if m['id']==merchant_id),None) or next((m for m in MERCHANT_DEFAULTS if m['id']==merchant_id),None)
            if not merchant or merchant.get('hidden'): raise ValueError('Неизвестный или скрытый магазин')
        if not merchant_id: updated.pop('merchantId',None)
        updated['week']=index
        if source is target: source['expenses'][source['expenses'].index(expense)]=updated
        else: source['expenses'].remove(expense);target['expenses'].append(updated)
        return state
    state = copy.deepcopy(state)
    key = action['month']
    weeks(key)
    m = ensure(state, key)
    kind = action['type']
    effective = m['budget']
    if kind == 'budget':
        m['budget'] = amount(action['amount'])
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
            if date.isoformat() > today:
                raise ValueError('Расход не может быть в будущем')
            if date.strftime('%Y-%m') != key or not w['start'] <= date.day <= w['end']:
                raise ValueError('Дата должна попадать в выбранную неделю')
            category = action['category']
            if category not in CATEGORIES:
                raise ValueError('Неизвестная категория')
            note = str(action.get('note','')).strip()
            if len(note.encode('utf-16-le'))//2>200:
                raise ValueError('Описание слишком длинное')
            merchant_id=action.get('merchantId')
            if merchant_id is not None and merchant_id != '':
                merchant=next((x for x in state.get('merchants',[]) if x['id']==merchant_id),None) or next((x for x in MERCHANT_DEFAULTS if x['id']==merchant_id),None)
                if not isinstance(merchant_id,str) or not merchant or merchant.get('hidden'):raise ValueError('Неизвестный или скрытый магазин')
            expense={'id':uuid.uuid4().hex,'week':i,'amount':amount(action['amount'], True),'date':date.isoformat(),'category':category,'note':note}
            if merchant_id: expense['merchantId']=merchant_id
            m['expenses'].append(expense)
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
