import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { weeks, apply } from "../cloudflare/budget.mjs";
const require = createRequire(import.meta.url);
const A = require("../web/analytics-core.js");
const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const calendar = vm.runInNewContext(
  "(" +
    source.slice(
      source.indexOf("function calendar("),
      source.indexOf("function current("),
    ) +
    ")",
);
const cases = {
  "2026-11": [
    [1, 8],
    [9, 15],
    [16, 22],
    [23, 30],
  ],
  "2026-08": [
    [1, 9],
    [10, 16],
    [17, 23],
    [24, 31],
  ],
  "2026-05": [
    [1, 3],
    [4, 10],
    [11, 17],
    [18, 24],
    [25, 31],
  ],
  "2026-01": [
    [1, 4],
    [5, 11],
    [12, 18],
    [19, 25],
    [26, 31],
  ],
  "2026-04": [
    [1, 5],
    [6, 12],
    [13, 19],
    [20, 26],
    [27, 30],
  ],
  "2027-02": [
    [1, 7],
    [8, 14],
    [15, 21],
    [22, 28],
  ],
  "2028-02": [
    [1, 6],
    [7, 13],
    [14, 20],
    [21, 29],
  ],
};
for (const [key, expected] of Object.entries(cases)) {
  assert.deepEqual(
    weeks(key).map((w) => [w.start, w.end]),
    expected,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(calendar(key))).map((w) => [w.start, w.end]),
    expected,
  );
  const s = apply(
    { months: {} },
    { type: "budget", month: key, amount: 3000000 },
  );
  assert.equal(
    s.months[key].weeks.reduce((n, w) => n + w.limit, 0),
    3000000,
  );
}
let state = apply(
  { months: {} },
  { type: "budget", month: "2026-11", amount: 3000000 },
);
state = apply(
  state,
  {
    type: "expenses",
    items: [1, 29, 30].map((d, i) => ({
      date: `2026-11-${String(d).padStart(2, "0")}`,
      amount: (i + 1) * 100,
      category: "Кафе",
    })),
  },
  "2026-12-31",
);
for (const [date, total, from, to] of [
  ["2026-11-01", 100, "2026-10-26", "2026-11-01"],
  ["2026-11-29", 200, "2026-11-23", "2026-11-29"],
  ["2026-11-30", 300, "2026-11-30", "2026-12-06"],
]) {
  assert.equal(A.summarize(state, A.range("day", date)).total, total);
  assert.deepEqual(A.range("week", date), { from, to });
  assert.equal(A.summarize(state, { from, to }).total, total);
}
assert.equal(A.summarize(state, A.range("month", "2026-11-01")).total, 600);
const before = structuredClone(state);
// Budget metadata and indices must never affect date-based analytics.
before.months["2026-11"].weeks = [];
before.months["2026-11"].expenses.forEach((e) => (e.week = 99));
for (const date of ["2026-11-01", "2026-11-29", "2026-11-30"]) {
  for (const mode of ["day", "week", "month"]) {
    const p = A.range(mode, date);
    assert.deepEqual(A.summarize(before, p), A.summarize(state, p));
    assert.deepEqual(
      A.daily(before, p, "2026-12-31"),
      A.daily(state, p, "2026-12-31"),
    );
  }
}
// Legacy batches use persisted week boundaries, including settled history.
const legacy = {
  months: {
    "2026-11": {
      budget: 150000,
      weeks: [
        { start: 1, end: 1, days: 1, limit: 10000, closed: true, settled: 100 },
        { start: 2, end: 8, days: 7, limit: 79900, closed: false },
        { start: 9, end: 15, days: 7, limit: 70000, closed: false },
      ],
      expenses: [
        { week: 0, amount: 100, date: "2026-11-01", category: "Кафе" },
      ],
    },
  },
};
const updated = apply(
  legacy,
  {
    type: "expenses",
    items: [{ date: "2026-11-09", amount: 200, category: "Кафе" }],
  },
  "2026-12-31",
);
assert.equal(updated.months["2026-11"].expenses.at(-1).week, 2);
assert.deepEqual(
  updated.months["2026-11"].weeks,
  legacy.months["2026-11"].weeks,
);
console.log(
  "Budget calendars, UI parity, legacy carry preservation and calendar analytics passed",
);
