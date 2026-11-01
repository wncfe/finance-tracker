import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { validate } from '../../../lib/budget';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'no-store, private','Vary':'Cookie'}});
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return reply({error:'Войди через ChatGPT.'},401);
  try {
    if (!env.DB) throw new Error('DB unavailable');
    const row = await env.DB.prepare('SELECT version, data, updated_at FROM budget_documents WHERE user_id = ?').bind(user.userId).first<{version:number,data:string,updated_at:number}>();
    return reply({document:row?JSON.parse(row.data):null, version:row?.version||0, updatedAt:row?.updated_at||null});
  } catch { return reply({error:'Не удалось загрузить бюджет. Попробуй ещё раз.'},503); }
}
export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({error:'Войди через ChatGPT.'},401);
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('x-budget-request') !== '1') return reply({error:'Недопустимый запрос.'},403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({error:'Требуется JSON.'},415);
  let body: any, document: any;
  try {
    if (Number(request.headers.get('content-length')||0)>5e6) return reply({error:'Файл слишком большой.'},413);
    const text=await request.text();
    if(text.length>5e6) return reply({error:'Файл слишком большой.'},413);
    body=JSON.parse(text);
    if(!Number.isSafeInteger(body.version)||body.version<0) throw new Error();
    document=validate(body.document);
  } catch { return reply({error:'Некорректные данные бюджета.'},400); }
  try {
    if(!env.DB) throw new Error('DB unavailable');
    const updatedAt=Date.now(), encoded=JSON.stringify(document);
    const row=body.version===0
      ?await env.DB.prepare('INSERT INTO budget_documents (user_id, version, data, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(user_id) DO NOTHING RETURNING version').bind(user.userId,encoded,updatedAt).first<{version:number}>()
      :await env.DB.prepare('UPDATE budget_documents SET data = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ? RETURNING version').bind(encoded,updatedAt,user.userId,body.version).first<{version:number}>();
    if(!row) return reply({error:'Бюджет изменился на другом устройстве.'},409);
    return reply({version:row.version,updatedAt});
  } catch { return reply({error:'Не удалось сохранить бюджет. Изменения остались на устройстве.'},503); }
}
