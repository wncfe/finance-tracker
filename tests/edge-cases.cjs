const assert = require("node:assert/strict");
const P = require("../web/expense-parser.js");
const {
  sendPendingOperation,
  readPendingOperation,
} = require("../web/api-client.js");
const today = new Date(2026, 10, 7, 12);
let checks = 0;
function verify(name, fn) {
  try {
    fn();
    checks++;
  } catch (e) {
    console.error("Failed case:", name, first(name));
    throw e;
  }
}
const parse = (text) => P.parse(text, { today });
const first = (text) => parse(text)[0];
for (const [text, amount] of [
  ["кофе 0,01", 1],
  ["кофе 100000000", 1e10],
  ["кофе 1\u00a0250,50", 125050],
  ["кофе 1\u202f250,50", 125050],
  ["кофе 12.05 ₽", 1205],
  ["кофе 12.05 руб", 1205],
  ["кофе 12.05р", 1205],
  ["250 РУБ. кофе", 25000],
  ["кофе 250₽", 25000],
  ["T2 300", 30000],
  ["5ка 300", 30000],
  ["32links 300", 30000],
  ["кофе 10,99", 1099],
])
  verify(text, () => assert.equal(first(text).amount, amount));
for (const text of [
  "кофе - 250",
  "кофе −250",
  "кофе – 250",
  "кофе 0",
  "кофе 100000000,01",
  "кофе 1e3",
  "кофе 1.234,56",
  "кофе 250,999",
  "кофе 100 + 200",
  "Khochu Puri 4 500",
])
  verify(text, () =>
    assert(first(text).issues.length || first(text).amount === null),
  );
for (const text of [
  "кофе 10 долларов",
  "кофе 10 евро",
  "кофе 10 USD",
  "кофе €10",
  "возврат кофе 300",
  "перевёл 500",
  "кэшбэк 200",
  "зарплата 100000",
  "завтра кофе 250",
  "в прошлую пятницу кофе 250",
])
  verify(text, () => assert(first(text).issues.length, text));
for (const [text, date] of [
  ["29 февраля 2024 кофе 250", "2024-02-29"],
  ["2000-01-01 кофе 250", "2000-01-01"],
  ["2100-12-31 кофе 250", "2100-12-31"],
  ["05/11/2026 кофе 250", "2026-11-05"],
])
  verify(text, () => assert.equal(first(text).date, date));
for (const text of [
  "29 февраля 2026 кофе 250",
  "29 февраля 2100 кофе 250",
  "31 апреля кофе 250",
  "2026-00-10 кофе 250",
  "2026-13-01 кофе 250",
  "5 ноября 1999 кофе 250",
  "5 ноября 2101 кофе 250",
  "вчера 5 ноября кофе 250",
])
  verify(text, () => assert(first(text).issues.length, text));
for (const [day, expected] of [
  [new Date(2027, 0, 1), "2026-12-31"],
  [new Date(2024, 2, 1), "2024-02-29"],
  [new Date(2026, 2, 1), "2026-02-28"],
])
  verify("relative boundary " + expected, () =>
    assert.equal(P.parse("вчера кофе 250", { today: day })[0].date, expected),
  );
for (const text of ["", "  ", ";\n,;"])
  verify("empty " + text, () => assert.equal(parse(text).length, 0));
verify("unparsed fragment kept", () => {
  const rows = parse("кофе 250, без суммы");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].raw, "без суммы");
  assert.equal(rows[1].amount, null);
});
verify("decimal not separator", () =>
  assert.equal(parse("кофе 250,50, такси 430,20").length, 2),
);
verify("merchant conjunction", () =>
  assert.equal(parse("Красное и белое 500")[0].category, "Продукты"),
);
verify("conflicting words", () =>
  assert.equal(first("кофе и такси 500").category, ""),
);
verify("uppercase", () =>
  assert.equal(first("купил кофе за 250").note, "Кофе"),
);
verify("emoji uppercase", () =>
  assert.equal(first("☕ кофе 250").note, "☕ Кофе"),
);
verify("brand casing preserved", () =>
  assert.equal(first("iPhone 50000").note, "IPhone"),
);
verify("personal rule priority", () =>
  assert.equal(
    P.categoryFor("кофе", { кофе: "Дом" }, [
      { note: "Кофе", category: "Кофейни" },
    ]).category,
    "Дом",
  ),
);
verify("personal normalized", () =>
  assert.equal(
    P.categoryFor("ПЯТЁРОЧКА", { пятерочка: "Продукты" }).category,
    "Продукты",
  ),
);
verify("history conflict", () =>
  assert.equal(
    P.categoryFor("xx", {}, [
      { note: "xx", category: "Дом" },
      { note: "XX", category: "Дети" },
    ]).category,
    "",
  ),
);
verify("null rules", () =>
  assert.equal(P.categoryFor("кофе", null).category, "Кофейни"),
);
verify("prototype keys", () =>
  assert.equal(P.categoryFor("__proto__").category, ""),
);
verify("source preserved for HTML", () =>
  assert.equal(
    first("<img src=x onerror=alert(1)> кофе 250").raw,
    "<img src=x onerror=alert(1)> кофе 250",
  ),
);
verify("50 rows", () =>
  assert.equal(parse(Array(50).fill("кофе 250").join(";")).length, 50),
);
(async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    return { revision: 1 };
  };
  for (const saved of [
    "{",
    "null",
    "[]",
    "{}",
    JSON.stringify({
      revision: 0,
      operationId: "x".repeat(16),
      action: { type: "expenses", items: [null] },
    }),
  ]) {
    const storage = {
      getItem: () => saved,
      setItem: () => {},
      removeItem: () => {
        throw Error("must preserve corrupt receipt");
      },
    };
    assert.throws(() => readPendingOperation(storage, "key"));
    await assert.rejects(sendPendingOperation(request, 0, {}, storage, "key"));
    checks++;
  }
  assert.equal(calls, 0);
  for (const which of ["getItem", "setItem"]) {
    const storage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    storage[which] = () => {
      throw Error("storage blocked");
    };
    await assert.rejects(sendPendingOperation(request, 0, {}, storage, "key"));
    checks++;
  }
  assert.equal(calls, 0);
  let saved = null,
    committed = 0;
  const storage = {
    getItem: () => saved,
    setItem: (_, v) => {
      saved = v;
    },
    removeItem: () => {
      throw Error("storage blocked after commit");
    },
  };
  await assert.rejects(
    sendPendingOperation(
      async () => {
        committed++;
        return {};
      },
      0,
      { type: "expense" },
      storage,
      "key",
    ),
    (e) => e.uncertain,
  );
  assert.equal(committed, 1);
  assert(saved);
  checks++;
  console.log(`Edge checks passed: ${checks} cases`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
