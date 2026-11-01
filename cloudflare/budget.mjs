export const categories=['Супермаркеты','Кафе','Транспорт','Дом','Здоровье','Покупки','Развлечения','Другое'];
function check(ok,message='Некорректные данные'){if(!ok)throw Error(message)}
export function amount(n,positive=false){check(Number.isSafeInteger(n)&&n>=(positive?1:0)&&n<=1e10,'Некорректная сумма');return n}
export function weeks(key){check(typeof key==='string'&&/^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(key),'Некорректный месяц');const [y,m]=key.split('-').map(Number),days=new Date(Date.UTC(y,m,0)).getUTCDate(),result=[];for(let start=1;start<=days;){const end=Math.min(days,start+6-(new Date(Date.UTC(y,m-1,start)).getUTCDay()+6)%7);result.push({start,end,days:end-start+1});start=end+1}return result}
export function allocate(total,weights){check(total>=0,'Бюджета недостаточно для сохранения закрытых лимитов');if(!weights.length){check(total===0,'Нет открытых недель для перераспределения');return []}const sum=weights.reduce((a,b)=>a+b,0);let used=0,cumulative=0;return weights.map(w=>{cumulative+=w;const target=Math.floor(total*cumulative/sum),value=target-used;used=target;return value})}
function rebalance(m,ids,total){allocate(total,ids.map(i=>m.weeks[i].days)).forEach((n,j)=>m.weeks[ids[j]].limit=n)}
function ensure(state,key){weeks(key);return state.months[key]??=( {budget:0,incoming:0,outgoing:0,weeks:weeks(key).map(w=>({...w,limit:0,closed:false})),expenses:[]})}
export const spent=(m,i)=>m.expenses.filter(e=>i===undefined||e.week===i).reduce((s,e)=>s+e.amount,0);
function previous(key){const [y,m]=key.split('-').map(Number),d=new Date(Date.UTC(y,m-1,0));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`}
function validDate(value,key,w){check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value),'Некорректная дата');const d=new Date(value+'T12:00:00Z');check(!isNaN(d)&&d.toISOString().slice(0,10)===value&&value.slice(0,7)===key&&d.getUTCDate()>=w.start&&d.getUTCDate()<=w.end,'Дата должна попадать в выбранную неделю')}
export function apply(original,action){
 const state=structuredClone(original),key=action.month,m=ensure(state,key),effective=m.budget+m.incoming-m.outgoing,type=action.type;
 const open=()=>m.weeks.flatMap((w,i)=>w.closed?[]:[i]),closedTotal=()=>m.weeks.filter(w=>w.closed).reduce((s,w)=>s+w.limit,0);
 if(type==='budget'){m.budget=amount(action.amount);rebalance(m,open(),m.budget+m.incoming-m.outgoing-closedTotal())}
 else if(type==='transfer'){const source=state.months[previous(key)];check(source&&source.weeks.every(w=>w.closed),'Сначала закройте все недели предыдущего месяца');const value=amount(action.amount,true);check(value<=source.budget+source.incoming-source.outgoing-spent(source),'Недостаточно остатка для переноса');source.outgoing+=value;m.incoming+=value;rebalance(m,open(),effective+value-closedTotal())}
 else{
  const i=action.week;check(Number.isInteger(i)&&i>=0&&i<m.weeks.length,'Некорректная неделя');const w=m.weeks[i];check(!w.closed,'Неделя закрыта');
  if(type==='expense'){validDate(action.date,key,w);check(categories.includes(action.category),'Неизвестная категория');const note=String(action.note||'').trim();check(note.length<=200,'Описание слишком длинное');m.expenses.push({id:crypto.randomUUID().replaceAll('-',''),week:i,amount:amount(action.amount,true),date:action.date,category:action.category,note})}
  else if(type==='delete'){m.expenses=m.expenses.filter(e=>!(e.id===action.id&&e.week===i))}
  else if(type==='limit'){const value=amount(action.amount);rebalance(m,open().filter(j=>j!==i),effective-closedTotal()-value);w.limit=value}
  else if(type==='close'){check(m.weeks.slice(0,i).every(w=>w.closed),'Сначала закройте предыдущие недели');check(['next','remaining','month'].includes(action.mode),'Выберите способ распределения');let ids=open().filter(j=>j>i);if(action.mode==='next')ids=ids.slice(0,1);if(ids.length){rebalance(m,ids,ids.reduce((s,j)=>s+m.weeks[j].limit,0)+w.limit-spent(m,i));w.limit=spent(m,i)}w.closed=true}
  else throw Error('Неизвестное действие');
 }
 return state;
}
export function validate(raw){
 check(raw&&raw.months&&typeof raw.months==='object'&&!Array.isArray(raw.months)&&Object.keys(raw.months).length<=1300,'Некорректная резервная копия');
 for(const [key,m]of Object.entries(raw.months)){
  const ws=weeks(key);check(m&&Array.isArray(m.weeks)&&m.weeks.length===ws.length&&Array.isArray(m.expenses)&&m.expenses.length<=100000,'Некорректный месяц');
  const total=amount(m.budget)+amount(m.incoming),outgoing=amount(m.outgoing);
  check(!outgoing||(m.weeks.every(w=>w.closed)&&outgoing<=total-spent(m)),'Некорректный перенос');
  m.weeks.forEach((w,i)=>{check(w&&['start','end','days'].every(k=>w[k]===ws[i][k])&&typeof w.closed==='boolean','Некорректная неделя');amount(w.limit)});
  check(m.weeks.reduce((s,w)=>s+w.limit,0)===total,'Сумма лимитов не совпадает с бюджетом');
  const ids=new Set();for(const e of m.expenses){amount(e.amount,true);check(Number.isInteger(e.week)&&e.week>=0&&e.week<ws.length&&categories.includes(e.category)&&typeof e.note==='string'&&e.note.length<=200&&typeof e.id==='string'&&e.id.length>0&&e.id.length<=100&&!ids.has(e.id),'Некорректная трата');ids.add(e.id);validDate(e.date,key,ws[e.week])}
 }
 return structuredClone(raw);
}
export function migrate(raw){
 check(raw?.format==='po-nedelyam','Ожидается резервная копия бюджета');if(raw.version===2)return validate({months:raw.months});check(raw.version===1&&raw.months&&typeof raw.months==='object'&&Object.keys(raw.months).length<=1300,'Некорректная резервная копия');
 const state={months:{}};for(const [key,old] of Object.entries(raw.months)){const m=ensure(state,key);m.budget=amount(old.budget);rebalance(m,m.weeks.map((_,i)=>i),m.budget);check(Array.isArray(old.spent)&&old.spent.length===m.weeks.length&&Number.isInteger(old.closed)&&old.closed>=0&&old.closed<=m.weeks.length,'Некорректные недели');m.weeks.forEach((w,i)=>{const value=amount(old.spent[i]);if(value)m.expenses.push({id:crypto.randomUUID().replaceAll('-',''),week:i,amount:value,date:`${key}-${String(w.start).padStart(2,'0')}`,category:'Другое',note:'Импорт: итог недели'});w.closed=i<old.closed;if(w.closed)w.limit=value});const ids=m.weeks.flatMap((w,i)=>w.closed?[]:[i]),remaining=m.budget-m.weeks.filter(w=>w.closed).reduce((s,w)=>s+w.limit,0);check(remaining>=0,'Старый месяц перерасходован: увеличьте бюджет перед импортом');if(ids.length)rebalance(m,ids,remaining);else m.weeks.at(-1).limit+=remaining}return state;
}
