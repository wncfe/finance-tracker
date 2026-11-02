import assert from "node:assert/strict";
const base = process.env.TEST_WORKER_URL || "http://127.0.0.1:8787";
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname),
  "Worker test only runs against localhost",
);
const cookie = {};
async function api(client, path, data, origin) {
  if (path === "action")
    data = { ...data, operationId: data.operationId || crypto.randomUUID() };
  const r = await fetch(base + "/api/" + path, {
    method: data ? "POST" : "GET",
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(cookie[client] ? { Cookie: cookie[client] } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (r.headers.get("set-cookie"))
    cookie[client] = r.headers.get("set-cookie").split(";")[0];
  return [r.status, await r.json()];
}
const suffix = Date.now();
assert.equal((await api("a", "state"))[0], 401);
assert.equal(
  (
    await api("a", "register", {
      login: "denied" + suffix,
      password: "test-password-123",
    })
  )[0],
  403,
);
for (const client of ["a", "b"])
  assert.equal(
    (
      await api(client, "register", {
        login: client + suffix,
        password: "test-password-123",
        invite: "local-test-invitation",
      })
    )[0],
    200,
  );
let [status, result] = await api("a", "action", {
  revision: 0,
  action: { type: "budget", month: "2026-11", amount: 300000 },
});
assert.equal(status, 200);
const revision = result.revision;
assert.deepEqual((await api("b", "state"))[1].state, { months: {} });
assert.equal(
  (
    await api("a", "action", {
      revision: 0,
      action: { type: "budget", month: "2026-11", amount: 5 },
    })
  )[0],
  409,
);
assert.equal((await api("a", "logout", {}, "https://evil.example"))[0], 403);
const responses = await Promise.all(
  [1, 2].map((n) =>
    api("a", "action", {
      revision,
      action: {
        type: "expense",
        month: "2026-11",
        week: 0,
        amount: n * 100,
        date: "2026-11-01",
        category: "Кафе",
        note: "test",
      },
    }),
  ),
);
assert.deepEqual(responses.map((r) => r[0]).sort(), [200, 409]);
assert.equal(
  (await api("a", "state"))[1].state.months["2026-11"].expenses.length,
  1,
);
const beforeRetry = (await api("a", "state"))[1];
const retry = {
  revision: beforeRetry.revision,
  operationId: crypto.randomUUID(),
  action: {
    type: "expense",
    month: "2026-11",
    week: 0,
    amount: 300,
    date: "2026-11-01",
    category: "Кафе",
  },
};
const saved = await api("a", "action", retry);
assert.deepEqual(await api("a", "action", retry), saved);
assert.equal(
  (await api("a", "import", { revision: saved[1].revision, backup: {} }))[0],
  404,
);
assert.equal((await api("a", "logout", {}))[0], 200);
assert.equal((await api("a", "state"))[0], 401);
console.log(
  "Worker/D1 passed: invitation, scrypt, sessions, isolation, CAS race, origin, persistence, logout",
);
