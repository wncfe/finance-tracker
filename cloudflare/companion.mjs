import { createHash, randomBytes } from "node:crypto";
import { apply, spent, todayAt } from "./budget.mjs";
import { loadFinance, financeWrites } from "./finance-store.mjs";
import "../web/expense-parser.js";
import "../web/expense-history.js";

const hash = (s) => createHash("sha256").update(s).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const reply = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
class InputError extends Error {}
const check = (ok, message) => {
  if (!ok) throw new InputError(message);
};
const project = (r) => ({
  id: r.id,
  text: r.raw_text,
  items: JSON.parse(r.items),
  status: r.status,
  created: r.created,
});
export function summary(state, today = todayAt()) {
  const m = state.months[today.slice(0, 7)],
    day = Number(today.slice(8));
  const i = m?.weeks.findIndex((w) => w.start <= day && w.end >= day) ?? -1;
  if (i < 0)
    return {
      today,
      remaining: null,
      todaySpent: 0,
      daysLeft: null,
      topCategories: [],
      progress: 0,
    };
  const w = m.weeks[i],
    total = spent(m, i),
    groups = new Map();
  for (const e of m.expenses.filter((e) => e.week === i))
    groups.set(e.category, (groups.get(e.category) || 0) + e.amount);
  return {
    today,
    remaining: w.limit - total,
    todaySpent: m.expenses
      .filter((e) => e.date === today)
      .reduce((s, e) => s + e.amount, 0),
    daysLeft: w.end - day,
    progress: w.limit > 0 ? Math.min(1, total / w.limit) : 0,
    topCategories: [...groups]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([name, amount]) => ({ name, amount })),
  };
}

// Device bearer tokens are deliberately accepted only by this router.
export async function companion(request, db, sessionUser) {
  const path = new URL(request.url).pathname.slice("/api/companion/".length),
    now = Math.floor(Date.now() / 1000);
  try {
    const origin = request.headers.get("Origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("Sec-Fetch-Site") === "cross-site"
    )
      return reply(403, { error: "Недопустимый источник запроса" });
    let data = {};
    if (request.method === "POST") {
      if (
        request.headers.get("Content-Type")?.split(";")[0] !==
        "application/json"
      )
        return reply(415, { error: "Ожидается JSON" });
      const body = await request.text();
      if (body.length > 32000)
        return reply(413, { error: "Слишком большой запрос" });
      data = JSON.parse(body);
      check(
        data && typeof data === "object" && !Array.isArray(data),
        "Некорректный запрос",
      );
    } else if (request.method !== "GET")
      return reply(405, { error: "Метод не поддерживается" });
    if (path === "exchange" && request.method === "POST") {
      check(
        typeof data.code === "string" && /^[A-Za-z0-9_-]{43}$/.test(data.code),
        "Некорректный код подключения",
      );
      if (data.accountId != null) {
        const pairing = await db
          .prepare(
            "SELECT user_id FROM companion_pairings WHERE code=? AND expires>?",
          )
          .bind(hash(data.code), now)
          .first();
        if (pairing && pairing.user_id !== data.accountId)
          return reply(409, {
            error:
              "Код относится к другому аккаунту. Сначала проверьте старые отправки и удалите локальные данные.",
          });
      }
      const token = secret(),
        id = crypto.randomUUID();
      const results = await db.batch([
        db
          .prepare(
            "INSERT INTO companion_devices(id,user_id,name,token,expires,created) SELECT ?,user_id,?,?,?,? FROM companion_pairings WHERE code=? AND expires>?",
          )
          .bind(
            id,
            String(data.name || "Android").slice(0, 80),
            hash(token),
            now + 7776000,
            now,
            hash(data.code),
            now,
          ),
        db
          .prepare("DELETE FROM companion_pairings WHERE code=?")
          .bind(hash(data.code)),
      ]);
      const device =
        results[0].meta.changes === 1
          ? await db
              .prepare("SELECT user_id FROM companion_devices WHERE id=?")
              .bind(id)
              .first()
          : null;
      return device
        ? reply(200, {
            token,
            deviceId: id,
            accountId: device.user_id,
            expires: now + 7776000,
          })
        : reply(401, {
            error: "Код истёк или уже использован. Создайте новый в PWA",
          });
    }
    const native =
      path === "summary" || path === "submit" || path.startsWith("status/");
    let u;
    if (native) {
      const token = request.headers
        .get("Authorization")
        ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      u = token
        ? await db
            .prepare(
              "SELECT user_id AS id,id AS deviceId FROM companion_devices WHERE token=? AND expires>?",
            )
            .bind(hash(token), now)
            .first()
        : null;
    } else u = await sessionUser();
    if (!u) return reply(401, { error: "Подключите устройство заново" });
    if (path === "pair" && request.method === "POST") {
      const code = secret();
      await db.batch([
        db
          .prepare(
            "DELETE FROM companion_pairings WHERE user_id=? OR expires<=?",
          )
          .bind(u.id, now),
        db
          .prepare(
            "INSERT INTO companion_pairings(code,user_id,expires) VALUES(?,?,?)",
          )
          .bind(hash(code), u.id, now + 600),
      ]);
      return reply(200, { code, expires: now + 600 });
    }
    if (path === "devices" && request.method === "GET")
      return reply(200, {
        devices: (
          await db
            .prepare(
              "SELECT id,name,expires,created FROM companion_devices WHERE user_id=? ORDER BY created DESC",
            )
            .bind(u.id)
            .all()
        ).results,
      });
    if (path === "revoke" && request.method === "POST") {
      await db
        .prepare("DELETE FROM companion_devices WHERE user_id=? AND id=?")
        .bind(u.id, String(data.id))
        .run();
      return reply(200, {});
    }
    if (path === "summary" && request.method === "GET")
      return reply(200, {
        ...summary((await loadFinance(db, u.id)).state),
        syncedAt: Date.now(),
      });
    const getEntry = (id) =>
      db
        .prepare("SELECT * FROM companion_inbox WHERE user_id=? AND id=?")
        .bind(u.id, id)
        .first();
    if (path.startsWith("status/") && request.method === "GET") {
      const r = await getEntry(path.slice(7));
      return r
        ? reply(200, project(r))
        : reply(404, { error: "Операция не найдена" });
    }
    if (path === "submit" && request.method === "POST") {
      check(
        typeof data.operationId === "string" &&
          /^[a-zA-Z0-9-]{16,80}$/.test(data.operationId),
        "Некорректный ID операции",
      );
      check(
        typeof data.text === "string" &&
          data.text.trim().length > 0 &&
          data.text.length <= 4000,
        "Введите от 1 до 4000 символов",
      );
      const payload = hash(data.text);
      const respond = async (entry) => {
        if (entry.payload !== payload)
          return reply(409, { error: "ID уже использован для другого текста" });
        return reply(200, {
          ...project(entry),
          ...(entry.status === "confirmed"
            ? {
                summary: {
                  ...summary((await loadFinance(db, u.id)).state),
                  syncedAt: Date.now(),
                },
              }
            : {}),
        });
      };
      // Old pending receipts remain pending. A retry never changes how an existing request was handled.
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await getEntry(data.operationId);
        if (existing) return respond(existing);
        const snapshot = await loadFinance(db, u.id);
        const parsed = globalThis.ExpenseParser.parse(data.text, {
          today: new Date(todayAt() + "T12:00:00Z"),
          history: Object.values(snapshot.state.months).flatMap(
            (m) => m.expenses,
          ),
        });
        check(
          parsed.length > 0 && parsed.length <= 50,
          "Добавьте от 1 до 50 расходов",
        );
        // Explicit draft mode only supports old clients/tests; the normal path saves immediately.
        if (data.mode === "draft") {
          await db
            .prepare(
              "INSERT INTO companion_inbox(user_id,id,device_id,payload,raw_text,items,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO NOTHING",
            )
            .bind(
              u.id,
              data.operationId,
              u.deviceId,
              payload,
              data.text,
              JSON.stringify(parsed),
              now,
            )
            .run();
          return respond(await getEntry(data.operationId));
        }
        for (const row of parsed) {
          check(
            row.amount != null && row.date && !row.issues.length,
            `${row.raw}: ${row.issues.join(". ") || "Уточните сумму и дату"}`,
          );
        }
        const items = parsed.map((row) => ({
          date: row.date,
          amount: row.amount,
          category: row.category || "Другое",
          note: row.note,
        }));
        let after;
        try {
          after = apply(snapshot.state, { type: "expenses", items });
        } catch (e) {
          throw new InputError(e.message);
        }
        const mutation = secret();
        // The receipt and financial rows commit together. CAS serializes concurrent devices/PWA writes.
        const results = await db.batch([
          db
            .prepare(
              "UPDATE users SET revision=revision+1,mutation_token=? WHERE id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM companion_inbox WHERE user_id=? AND id=?)",
            )
            .bind(mutation, u.id, snapshot.revision, u.id, data.operationId),
          ...financeWrites(db, u.id, snapshot.state, after, mutation),
          db
            .prepare(
              "INSERT INTO companion_inbox(user_id,id,device_id,payload,raw_text,items,status,created) SELECT ?,?,?,?,?,?,'confirmed',? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_token=?)",
            )
            .bind(
              u.id,
              data.operationId,
              u.deviceId,
              payload,
              data.text,
              JSON.stringify(items),
              now,
              u.id,
              mutation,
            ),
          db
            .prepare(
              "UPDATE users SET mutation_token=NULL WHERE id=? AND mutation_token=?",
            )
            .bind(u.id, mutation),
        ]);
        if (results[0].meta.changes === 1)
          return respond(await getEntry(data.operationId));
      }
      const existing = await getEntry(data.operationId);
      return existing
        ? respond(existing)
        : reply(409, {
            error:
              "Бюджет сейчас меняется. Повторите отправку — дубликата не будет",
          });
    }
    if (path === "inbox" && request.method === "GET")
      return reply(200, {
        entries: (
          await db
            .prepare(
              "SELECT * FROM companion_inbox WHERE user_id=? AND status='pending' ORDER BY created LIMIT 100",
            )
            .bind(u.id)
            .all()
        ).results.map(project),
      });
    if (path === "review" && request.method === "POST") {
      check(
        typeof data.id === "string" &&
          ["confirmed", "dismissed"].includes(data.status),
        "Некорректное решение",
      );
      const r = await getEntry(data.id);
      if (!r) return reply(404, { error: "Черновик не найден" });
      const reviewPayload = hash(
        JSON.stringify({ status: data.status, items: data.items || [] }),
      );
      if (r.status !== "pending")
        return r.review_payload === reviewPayload
          ? reply(200, project(r))
          : reply(409, { error: "Черновик уже обработан" });
      const snapshot = await loadFinance(db, u.id);
      let after = snapshot.state;
      // apply() validates dates, amounts, categories, closed weeks and merchant IDs.
      if (data.status === "confirmed") {
        check(Array.isArray(data.items), "Добавьте расходы");
        try {
          after = apply(snapshot.state, {
            type: "expenses",
            items: data.items.map((e) => {
              check(e && typeof e === "object", "Некорректный расход");
              return {
                date: e.date,
                amount: e.amount,
                category: e.category,
                note: e.note,
              };
            }),
          });
        } catch (e) {
          throw new InputError(e.message);
        }
      }
      const token = secret();
      const results = await db.batch([
        db
          .prepare(
            "UPDATE users SET revision=revision+1,mutation_token=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM companion_inbox WHERE user_id=? AND id=? AND status='pending')",
          )
          .bind(token, u.id, snapshot.revision, u.id, data.id),
        ...financeWrites(db, u.id, snapshot.state, after, token),
        db
          .prepare(
            "UPDATE companion_inbox SET status=?,items=?,review_payload=? WHERE user_id=? AND id=? AND status='pending' AND EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_token=?)",
          )
          .bind(
            data.status,
            JSON.stringify(data.items || JSON.parse(r.items)),
            reviewPayload,
            u.id,
            data.id,
            u.id,
            token,
          ),
        db
          .prepare(
            "UPDATE users SET mutation_token=NULL WHERE id=? AND mutation_token=?",
          )
          .bind(u.id, token),
      ]);
      if (results[0].meta.changes !== 1)
        return reply(409, {
          error: "Данные изменились. Обновите очередь и повторите",
        });
      return reply(200, project(await getEntry(data.id)));
    }
    return reply(404, { error: "Не найдено" });
  } catch (e) {
    if (e instanceof SyntaxError)
      return reply(400, { error: "Некорректный JSON" });
    // Do not expose database errors or raw financial input in logs/responses.
    if (e instanceof InputError) return reply(400, { error: e.message });
    return reply(503, {
      error: "Сервис временно недоступен. Повторите с тем же ID",
    });
  }
}
