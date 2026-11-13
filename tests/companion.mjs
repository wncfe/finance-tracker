// Runs the actual Worker against SQLite with the D1 prepare/batch contract.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../cloudflare/worker.mjs";
import { summary } from "../cloudflare/companion.mjs";
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const file of readdirSync(
  new URL("../cloudflare/migrations/", import.meta.url),
).sort())
  sqlite.exec(
    readFileSync(
      new URL("../cloudflare/migrations/" + file, import.meta.url),
      "utf8",
    ),
  );
const db = {
  prepare(sql) {
    return {
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        return sqlite.prepare(sql).get(...this.args) || null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...this.args) };
      },
      async run() {
        const result = sqlite.prepare(sql).run(...this.args);
        return { meta: { changes: Number(result.changes) } };
      },
      sql,
    };
  },
  async batch(statements) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map((s) => {
        const stmt = sqlite.prepare(s.sql);
        if (stmt.columns().length) return { results: stmt.all(...s.args) };
        return { meta: { changes: Number(stmt.run(...s.args).changes) } };
      });
      sqlite.exec("COMMIT");
      return results;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  },
};
const env = { DB: db, REGISTRATION_CODE: "test-only" };
async function call(path, { body, cookie, token, method, origin } = {}) {
  const r = await worker.fetch(
    new Request("https://finance.test/api/" + path, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("Set-Cookie")?.split(";")[0],
  };
}
async function account(login) {
  const r = await call("register", {
    body: { login, password: "password-test-123", invite: "test-only" },
  });
  assert.equal(r.status, 200);
  return r.cookie;
}
const a = await account("alice"),
  b = await account("bob");
const c = (path, body, cookie = a) =>
  call("companion/" + path, { body, cookie });
assert.equal((await c("pair", {})).status, 200);
assert.equal((await call("companion/pair", { body: {} })).status, 401);
const pair = await c("pair", {});
assert.equal(
  (await call("companion/exchange", { body: { code: "bad" } })).status,
  400,
);
const device = await call("companion/exchange", {
  body: { code: pair.data.code, name: "Poco F5" },
});
assert.equal(device.status, 200);
assert.equal(
  (await call("companion/exchange", { body: { code: pair.data.code } })).status,
  401,
);
const token = device.data.token;
const otherPair = await c("pair", {}, b);
assert.equal(
  (
    await call("companion/exchange", {
      body: { code: otherPair.data.code, accountId: device.data.accountId },
    })
  ).status,
  409,
);
const n = (path, body) =>
  call("companion/" + path, {
    body: path === "submit" ? { mode: "draft", ...body } : body,
    token,
  });
assert.equal((await call("companion/summary")).status, 401);
assert.equal((await call("state", { token })).status, 401);
assert.equal((await n("inbox")).status, 401);
assert.equal(
  (
    await call("companion/pair", {
      body: {},
      cookie: a,
      origin: "https://evil.test",
    })
  ).status,
  403,
);
assert.equal((await n("summary")).data.remaining, null);
let state = await call("state", { cookie: a });
const today = state.data.today,
  month = today.slice(0, 7);
assert.equal(
  (
    await call("action", {
      cookie: a,
      body: {
        revision: state.data.revision,
        operationId: crypto.randomUUID(),
        action: { type: "budget", month, amount: 3100000 },
      },
    })
  ).status,
  200,
);
const before = (await n("summary")).data;
const operation = {
  operationId: crypto.randomUUID(),
  text: "кофе 250; вчера такси 430",
};
const drafts = await Promise.all([
  n("submit", operation),
  n("submit", operation),
]);
assert.deepEqual(drafts[0], drafts[1]);
assert.equal(drafts[0].status, 200);
assert.equal(drafts[0].data.items[0].amount, 25000);
assert.equal(drafts[0].data.items[0].category, "Кофейни");
assert.equal((await n("summary")).data.remaining, before.remaining);
assert.equal(
  (await n("submit", { ...operation, text: "кофе 350" })).status,
  409,
);
assert.equal(
  (await n("submit", { operationId: crypto.randomUUID(), text: " " })).status,
  400,
);
assert.equal((await c("inbox", undefined, b)).data.entries.length, 0);
assert.equal(
  (await c("review", { id: operation.operationId, status: "dismissed" }, b))
    .status,
  404,
);
assert.equal(
  (await n("status/" + operation.operationId)).data.status,
  "pending",
);
const review = {
  id: operation.operationId,
  status: "confirmed",
  items: drafts[0].data.items.map((r) => ({
    amount: r.amount,
    date: r.date,
    category: r.category,
    note: r.note,
  })),
};
const confirmed = await c("review", review);
assert.equal(confirmed.status, 200);
assert.deepEqual(await c("review", review), confirmed);
assert.equal(
  (await n("status/" + operation.operationId)).data.status,
  "confirmed",
);
state = await call("state", { cookie: a });
assert.equal(
  Object.values(state.data.state.months).flatMap((m) => m.expenses).length,
  2,
);
assert.equal((await n("summary")).data.todaySpent, 25000);
assert.equal(
  (await c("review", { ...review, status: "dismissed" })).status,
  409,
);
const unknown = await n("submit", {
  operationId: crypto.randomUUID(),
  text: "непонятная штука",
});
assert.equal(unknown.status, 200);
assert.ok(unknown.data.items[0].issues.length);
assert.equal(
  (
    await c("review", {
      id: unknown.data.id,
      status: "confirmed",
      items: unknown.data.items,
    })
  ).status,
  400,
);
assert.equal(
  (await c("review", { id: unknown.data.id, status: "dismissed", items: [] }))
    .status,
  200,
);
const race = await n("submit", {
  operationId: crypto.randomUUID(),
  text: "кофе 50",
});
const concurrent = await Promise.all([
  c("review", {
    id: race.data.id,
    status: "confirmed",
    items: race.data.items,
  }),
  c("review", { id: race.data.id, status: "dismissed", items: [] }),
]);
assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
// Default submission saves immediately, and receipt replay never creates another expense.
const direct = (body) => call("companion/submit", { body, token });
const directId = crypto.randomUUID();
const baseCount = Object.values(
  (await call("state", { cookie: a })).data.state.months,
).flatMap((m) => m.expenses).length;
const directResponses = await Promise.all([
  direct({ operationId: directId, text: "кофе 250" }),
  direct({ operationId: directId, text: "кофе 250" }),
]);
assert.ok(
  directResponses.every(
    (r) => r.status === 200 && r.data.status === "confirmed" && r.data.summary,
  ),
);
assert.equal(
  Object.values((await call("state", { cookie: a })).data.state.months).flatMap(
    (m) => m.expenses,
  ).length,
  baseCount + 1,
);
assert.equal(
  (await direct({ operationId: directId, text: "кофе 350" })).status,
  409,
);
const unknownCategory = await direct({
  operationId: crypto.randomUUID(),
  text: "абракадабра 150",
});
assert.equal(unknownCategory.status, 200);
assert.equal(unknownCategory.data.items[0].category, "Другое");
const beforeInvalid = (await call("state", { cookie: a })).data;
for (const text of [
  "кофе",
  "кофе 250 и 350",
  "перевод 500",
  "кофе 250; такси",
]) {
  assert.equal(
    (await direct({ operationId: crypto.randomUUID(), text })).status,
    400,
  );
}
assert.deepEqual((await call("state", { cookie: a })).data, beforeInvalid);
const retryLegacy = await direct(operation);
assert.equal(retryLegacy.status, 200);
assert.equal(retryLegacy.data.status, "confirmed");
assert.deepEqual((await call("state", { cookie: a })).data, beforeInvalid);
const remainingPending = await n("submit", {
  operationId: crypto.randomUUID(),
  text: "кофе 30",
});
assert.equal(
  (await direct({ operationId: remainingPending.data.id, text: "кофе 30" }))
    .data.status,
  "pending",
);
assert.deepEqual((await call("state", { cookie: a })).data, beforeInvalid);
const both = await Promise.all([
  direct({ operationId: crypto.randomUUID(), text: "кофе 10" }),
  direct({ operationId: crypto.randomUUID(), text: "кофе 20" }),
]);
assert.ok(both.every((r) => r.status === 200));
assert.equal((await c("revoke", { id: device.data.deviceId }, b)).status, 200);
assert.equal((await n("summary")).status, 200);
await c("revoke", { id: device.data.deviceId });
assert.equal((await n("summary")).status, 401);
const expired = await c("pair", {});
sqlite.exec("UPDATE companion_pairings SET expires=0");
assert.equal(
  (await call("companion/exchange", { body: { code: expired.data.code } }))
    .status,
  401,
);
assert.equal(summary({ months: {} }, "2026-11-30").remaining, null);
console.log(
  "Companion: pairing, auth scope, isolation, replay, CAS review, drafts, summary and revoke passed",
);
sqlite.close();
