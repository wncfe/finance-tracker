const assert = require("node:assert/strict");
const { range, summarize } = require("../web/analytics.js");
for (const [mode, date, from, to] of [
  ["day", "2026-11-07", "2026-11-07", "2026-11-07"],
  ["week", "2026-11-01", "2026-10-26", "2026-11-01"],
  ["week", "2027-01-01", "2026-12-28", "2027-01-03"],
  ["month", "2024-02-29", "2024-02-01", "2024-02-29"],
  ["month", "2026-02-01", "2026-02-01", "2026-02-28"],
  ["week", "2000-01-01", "2000-01-01", "2000-01-02"],
  ["month", "2100-12-31", "2100-12-01", "2100-12-31"],
])
  assert.deepEqual(range(mode, date), { from, to });
for (const date of ["2026-02-29", "bad", "1999-12-31", "2101-01-01"])
  assert.throws(() => range("day", date));
assert.throws(() => range("custom", null, "2026-11-08", "2026-11-07"));
assert.throws(() => range("custom", null, "", "2026-11-07"));
assert.deepEqual(range("custom", null, "2026-11-07", "2026-11-07"), {
  from: "2026-11-07",
  to: "2026-11-07",
});
const state = {
  months: {
    "2026-10": {
      expenses: [{ date: "2026-10-31", amount: 101, category: "Кафе" }],
    },
    "2026-11": {
      expenses: [
        { date: "2026-11-01", amount: 202, category: "Кафе" },
        { date: "2026-11-02", amount: 303, category: "Супермаркеты" },
      ],
    },
  },
};
assert.deepEqual(
  summarize(state, range("custom", null, "2026-10-31", "2026-11-01")),
  { total: 303, count: 2, categories: [{ category: "Кафе", amount: 303 }] },
);
assert.equal(summarize(state, range("month", "2026-11-07")).total, 505);
assert.equal(summarize(state, range("day", "2026-11-03")).total, 0);
assert.equal(summarize({ months: {} }, range("day", "2026-11-03")).count, 0);
console.log("Analytics checks passed: 18 boundary/aggregation cases");
