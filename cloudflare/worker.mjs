import {
  scryptSync,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { apply, todayAt } from "./budget.mjs";
import { loadFinance, financeWrites } from "./finance-store.mjs";
import { companion } from "./companion.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const pw = (value, salt) =>
  scryptSync(value, Buffer.from(salt, "hex"), 64, {
    N: 16384,
    r: 8,
    p: 1,
  }).toString("hex");
const json = (status, value, cookie) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { ...value, today: todayAt(), timeZone: "Asia/Yekaterinburg" }
        : value,
    ),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(cookie ? { "Set-Cookie": cookie } : {}),
      },
    },
  );
// Unknown logins still pay for one scrypt so response time does not reveal which accounts exist.
const DUMMY_SALT = "00".repeat(16);
const CONFLICT = "Данные изменены в другой вкладке. Обновите страницу";
function equal(a, b) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function user(request, db) {
  const cookie = request.headers.get("Cookie") || "",
    token = cookie.match(/(?:^|;\s*)__Host-session=([^;]+)/)?.[1];
  if (!token) return null;
  return db
    .prepare(
      "SELECT users.id,login FROM users JOIN sessions ON sessions.user=users.id WHERE token=? AND expires>?",
    )
    .bind(hash(token), Math.floor(Date.now() / 1000))
    .first();
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url),
      path = url.pathname,
      db = env.DB;
    if (path.startsWith("/api/") && env.FINANCE_MAINTENANCE === "1")
      return new Response(
        JSON.stringify({
          error:
            "Обновляем приложение. Повторите действие через несколько минут.",
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Retry-After": "60",
          },
        },
      );
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (path.startsWith("/api/companion/"))
        return await companion(request, db, () => user(request, db));
      if (path === "/api/config" && request.method === "GET")
        return json(200, { invitationRequired: true });
      if (path === "/api/state" && request.method === "GET") {
        const u = await user(request, db);
        return u
          ? json(200, {
              login: u.login,
              ...(await loadFinance(db, u.id)),
            })
          : json(401, { error: "Войдите в аккаунт" });
      }
      if (request.method !== "POST")
        return json(405, { error: "Метод не поддерживается" });
      const origin = request.headers.get("Origin");
      if (
        (origin && origin !== url.origin) ||
        request.headers.get("Sec-Fetch-Site") === "cross-site"
      )
        return json(403, { error: "Недопустимый источник запроса" });
      if (
        request.headers.get("Content-Type")?.split(";")[0] !==
        "application/json"
      )
        return json(415, { error: "Ожидается JSON" });
      if (Number(request.headers.get("Content-Length")) > 5e6)
        return json(413, { error: "Файл слишком большой" });
      const body = await request.text();
      if (body.length > 5e6)
        return json(413, { error: "Файл слишком большой" });
      const data = JSON.parse(body),
        now = Math.floor(Date.now() / 1000);
      if (!data || typeof data !== "object" || Array.isArray(data))
        return json(400, { error: "Некорректный запрос" });
      if (path === "/api/login" || path === "/api/register") {
        const ip = hash(request.headers.get("CF-Connecting-IP") || "local");
        // Count every authentication request before expensive password hashing.
        const rate = await db
          .prepare(
            "INSERT INTO attempts(ip,count,until) VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN until>? THEN count+1 ELSE 1 END,until=CASE WHEN until>? THEN until ELSE excluded.until END RETURNING count",
          )
          .bind(ip, now + 900, now, now)
          .first();
        if (rate.count > 20)
          return json(429, {
            error: "Слишком много попыток. Повторите через 15 минут",
          });
        const login = String(data.login || "")
            .trim()
            .toLowerCase(),
          password = String(data.password || "");
        if (
          login.length < 3 ||
          login.length > 80 ||
          password.length < 10 ||
          password.length > 256
        )
          return json(400, {
            error: "Логин: 3–80 символов. Пароль: 10–256 символов",
          });
        if (path === "/api/register") {
          if (
            !env.REGISTRATION_CODE ||
            !equal(String(data.invite || ""), env.REGISTRATION_CODE)
          )
            return json(403, {
              error: "Для регистрации нужен код приглашения",
            });
          const salt = randomBytes(16).toString("hex");
          try {
            await db
              .prepare("INSERT INTO users(login,salt,password) VALUES(?,?,?)")
              .bind(login, salt, pw(password, salt))
              .run();
          } catch (e) {
            if (String(e).includes("UNIQUE"))
              return json(400, { error: "Логин уже занят" });
            throw e;
          }
        }
        const u = await db
          .prepare("SELECT id,salt,password FROM users WHERE login=?")
          .bind(login)
          .first();
        if (!u) pw(password, DUMMY_SALT);
        if (!u || !equal(pw(password, u.salt), u.password))
          return json(401, { error: "Неверный логин или пароль" });
        const token = randomBytes(32).toString("base64url");
        await db.batch([
          db.prepare("DELETE FROM sessions WHERE expires<?").bind(now),
          db.prepare("DELETE FROM attempts WHERE until<?").bind(now),
          db
            .prepare("INSERT INTO sessions(token,user,expires) VALUES(?,?,?)")
            .bind(hash(token), u.id, now + 604800),
        ]);
        return json(
          200,
          {},
          `__Host-session=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`,
        );
      }
      const u = await user(request, db);
      if (!u) return json(401, { error: "Войдите в аккаунт" });
      if (path === "/api/logout") {
        const token = (request.headers.get("Cookie") || "").match(
          /(?:^|;\s*)__Host-session=([^;]+)/,
        )?.[1];
        if (token)
          await db
            .prepare("DELETE FROM sessions WHERE token=?")
            .bind(hash(token))
            .run();
        return json(
          200,
          {},
          "__Host-session=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
      }
      if (path !== "/api/action") return json(404, { error: "Не найдено" });
      if (
        !data.action ||
        typeof data.action !== "object" ||
        Array.isArray(data.action)
      )
        return json(400, { error: "Некорректное действие" });
      const operationId = data.operationId;
      if (
        typeof operationId !== "string" ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(operationId)
      )
        return json(400, { error: "Некорректный идентификатор операции" });
      const payload = hash(JSON.stringify(data.action));
      // A stored receipt means the operation already committed: replay it instead of applying again.
      const replay = async () => {
        const receipt = await db
          .prepare("SELECT payload FROM operations WHERE user=? AND id=?")
          .bind(u.id, operationId)
          .first();
        if (!receipt) return null;
        if (receipt.payload !== payload)
          return json(409, { error: "Идентификатор операции уже использован" });
        return json(200, await loadFinance(db, u.id));
      };
      const replayed = await replay();
      if (replayed) return replayed;
      const snapshot = await loadFinance(db, u.id);
      if (data.revision !== snapshot.revision)
        return json(409, { error: CONFLICT });
      let state;
      try {
        state = apply(snapshot.state, data.action);
      } catch (e) {
        return json(400, { error: e.message });
      }
      if (data.action.type === "category_save") {
        // Categories are shared between accounts: an id already used for another name cannot be linked.
        const created = state.userCategories.find(
          (c) => c.id === data.action.category.id,
        );
        const taken = await db
          .prepare("SELECT name FROM categories WHERE id=?")
          .bind(created.id)
          .first();
        if (taken && taken.name !== created.name)
          return json(400, { error: "Некорректный идентификатор категории" });
      }
      const token = randomBytes(24).toString("hex");
      const results = await db.batch([
        db
          .prepare(
            "UPDATE users SET revision=revision+1,mutation_token=? WHERE id=? AND revision=?",
          )
          .bind(token, u.id, snapshot.revision),
        db
          .prepare(
            "INSERT INTO operations(user,id,payload) SELECT ?,?,? FROM users WHERE id=? AND mutation_token=?",
          )
          .bind(u.id, operationId, payload, u.id, token),
        ...financeWrites(db, u.id, snapshot.state, state, token),
        db
          .prepare(
            "UPDATE users SET mutation_token=NULL WHERE id=? AND mutation_token=?",
          )
          .bind(u.id, token),
      ]);
      if (results[0].meta.changes !== 1)
        // A concurrent retry of this same operation may have won the race.
        return (await replay()) || json(409, { error: CONFLICT });
      // A custom category name may already exist in the shared table: return what was actually stored.
      if (data.action.type === "category_save")
        return json(200, await loadFinance(db, u.id));
      return json(200, { state, revision: snapshot.revision + 1 });
    } catch (e) {
      if (e instanceof SyntaxError)
        return json(400, { error: "Некорректный JSON" });
      console.error("API failure", e.name);
      return json(500, {
        error: "Не удалось сохранить данные. Повторите запрос",
      });
    }
  },
};
