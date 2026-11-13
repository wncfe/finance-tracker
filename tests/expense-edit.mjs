import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { apply, weeks } from "../cloudflare/budget.mjs";
const today = "2026-12-31";
let initial = { months: {} };
for (const month of ["2026-10", "2026-11"])
  initial = apply(initial, { type: "budget", month, amount: 300000 }, today);
initial = apply(
  initial,
  {
    type: "expenses",
    items: [
      {
        date: "2026-11-08",
        amount: 10000,
        category: "Кофейни",
        note: "Исходный текст",
      },
    ],
  },
  today,
);
initial.months["2026-11"].expenses[0].id = "editing-expense";
const octWeek = weeks("2026-10").findIndex((w) => w.start <= 31 && w.end >= 31);
const edit = (month, week, fields) => ({
  type: "expense_update",
  month,
  week,
  id: "editing-expense",
  ...fields,
});
const actions = [
  edit("2026-11", initial.months["2026-11"].expenses[0].week, {
    amount: 25000,
    date: "2026-11-09",
    category: "Супермаркеты",
    merchantId: "b-magnit",
  }),
  edit(
    "2026-11",
    weeks("2026-11").findIndex((w) => w.start <= 9 && w.end >= 9),
    { date: "2026-10-31" },
  ),
  edit("2026-10", octWeek, { date: "2026-12-01" }),
  edit("2026-12", 0, { merchantId: "" }),
  edit("2026-12", 0, { date: "2026-12-99" }),
  edit("2026-12", 0, { amount: 0 }),
  edit("2026-12", 0, { amount: 1.1 }),
  edit("2026-12", 0, { date: "2027-01-01" }),
  edit("2026-12", 0, { category: "unknown" }),
  edit("2026-12", 0, { merchantId: "missing" }),
  edit("2026-12", false, { amount: 2 }),
  edit("2026-12", 0, { id: "missing" }),
  edit("2026-12", 0, { note: "not allowed" }),
  { type: "budget", month: "2026-12", amount: 100000 },
  { type: "close", month: "2026-12", week: 0, mode: "remaining" },
  edit("2026-12", 0, { category: "Рестораны", merchantId: "b-magnit" }),
  edit("2026-12", 0, { amount: 30000 }),
  edit("2026-12", 0, { date: "2026-11-10" }),
  {
    type: "expenses",
    items: [{ date: "2026-12-09", amount: 100, category: "Кофейни" }],
  },
];
// The second expense receives a random ID, so normalize only that ID in comparisons.
const normalize = (s) => {
  s = structuredClone(s);
  for (const m of Object.values(s.months))
    for (const e of m.expenses) if (e.id !== "editing-expense") e.id = "other";
  return s;
};
const results = [];
let state = initial;
for (const action of actions) {
  const before = structuredClone(state);
  try {
    state = apply(state, action, today);
    results.push({ ok: true, state: normalize(state) });
  } catch {
    assert.deepEqual(state, before);
    results.push({ ok: false, state: normalize(state) });
  }
}
assert.equal(results.filter((r) => !r.ok).length, 11);
const python = spawnSync(
  "python",
  [
    "-X",
    "utf8",
    "-c",
    `import sys,json,budget,copy
payload=json.load(sys.stdin); state=payload['state'];results=[]
for action in payload['actions']:
 try:
  state=budget.apply(state,action,'2026-12-31'); ok=True
 except (ValueError,KeyError,TypeError): ok=False
 current=copy.deepcopy(state)
 for month in current['months'].values():
  for e in month['expenses']:
   if e['id']!='editing-expense':e['id']='other'
 results.append(dict(ok=ok,state=current))
print(json.dumps(results))`,
  ],
  { input: JSON.stringify({ state: initial, actions }), encoding: "utf8" },
);
assert.equal(python.status, 0, python.stderr);
assert.deepEqual(results, JSON.parse(python.stdout));
assert.equal(
  state.months["2026-12"].expenses.find((e) => e.id === "editing-expense").note,
  "Исходный текст",
);
console.log(
  "Expense edit: amount/date/merchant/category, moves, immutable rejection and Python/Worker parity passed",
);

// Existing months retain old calendar-week indices even after the new-period release.
const legacy = structuredClone(initial);
legacy.months["2026-11"].weeks = [
  [1, 1],
  [2, 8],
  [9, 15],
  [16, 22],
  [23, 29],
  [30, 30],
].map(([start, end], i) => ({
  start,
  end,
  days: end - start + 1,
  limit: i === 5 ? 300000 : 0,
  closed: false,
}));
legacy.months["2026-11"].expenses[0].week = 1;
const legacyMoved = apply(
  legacy,
  edit("2026-11", 1, { date: "2026-11-09" }),
  today,
);
assert.equal(legacyMoved.months["2026-11"].expenses[0].week, 2);
