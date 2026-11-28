import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { apply, reconcileBudgets, spent } from "../cloudflare/budget.mjs";
const actions = [];
for (let year = 2024; year <= 2027; year++)
  for (let month = 1; month <= 12; month++)
    actions.push({
      type: "budget",
      month: `${year}-${String(month).padStart(2, "0")}`,
      amount: 1234567,
    });
actions.push(
  {
    type: "expenses",
    items: [
      { date: "2026-10-01", amount: 12345, category: "Кофейни", note: "Кофе" },
      { date: "2026-11-02", amount: 45000, category: "Супермаркеты" },
    ],
  },
  {
    type: "expense",
    month: "2026-11",
    week: 0,
    amount: 12345,
    date: "2026-11-01",
    category: "Кафе",
    note: "Обед",
  },
  { type: "limit", month: "2026-11", week: 2, amount: 300000 },
  { type: "close", month: "2026-11", week: 0, mode: "next" },
  { type: "close", month: "2026-11", week: 1, mode: "remaining" },
);
for (const week of [2, 3])
  actions.push({ type: "close", month: "2026-11", week, mode: "remaining" });
actions.push({
  type: "merchant_save",
  merchant: {
    id: "c-" + "3".repeat(32),
    name: "Тест",
    aliases: ["Вариант"],
    category: "Кафе",
    hidden: false,
  },
});
actions.push({
  type: "expenses",
  items: [
    {
      date: "2026-12-01",
      amount: 300,
      category: "Кафе",
      note: "Вариант",
      merchantId: "c-" + "3".repeat(32),
    },
    {
      date: "2026-12-02",
      amount: 400,
      category: "Супермаркеты",
      note: "Магнит",
      merchantId: "b-magnit",
    },
  ],
});
actions.push({
  type: "merchant_save",
  merchant: {
    id: "c-" + "3".repeat(32),
    name: "Тест",
    aliases: ["Вариант"],
    category: "Кафе",
    hidden: true,
  },
});
const python = spawnSync(
  "python",
  [
    "-X",
    "utf8",
    "-c",
    "import sys,json,budget; s={'months':{}}; states=[]\nfor a in json.load(sys.stdin):\n s=budget.apply(s,a,'2027-12-31'); states.append(s)\nprint(json.dumps(states))",
  ],
  { input: JSON.stringify(actions), encoding: "utf-8" },
);
assert.equal(python.status, 0, python.stderr);
const states = JSON.parse(python.stdout);
let state = { months: {} };
const normalize = (s) => {
  s = structuredClone(s);
  for (const m of Object.values(s.months))
    for (const e of m.expenses) e.id = "normalized";
  return s;
};
actions.forEach((a, i) => {
  state = apply(state, a, "2027-12-31");
  assert.deepEqual(normalize(state), normalize(states[i]), JSON.stringify(a));
  Object.values(state.months).forEach((m) =>
    assert.equal(
      m.weeks.reduce((sum, w) => sum + (w.settled ?? w.limit), 0),
      m.budget,
    ),
  );
});
for (const mode of ["next", "remaining", "month"]) {
  const initial = apply(
    { months: {} },
    { type: "budget", month: "2026-11", amount: 300000 },
  );
  const snapshot = structuredClone(initial);
  assert.throws(
    () => apply(initial, { type: "close", month: "2026-11", week: 1, mode }),
    /предыдущие/,
  );
  assert.deepEqual(initial, snapshot);
}
console.log(
  `Python/Worker parity passed: ${actions.length} operations, including leap year, closure, limits, transfer and validation`,
);

// Historical period boundaries with a missing or stale settlement.
const month = "2026-11";
const legacy = {
  months: {
    [month]: {
      budget: 6000000,
      weeks: [
        { start: 1, end: 8, days: 8, limit: 1500000, closed: true },
        {
          start: 9,
          end: 15,
          days: 7,
          limit: 1600000,
          closed: true,
          settled: 1600000,
        },
        {
          start: 16,
          end: 22,
          days: 7,
          limit: 1825000,
          closed: true,
          settled: 1825000,
        },
        { start: 23, end: 29, days: 7, limit: 850000, closed: false },
        { start: 30, end: 30, days: 1, limit: 225000, closed: false },
      ],
      expenses: [1575000, 1600000, 1825000, 300000].map((amount, week) => ({
        id: String(week),
        date: month + "-" + ["01", "09", "16", "28"][week],
        amount,
        week,
        category: "Кафе",
        note: "",
      })),
    },
  },
};

function assertRemaining(m, expected) {
  const balances = m.weeks.flatMap((w, i) =>
    w.closed ? [] : [w.limit - spent(m, i)],
  );
  assert.deepEqual(balances, expected);
  assert.equal(
    balances.reduce((sum, balance) => sum + balance, 0),
    m.budget - spent(m),
  );
}

const repaired = reconcileBudgets(structuredClone(legacy));
const m = repaired.months[month];
assertRemaining(m, [550000, 150000]);
assert.equal(m.budget - spent(m), 700000);
assert.equal(m.weeks[0].settled, 1575000);
assert.equal(m.weeks[0].limit, 1500000);
assert.deepEqual(m.expenses, legacy.months[month].expenses);
assert.deepEqual(reconcileBudgets(structuredClone(repaired)), repaired);

const stale = structuredClone(legacy);
stale.months[month].weeks[0].settled = 1500000;
assert.deepEqual(reconcileBudgets(structuredClone(stale)), repaired);
const underallocated = structuredClone(repaired);
underallocated.months[month].weeks[4].limit -= 1;
assert.deepEqual(reconcileBudgets(underallocated), repaired);

const insufficient = structuredClone(stale);
insufficient.months[month].budget = 4900000;
const deficit = reconcileBudgets(insufficient).months[month];
assert.deepEqual(
  deficit.weeks.slice(3).map((w) => w.limit),
  [0, 0],
);
assert.equal(deficit.budget - spent(deficit), -400000);

const edits = [
  { type: "budget", month, amount: 6000000 },
  { type: "limit", month, week: 3, amount: 850000 },
  ...["next", "remaining", "month"].map((mode) => ({
    type: "close",
    month,
    week: 3,
    mode,
  })),
];
const results = edits.map((action) => apply(stale, action, "2026-11-28"));
assertRemaining(results[0].months[month], [575000, 125000]);
assertRemaining(results[1].months[month], [550000, 150000]);
for (const result of results.slice(2)) {
  assertRemaining(result.months[month], [700000]);
}
assert.equal(stale.months[month].weeks[0].settled, 1500000);
const legacyPython = spawnSync(
  "python",
  [
    "-X",
    "utf8",
    "-c",
    "import copy,json,sys,budget; s,actions=json.load(sys.stdin); print(json.dumps([budget.reconcile_budgets(copy.deepcopy(s)),*[budget.apply(s,a,'2026-11-28') for a in actions]]))",
  ],
  { input: JSON.stringify([stale, edits]), encoding: "utf-8" },
);
assert.equal(legacyPython.status, 0, legacyPython.stderr);
assert.deepEqual(JSON.parse(legacyPython.stdout), [repaired, ...results]);
console.log("Historical November budget reconciliation passed");
