const assert = require("node:assert/strict");
const A = require("../web/analytics-core.js");
require("../web/expense-parser.js");
const state = { months: {} };
function add(date, amount, category = "Кофейни", note = "Кофе") {
  const month = date.slice(0, 7);
  state.months[month] ||= { expenses: [] };
  state.months[month].expenses.push({
    id: String(A.index(state).expenses.length),
    date,
    amount,
    category,
    note,
  });
}
assert.equal(A.todayAt(new Date("2026-11-12T18:59:59Z")), "2026-11-12");
assert.equal(A.todayAt(new Date("2026-11-12T19:00:00Z")), "2026-11-13");
add("2026-02-01", 100);
add("2026-02-28", 200);
add("2026-03-01", 400);
add("2026-03-28", 600);
add("2026-03-31", 800);
const c = A.compare(
  state,
  A.range("month", "2026-03-31"),
  "month",
  "2026-03-31",
);
assert.deepEqual(c.current, { from: "2026-03-01", to: "2026-03-28" });
assert.deepEqual(c.previous, { from: "2026-02-01", to: "2026-02-28" });
assert.equal(c.summary.total, 1000);
assert.equal(c.prior.total, 300);
assert.equal(
  A.report(A.index(state), "2026-03", "2026-03-31").actual.total,
  1800,
);
assert.equal(
  A.report(A.index(state), "2026-03", "2026-03-31").actualAverage,
  58,
);
const complete = A.compare(
  state,
  A.range("month", "2026-03-01"),
  "month",
  "2026-04-01",
);
assert.equal(complete.summary.total, 1800);
assert.equal(A.length(complete.current), 31);
assert.equal(complete.days.filter((d) => d.amount === 0).length, 28);
assert.equal(
  A.daily(state, { from: "2026-03-31", to: "2026-04-01" }, "2026-03-31")[1]
    .amount,
  null,
);
assert.equal(
  A.compare(state, A.range("day", "2026-03-01"), "day", "2026-03-31").percent,
  100,
);
const custom = A.compare(
  state,
  { from: "2026-03-01", to: "2026-03-02" },
  "custom",
  "2026-03-31",
);
assert.deepEqual(custom.previous, { from: "2026-02-27", to: "2026-02-28" });
const ongoing = A.compare(
  state,
  { from: "2026-03-01", to: "2026-03-31" },
  "custom",
  "2026-03-13",
);
assert.equal(A.length(ongoing.current), 13);
assert.equal(A.length(ongoing.previous), 13);
const empty = A.compare(
  { months: {} },
  A.range("month", "2024-02-29"),
  "month",
  "2024-03-01",
);
assert.equal(empty.percent, null);
assert.equal(empty.average, 0);
const history = {
  months: {
    "2026-09": { expenses: [] },
    "2026-10": { expenses: [] },
    "2026-11": { expenses: [] },
  },
};
for (let d = "2026-09-01"; d <= "2026-11-12"; d = A.shift(d, 1))
  history.months[d.slice(0, 7)].expenses.push({
    id: d,
    date: d,
    amount: 10000,
    category: "Кофейни",
    note: d.endsWith("01") ? "КОФЕ" : "кофе",
  });
history.months["2026-11"].weeks = [
  { start: 9, end: 15, days: 7, closed: false, limit: 80000 },
];
const f = A.forecast(history, "2026-11", 0, "2026-11-13");
assert.equal(f.total, 70000);
assert.equal(f.left, 10000);
assert.equal(f.status, "forecast");
history.months["2026-11"].expenses.push({
  id: "large",
  date: "2026-11-13",
  amount: 90000,
  category: "Кофейни",
  note: "КОФЕ",
});
const higher = A.forecast(history, "2026-11", 0, "2026-11-13");
assert.ok(higher.total >= 130000);
assert.ok(higher.left < 0);
history.months["2026-11"].weeks[0].closed = true;
assert.equal(A.forecast(history, "2026-11", 0, "2026-11-13").status, "actual");
history.months["2026-11"].weeks[0].closed = false;
const short = {
  months: {
    "2026-11": {
      weeks: [{ start: 9, end: 15, limit: 10000 }],
      expenses: [{ date: "2026-11-09", amount: 200, id: "a" }],
    },
  },
};
assert.equal(
  A.forecast(short, "2026-11", 0, "2026-11-09").status,
  "insufficient",
);
assert.equal(A.forecast(short, "2026-11", 0, "2026-11-11").total, 700);
assert.equal(A.forecast(short, "2026-11", 0, "2026-11-08"), null);
const groups = A.habits(
  A.index(history),
  { from: "2026-09-01", to: "2026-10-31" },
  "2026-11-13",
);
assert.equal(groups.length, 1);
assert.equal(groups[0].count, 61);
assert.ok(groups[0].monthly > 0);
assert.equal(
  A.habits(
    A.index(history),
    { from: "2026-11-01", to: "2026-11-03" },
    "2026-11-13",
  )[0].monthly,
  null,
);
const sim = A.simulate(
  history,
  "2026-10",
  [
    { kind: "category", key: "Кофейни", mode: "percent", value: 50 },
    { kind: "habit", key: groups[0].key, mode: "percent", value: 75 },
  ],
  "2026-11-13",
);
assert.equal(sim.monthly, 232500);
assert.equal(sim.yearly, 2790000);
assert.equal(
  A.simulate(
    history,
    "2026-10",
    [{ kind: "category", key: "Кофейни", mode: "amount", value: 99999999 }],
    "2026-11-13",
  ).monthly,
  310000,
);
assert.throws(() => A.simulate(history, "2026-11", [], "2026-11-13"));
assert.equal(A.deviation(1000000, Array(7).fill(10000), "day"), null);
assert.equal(A.deviation(1000000, Array(8).fill(10000), "day").kind, "anomaly");
assert.equal(A.deviation(1000000, Array(8).fill(0), "day").kind, "new");
assert.equal(A.deviation(11000, Array(8).fill(10000), "day"), null);
const before = JSON.stringify(history);
const findings = A.anomalies(
  A.index(history),
  { from: "2026-11-13", to: "2026-11-13" },
  "2026-11-13",
);
assert.ok(findings.some((x) => x.expenses.some((e) => e.id === "large")));
A.report(A.index(history), "2026-10", "2026-11-13");
assert.equal(
  JSON.stringify(history),
  before,
  "analytics must not mutate facts",
);
console.log(
  "Analytics core: periods, zeros, midnight, forecast, habits, anomalies, overlap and reports passed",
);
