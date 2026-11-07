"""Generate the versioned schema migration; never connects to production."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import budget

slugs=['groceries','fast-food','restaurants','coffee','transport','home','health','shopping','clothes','beauty','sport','children','gifts','education','telecom','subscriptions','travel','entertainment','other','legacy-supermarkets','legacy-cafe']
sql="""-- Read/write this schema only with the normalized repository.
-- Run in one migration transaction. A pre-migration SQL export is required.
CREATE TABLE normalization_check (valid INTEGER NOT NULL CHECK(valid=1));
INSERT INTO normalization_check SELECT CASE WHEN EXISTS (
 SELECT 1 FROM users u, json_each(u.state) k WHERE k.key <> 'months'
) OR EXISTS (
 SELECT 1 FROM users u WHERE json_type(u.state,'$.months') IS NOT 'object'
) OR EXISTS (
 SELECT 1 FROM users u,json_each(u.state,'$.months') m,json_each(m.value) k
 WHERE k.key NOT IN ('budget','incoming','outgoing','weeks','expenses')
) OR EXISTS (
 SELECT 1 FROM users u,json_each(u.state,'$.months') m,json_each(m.value,'$.weeks') w,json_each(w.value) k
 WHERE k.key NOT IN ('start','end','days','limit','closed','settled')
) OR EXISTS (
 SELECT 1 FROM users u,json_each(u.state,'$.months') m,json_each(m.value,'$.expenses') e,json_each(e.value) k
 WHERE k.key NOT IN ('id','week','amount','date','category','note')
) THEN 0 ELSE 1 END;
DROP TABLE normalization_check;
ALTER TABLE users ADD COLUMN mutation_token TEXT;
CREATE TABLE categories (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE
);
CREATE TABLE months (
 user_id INTEGER NOT NULL REFERENCES users(id),
 month TEXT NOT NULL CHECK(length(month)=7 AND month BETWEEN '2000-01' AND '2100-12' AND substr(month,6,2) BETWEEN '01' AND '12'),
 budget INTEGER NOT NULL CHECK(typeof(budget)='integer' AND budget>=0),
 incoming INTEGER NOT NULL CHECK(typeof(incoming)='integer' AND incoming>=0),
 outgoing INTEGER NOT NULL CHECK(typeof(outgoing)='integer' AND outgoing>=0),
 PRIMARY KEY(user_id,month)
);
CREATE TABLE weeks (
 user_id INTEGER NOT NULL, month TEXT NOT NULL, week_index INTEGER NOT NULL CHECK(week_index BETWEEN 0 AND 5),
 start_day INTEGER NOT NULL CHECK(start_day BETWEEN 1 AND 31),
 end_day INTEGER NOT NULL CHECK(end_day BETWEEN start_day AND 31),
 days INTEGER NOT NULL CHECK(days=end_day-start_day+1),
 limit_amount INTEGER NOT NULL CHECK(typeof(limit_amount)='integer' AND limit_amount>=0),
 closed INTEGER NOT NULL CHECK(closed IN (0,1)),
 settled INTEGER CHECK(settled IS NULL OR (typeof(settled)='integer' AND settled>=0)),
 PRIMARY KEY(user_id,month,week_index),
 FOREIGN KEY(user_id,month) REFERENCES months(user_id,month)
);
CREATE TABLE expenses (
 user_id INTEGER NOT NULL, id TEXT NOT NULL, month TEXT NOT NULL, week_index INTEGER NOT NULL,
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND 10000000000),
 date TEXT NOT NULL CHECK(length(date)=10 AND substr(date,1,7)=month AND date(date,'+0 days') IS NOT NULL AND date(date,'+0 days')=date),
 category_id TEXT NOT NULL REFERENCES categories(id), note TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position>=0),
 PRIMARY KEY(user_id,id),
 FOREIGN KEY(user_id,month,week_index) REFERENCES weeks(user_id,month,week_index)
);
CREATE INDEX expenses_month ON expenses(user_id,month,position);
CREATE INDEX expenses_category_date ON expenses(user_id,category_id,date);
CREATE INDEX expenses_date ON expenses(user_id,date);
"""
for slug,name in zip(slugs,['Продукты', 'Фастфуд', 'Рестораны', 'Кофейни', 'Транспорт', 'Дом', 'Здоровье', 'Покупки', 'Одежда и обувь', 'Красота', 'Спорт', 'Дети', 'Подарки и творчество', 'Книги и образование', 'Связь и интернет', 'Подписки и цифровые сервисы', 'Путешествия', 'Развлечения', 'Другое', 'Супермаркеты', 'Кафе']):
    sql+=f"INSERT INTO categories(id,name) VALUES('{slug}','{name.replace(chr(39),chr(39)*2)}');\n"
sql+="""
INSERT INTO categories(id,name)
 SELECT DISTINCT 'imported:'||json_extract(e.value,'$.category'),json_extract(e.value,'$.category')
 FROM users u,json_each(u.state,'$.months') m,json_each(m.value,'$.expenses') e
 WHERE NOT EXISTS(SELECT 1 FROM categories WHERE name=json_extract(e.value,'$.category'));
INSERT INTO months
 SELECT u.id,m.key,json_extract(m.value,'$.budget'),json_extract(m.value,'$.incoming'),json_extract(m.value,'$.outgoing')
 FROM users u,json_each(u.state,'$.months') m;
INSERT INTO weeks
 SELECT u.id,m.key,CAST(w.key AS INTEGER),json_extract(w.value,'$.start'),json_extract(w.value,'$.end'),json_extract(w.value,'$.days'),json_extract(w.value,'$.limit'),json_extract(w.value,'$.closed'),json_extract(w.value,'$.settled')
 FROM users u,json_each(u.state,'$.months') m,json_each(m.value,'$.weeks') w;
INSERT INTO expenses
 SELECT u.id,json_extract(e.value,'$.id'),m.key,json_extract(e.value,'$.week'),json_extract(e.value,'$.amount'),json_extract(e.value,'$.date'),c.id,json_extract(e.value,'$.note'),CAST(e.key AS INTEGER)
 FROM users u,json_each(u.state,'$.months') m,json_each(m.value,'$.expenses') e
 JOIN categories c ON c.name=json_extract(e.value,'$.category');
CREATE TABLE normalization_check (valid INTEGER NOT NULL CHECK(valid=1));
INSERT INTO normalization_check SELECT CASE WHEN
 (SELECT count(*) FROM months)=(SELECT count(*) FROM users u,json_each(u.state,'$.months') m)
 AND (SELECT count(*) FROM weeks)=(SELECT count(*) FROM users u,json_each(u.state,'$.months') m,json_each(m.value,'$.weeks') w)
 AND (SELECT count(*) FROM expenses)=(SELECT count(*) FROM users u,json_each(u.state,'$.months') m,json_each(m.value,'$.expenses') e)
 THEN 1 ELSE 0 END;
DROP TABLE normalization_check;
ALTER TABLE users DROP COLUMN state;
"""
(Path(__file__).resolve().parents[1]/'cloudflare/migrations/0003_normalized_finances.sql').write_text(sql,'utf-8')
