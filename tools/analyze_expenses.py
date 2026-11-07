"""Build a sanitized merchant dictionary and a private chronological holdout."""
import collections
import datetime as dt
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
MAPPING = {
    'Супермаркеты':'Продукты', 'Фастфуд':'Фастфуд', 'Рестораны':'Рестораны',
    'Кофейни':'Кофейни', 'Местный транспорт':'Транспорт', 'Такси':'Транспорт',
    'Аптеки':'Здоровье', 'Медицина':'Здоровье', 'Одежда и обувь':'Одежда и обувь',
    'Тренировки':'Спорт', 'Мобильная связь':'Связь и интернет', 'Связь':'Связь и интернет',
    'Красота':'Красота', 'Детские товары':'Дети', 'Подарки и творчество':'Подарки и творчество',
    'Книги и канцтовары':'Книги и образование', 'Образование':'Книги и образование',
    'Развлечения':'Развлечения', 'Кино':'Развлечения', 'Искусство':'Развлечения',
    'Лотереи':'Развлечения', 'Цветы':'Подарки и творчество', 'Маркетплейсы':'Покупки',
    'Различные товары':'Покупки', 'Ремонт и мебель':'Дом', 'Турагентства':'Путешествия',
    'Цифровые товары':'Подписки и цифровые сервисы', 'Экосистема Яндекс':'Подписки и цифровые сервисы',
}
def norm(s):
    return re.sub(r'\s+', ' ', s.lower().replace('ё','е').replace('\xa0',' ')).strip()

def main():
    with zipfile.ZipFile(next(ROOT.glob('*.xlsx'))) as z:
        strings = [''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',NS)]
        rows=[]
        for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//m:sheetData/m:row',NS)[1:]:
            record={}
            for cell in row:
                v=cell.find('m:v',NS)
                value=v.text if v is not None else ''
                if cell.get('t')=='s': value=strings[int(value)]
                record[re.sub(r'\d','',cell.get('r'))]=value
            rows.append(record)
    train=collections.defaultdict(set); holdout=[]; excluded=0
    for row in rows:
        description=row.get('G','').strip()
        # Preserve capitalization of multiword bank labels such as «Экосистема Яндекс».
        category=next((v for k,v in MAPPING.items() if norm(k)==norm(row.get('E') or row['D'])),None)
        if (not category or row['D'] in ['Переводы','Наличные','Кредиты'] or
            re.search(r'\+?\d[\d ()-]{6,}|\b(?:IP|ИП)\b|[А-ЯA-Z]\.',description) or
            norm(description) in ['магазин','кафе','пекарня','сервис, услуги','еда','foreignpay']):
            excluded+=1;continue
        date=(dt.datetime(1899,12,30)+dt.timedelta(days=float(row['A']))).date().isoformat()
        if date<'2026-10-01': train[description].add(category)
        else: holdout.append({'note':description,'category':category,'date':date,'amount':round(abs(float(row['B']))*100)})
    dictionary=[{'note':k,'category':next(iter(v))} for k,v in sorted(train.items()) if len(v)==1]
    (ROOT/'web/expense-history.js').write_text('// Sanitized merchant labels, July–September 2026. No amounts or account details.\nglobalThis.ExpenseHistory = '+json.dumps(dictionary,ensure_ascii=False,indent=2)+';\n','utf-8')
    private=ROOT/'data/expense-analysis';private.mkdir(parents=True,exist_ok=True)
    (private/'holdout.json').write_text(json.dumps(holdout,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({'rows':len(rows),'excluded':excluded,'training_merchants':len(train),'unambiguous_rules':len(dictionary),'holdout_rows':len(holdout)},ensure_ascii=True))
if __name__=='__main__':main()
