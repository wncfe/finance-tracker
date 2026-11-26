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
assert.equal(f.observations, 6);
assert.equal(f.adaptability, 4 / 7);

const changingPace = structuredClone(history);
for (const month of Object.values(changingPace.months)) {
  for (const expense of month.expenses) {
    if (expense.date < "2026-09-28" || expense.date === "2026-10-30")
      expense.amount = 100000;
    if (expense.date >= "2026-11-09") expense.amount = 20000;
  }
}
assert.equal(A.forecast(changingPace, "2026-11", 0, "2026-11-09").total, 80000);
const adapted = A.forecast(changingPace, "2026-11", 0, "2026-11-13");
assert.equal(adapted.total, 127143);
assert.equal(adapted.left, -47143);

const shiftingSpend = structuredClone(history);
for (const month of Object.values(shiftingSpend.months)) {
  month.expenses = month.expenses.filter(
    (expense) => expense.date < "2026-11-09",
  );
  for (const expense of month.expenses)
    if (expense.date >= "2026-09-28") expense.amount = 0;
}
for (let i = 0; i < 6; i++) {
  const date = A.shift("2026-09-28", i * 8);
  shiftingSpend.months[date.slice(0, 7)].expenses.find(
    (expense) => expense.date === date,
  ).amount = 70000;
}
assert.equal(
  A.forecast(shiftingSpend, "2026-11", 0, "2026-11-09").total,
  70000,
);
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

require("../web/merchants.js");
const linked = {
  months: {
    "2026-11": {
      expenses: [
        {
          id: "one",
          date: "2026-11-01",
          category: "Кафе",
          note: "Вариант 1",
          merchantId: "b-magnit",
          amount: 100,
        },
        {
          id: "two",
          date: "2026-11-02",
          category: "Дом",
          note: "Вариант 2",
          merchantId: "b-magnit",
          amount: 200,
        },
        {
          id: "three",
          date: "2026-11-03",
          category: "Дом",
          note: "Вариант 3",
          merchantId: "b-magnit",
          amount: 300,
        },
      ],
    },
  },
};
const linkedHabits = A.habits(
  A.index(linked),
  { from: "2026-11-01", to: "2026-11-13" },
  "2026-11-13",
);
assert.equal(linkedHabits.length, 1);
assert.equal(linkedHabits[0].label, "Магнит");
assert.equal(linkedHabits[0].total, 600);
assert.equal(linkedHabits[0].category, "Разные категории");

const taxiMerchant = { id: "taxi", name: "Такси" };
const taxi = {
  merchants: [taxiMerchant],
  months: {
    "2026-10": {
      expenses: [
        { date: "2026-10-31", category: "Такси", note: "Такси", amount: 40000 },
      ],
    },
    "2026-11": {
      expenses: [38100, 38100, 38100, 38100, 38800, 38800, 38800, 38900].map(
        (amount, i) => ({
          date: `2026-11-0${i + 1}`,
          category: "Такси",
          note: i < 4 ? "ТАКСИ" : "Поездка",
          amount,
          ...(i < 4 ? {} : { merchantId: taxiMerchant.id }),
        }),
      ),
    },
  },
};
const taxiPeriod = { from: "2026-11-01", to: "2026-11-26" };
const taxiRows = taxi.months["2026-11"].expenses;
const taxiBefore = structuredClone(taxi);
const [taxiHabit, ...extraTaxiHabits] = A.habits(
  taxi,
  taxiPeriod,
  taxiPeriod.to,
);
assert.deepEqual(extraTaxiHabits, []);
assert.equal(taxiHabit.label, "Такси");
assert.equal(taxiHabit.count, 8);
assert.equal(taxiHabit.total, 307700);
assert.equal(taxiHabit.previousCount, 1);
assert.equal(taxiHabit.previousTotal, 40000);
assert.equal(taxiHabit.expenses.filter((e) => !e.merchantId).length, 4);
assert.deepEqual(taxi, taxiBefore);

const otherMerchant = { id: "other-taxi", name: "Такси" };
taxi.merchants.push(otherMerchant);
taxiRows.push({
  date: "2026-11-09",
  category: "Дом",
  note: "Такси",
  amount: 100,
  merchantId: otherMerchant.id,
});
assert.equal(A.habits(taxi, taxiPeriod, taxiPeriod.to)[0].count, 8);
taxiRows.at(-1).category = "Такси";
assert.deepEqual(
  A.habits(taxi, taxiPeriod, taxiPeriod.to).map((habit) => habit.count),
  [4, 4],
);

// Coverage explains empty findings without changing the existing anomaly output.
const coverage = {};
assert.deepEqual(
  A.anomalies(
    A.index(history),
    { from: "2026-11-13", to: "2026-11-13" },
    "2026-11-13",
    "",
    coverage,
  ),
  findings,
);
assert.deepEqual(coverage, { checked: 1, total: 1 });
const earlyCoverage = {};
A.anomalies(
  { expenses: [], first: null },
  { from: "2026-11-01", to: "2026-11-13" },
  "2026-11-13",
  "",
  earlyCoverage,
);
assert.deepEqual(earlyCoverage, { checked: 0, total: 0 });

const partialCoverage = {};
A.anomalies(
  A.index(history),
  { from: "2026-08-01", to: "2026-11-13" },
  "2026-11-13",
  "",
  partialCoverage,
);
assert.ok(
  partialCoverage.checked > 0 &&
    partialCoverage.checked < partialCoverage.total,
  "mixed history must expose partial coverage",
);

// Monthly historical pace: fixed cohort, closed-ledger eligibility and integer reconciliation.
const paceState = { months: {} };
function paceMonth(month, day, amount, closed = true, category = "Кафе") {
  const end = Number(A.range("month", month + "-01").to.slice(8));
  paceState.months[month] ||= {
    weeks: [{ start: 1, end, closed }],
    expenses: [],
  };
  paceState.months[month].expenses.push({
    id: month + day + category,
    date: month + "-" + String(day).padStart(2, "0"),
    amount,
    category,
    note: "Расход",
  });
}
for (const month of ["2026-08", "2026-09", "2026-10"]) {
  paceMonth(month, 1, 100);
  paceMonth(month, 13, 200);
}
paceMonth("2026-11", 1, 50, false);
paceMonth("2026-11", 13, 150, false);
const paceBefore = JSON.stringify(paceState);
let pace = A.spendingPace(paceState, "2026-11", "2026-11-13", "2026-11-13");
assert.equal(pace.count, 3);
assert.equal(pace.status, "established");
assert.equal(pace.expectedTotal, 300);
assert.equal(pace.actualTotal, 200);
assert.equal(pace.delta, -100);
assert.deepEqual(pace.actual[0].amount, 0);
assert.deepEqual(pace.expected[0].amount, 0);
assert.equal(
  pace.categories.reduce((s, c) => s + c.delta, 0),
  pace.delta,
);
assert.equal(pace.commonDays, 30);
assert.equal(pace.expected.at(-1).day, 30);
paceState.months["2026-09"].weeks[0].closed = false;
pace = A.spendingPace(paceState, "2026-11", "2026-11-13", "2026-11-13");
assert.equal(pace.count, 2);
assert.equal(pace.status, "preliminary");
paceState.months["2026-08"].expenses[0].date = "2026-08-02";
pace = A.spendingPace(paceState, "2026-11", "2026-11-13", "2026-11-13");
assert.equal(pace.count, 1);
assert.ok(pace.history.excluded.some((m) => m.month === "2026-08"));
paceState.months["2026-10"].weeks[0].closed = false;
pace = A.spendingPace(paceState, "2026-11", "2026-11-13", "2026-11-13");
assert.equal(pace.count, 0);
assert.equal(pace.delta, null);
assert.equal(pace.expected.length, 0);
assert.throws(() =>
  A.spendingPace(paceState, "2026-11", "2026-11-14", "2026-11-13"),
);
const shortMonths = {
  months: {
    "2024-01": {
      weeks: [{ start: 1, end: 31, closed: true }],
      expenses: [{ id: "jan", date: "2024-01-01", amount: 300, category: "A" }],
    },
    "2024-02": {
      weeks: [{ start: 1, end: 29, closed: true }],
      expenses: [{ id: "feb", date: "2024-02-29", amount: 900, category: "A" }],
    },
    "2024-03": {
      weeks: [],
      expenses: [{ id: "mar", date: "2024-03-31", amount: 200, category: "A" }],
    },
  },
};
pace = A.spendingPace(shortMonths, "2024-03", "2024-03-31", "2024-04-01");
assert.equal(pace.count, 1);
assert.equal(pace.expectedTotal, 300);
assert.equal(pace.commonDays, 31);
assert.ok(pace.history.excluded.some((m) => m.reason.includes("31")));
pace = A.spendingPace(shortMonths, "2024-03", "2024-03-13", "2024-04-01");
assert.equal(pace.count, 2);
assert.equal(pace.expected.at(-1).day, 29);
const rounding = JSON.parse(paceBefore);
rounding.months["2026-08"].expenses.push(
  { date: "2026-08-01", amount: 1, category: "A" },
  { date: "2026-08-01", amount: 1, category: "B" },
);
pace = A.spendingPace(rounding, "2026-11", "2026-11-13", "2026-11-13");
assert.equal(
  pace.categories.reduce((s, c) => s + c.expected, 0),
  pace.expectedTotal,
);
assert.equal(
  pace.categories.reduce((s, c) => s + c.delta, 0),
  pace.delta,
);
const unchanged = JSON.stringify(rounding);
A.spendingPace(rounding, "2026-11", "2026-11-13", "2026-11-13", 6, "Кафе");
assert.equal(JSON.stringify(rounding), unchanged);
const dailyHistory = A.historicalDaily(
  rounding,
  { from: "2026-11-13", to: "2026-11-13" },
  "2026-11-13",
);
assert.deepEqual(dailyHistory, [{ date: "2026-11-13", amount: 200, count: 3 }]);
assert.equal(
  A.spendingPace(
    rounding,
    "2026-11",
    "2026-11-13",
    "2026-11-13",
    3,
    "Нет категории",
  ).actualTotal,
  0,
);
assert.doesNotThrow(() =>
  A.spendingPace({ months: {} }, "2000-01", "2000-01-01", "2000-01-01"),
);
console.log(
  "Historical pace: cohort eligibility, leap day, no fabricated days, category reconciliation and immutability passed",
);
