"""Integer kopecks; budget periods merge short calendar edge weeks."""
import calendar
import copy
import datetime as dt
import uuid
import re
import json
import unicodedata
from pathlib import Path

MERCHANT_DEFAULTS = json.loads((Path(__file__).resolve().parent/'web/merchants.json').read_text('utf-8'))

def utf16len(value):
    return len(value.encode('utf-16-le'))//2

CATEGORIES = ['Фастфуд', 'Рестораны', 'Кофейни', 'Транспорт', 'Общественный транспорт', 'Такси', 'Дом', 'Здоровье', 'Покупки', 'Одежда и обувь', 'Красота', 'Спорт', 'Дети', 'Подарки и творчество', 'Книги и образование', 'Связь и интернет', 'Подписки и цифровые сервисы', 'Путешествия', 'Развлечения', 'Другое', 'Супермаркеты', 'Кафе']

def available_categories(state):
    return CATEGORIES + [item['name'] for item in state.get('userCategories', [])]

def category_key(value):
    return ' '.join(unicodedata.normalize('NFKC',str(value or '')).casefold().replace('ё','е').split())

def merchant_for(state, identifier):
    return next((m for m in state.get('merchants',[]) if m['id']==identifier),None) or next((m for m in MERCHANT_DEFAULTS if m['id']==identifier),None)

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
    if result[0]['days'] <= 2:
        first = result.pop(0)
        result[0]['start'] = first['start']
        result[0]['days'] += first['days']
    if result[-1]['days'] <= 2:
        last = result.pop()
        result[-1]['end'] = last['end']
        result[-1]['days'] += last['days']
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

OVERSPEND_ERROR = 'Перерасход больше, чем осталось на следующие недели. Увеличьте бюджет месяца'

def accounted(w):
    # Settlement funds future weeks without rewriting the historical limit.
    return w.get('settled', w['limit'])

def reconcile_budgets(state):
    for m in state['months'].values():
        open_weeks = [w for w in m['weeks'] if not w['closed']]
        if not open_weeks:
            continue
        reserved = 0
        for i, w in enumerate(m['weeks']):
            if w['closed']:
                w['settled'] = spent(m, i)
                reserved += w['settled']
        allocated = sum(w['limit'] for w in open_weeks)
        adjustment = max(0, m['budget'] - reserved) - allocated
        if adjustment > 0:
            shares = allocate(adjustment, [1] * len(open_weeks))
            for w, share in zip(open_weeks, shares):
                w['limit'] += share
        elif adjustment < 0:
            # Cap smaller limits first, then split the remaining debit equally.
            by_limit = sorted(open_weeks, key=lambda w: w['limit'])
            deficit = -adjustment
            for i, w in enumerate(by_limit):
                take = min(w['limit'], deficit // (len(by_limit) - i))
                w['limit'] -= take
                deficit -= take
    return state


def effective_budget(m):
    return m['budget']


def redistribute(m):
    """Closed weeks retain history; the final week holds the month residual."""
    available = effective_budget(m)
    ids = [i for i, w in enumerate(m['weeks']) if not w['closed']]
    if ids:
        rebalance(m, ids, available - sum(accounted(w) for w in m['weeks'] if w['closed']))
    else:
        residual = available - sum(spent(m, i) for i in range(len(m['weeks']) - 1))
        if residual < 0:
            raise ValueError('Бюджета недостаточно для закрытых недель')
        m['weeks'][-1]['limit'] = residual
        m['weeks'][-1].pop('settled', None)


def today_at(instant=None):
    # Yekaterinburg is UTC+05:00; no external tzdata dependency on Windows.
    return (instant or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone(dt.timedelta(hours=5))).date().isoformat()


def apply(state, action, today=None):
    return _apply_action(reconcile_budgets(copy.deepcopy(state)), action, today or today_at())


def _apply_action(state, action, today):
    if action.get('type') == 'transfer':
        raise ValueError('Переносы между месяцами больше не поддерживаются')
    if action.get('type') == 'category_save':
        item=action.get('category')
        if not isinstance(item,dict) or set(item)-{'id','name'}:
            raise ValueError('Некорректная категория')
        if not isinstance(item.get('id'),str) or not re.fullmatch(r'uc-[0-9a-f]{32}',item['id']):
            raise ValueError('Некорректный идентификатор категории')
        name=item.get('name')
        if not isinstance(name,str) or not 1<=utf16len(name.strip())<=60:
            raise ValueError('Название категории: от 1 до 60 символов')
        if any(c['id']==item['id'] for c in state.get('userCategories',[])):
            raise ValueError('Некорректный идентификатор категории')
        if any(category_key(x)==category_key(name) for x in available_categories(state)):
            raise ValueError('Такая категория уже существует')
        state['userCategories']=sorted(state.get('userCategories',[])+[dict(id=item['id'],name=name.strip())],key=lambda x:x['id'])
        return state
    if action.get('type') == 'merchant_save':
        item=action.get('merchant')
        if not isinstance(item,dict) or set(item)-{'id','name','aliases','category','hidden'}:
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
        category=item.get('category')
        if not isinstance(category,str) or category not in available_categories(state):
            raise ValueError('Выберите категорию магазина')
        if type(item.get('hidden')) is not bool: raise ValueError('Некорректный статус магазина')
        merchants=[m for m in state.get('merchants',[]) if m['id']!=identifier]
        merchant=dict(id=identifier,name=name.strip(),aliases=[a.strip() for a in aliases],hidden=item['hidden'])
        if category: merchant['category']=category
        merchants.append(merchant)
        state['merchants']=sorted(merchants,key=lambda m:m['id'])
        for month in state['months'].values():
            for expense in month['expenses']:
                if expense.get('merchantId')==identifier: expense['category']=category
        return state
    if action.get('type') == 'expenses':
        items = action.get('items')
        if not isinstance(items, list) or not 1 <= len(items) <= 50:
            raise ValueError('Добавьте от 1 до 50 расходов')
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get('date'), str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', item['date']):
                raise ValueError('Некорректная дата')
            date = dt.date.fromisoformat(item['date'])
            key = date.strftime('%Y-%m')
            index = next(i for i, w in enumerate(ensure(state, key)['weeks']) if w['start'] <= date.day <= w['end'])
            _apply_action(state, dict(item, type='expense', month=key, week=index), today)
        return state
    action = dict(action)
    if action.get('category') == 'Продукты': action['category']='Супермаркеты'
    if action.get('type') == 'expense_update':
        if set(action)-{'type','month','week','id','amount','date','category','merchantId'}:
            raise ValueError('Неизвестные поля изменения расхода')
        if type(action.get('week')) is not int: raise ValueError('Некорректная неделя')
        source=state['months'].get(action.get('month'))
        expense=next((e for e in source['expenses'] if e['id']==action.get('id') and e['week']==action.get('week')),None) if source else None
        if expense is None: raise ValueError('Расход не найден')
        updated=dict(expense)
        updated.update({k:action[k] for k in ('amount','date','category','merchantId') if k in action})
        amount(updated['amount'],True)
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
        if merchant_id:
            merchant=merchant_for(state,merchant_id)
            if not merchant or (merchant_id!=expense.get('merchantId') and merchant.get('hidden')): raise ValueError('Неизвестный или скрытый магазин')
            if merchant.get('category') not in available_categories(state): raise ValueError('Сначала задайте категорию магазину')
            updated['category']=merchant['category']
        elif updated['category'] not in available_categories(state):
            raise ValueError('Неизвестная категория')
        if not merchant_id: updated.pop('merchantId',None)
        updated['week']=index
        if source is target: source['expenses'][source['expenses'].index(expense)]=updated
        else: source['expenses'].remove(expense);target['expenses'].append(updated)
        return state
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
            expense=next((e for e in m['expenses'] if e['id']==action.get('id') and e['week']==i),None)
            if expense is None:raise ValueError('Расход не найден')
            if expense.get('merchantId'):
                merchant=merchant_for(state,expense['merchantId'])
                if not merchant or merchant.get('category') not in available_categories(state): raise ValueError('Сначала задайте категорию магазину')
                expense['category']=merchant['category']
            else:
                if action.get('category') not in available_categories(state): raise ValueError('Неизвестная категория')
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
            note = str(action.get('note','')).strip()
            if len(note.encode('utf-16-le'))//2>200:
                raise ValueError('Описание слишком длинное')
            merchant_id=action.get('merchantId')
            merchant=None
            if merchant_id is not None and merchant_id != '':
                merchant=merchant_for(state,merchant_id)
                if not isinstance(merchant_id,str) or not merchant or merchant.get('hidden'):raise ValueError('Неизвестный или скрытый магазин')
                if merchant.get('category') not in available_categories(state): raise ValueError('Сначала задайте категорию магазину')
            category=merchant['category'] if merchant else action.get('category')
            if category not in available_categories(state): raise ValueError('Выберите категорию')
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
                if total < 0 and mode == 'next':
                    # Overspend larger than the next week's limit drains the following open weeks in order.
                    later = [j for j,v in enumerate(m['weeks']) if not v['closed'] and j > ids[0]]
                    deficit = -total
                    if deficit > sum(m['weeks'][j]['limit'] for j in later):
                        raise ValueError(OVERSPEND_ERROR)
                    m['weeks'][ids[0]]['limit'] = 0
                    for j in later:
                        take = min(m['weeks'][j]['limit'], deficit)
                        m['weeks'][j]['limit'] -= take
                        deficit -= take
                else:
                    if total < 0:
                        raise ValueError(OVERSPEND_ERROR)
                    rebalance(m, ids, total)
                w['settled'] = spent(m,i)
            w['closed'] = True
        else:
            raise ValueError('Неизвестное действие')
    return state
