import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { apply } from "../cloudflare/budget.mjs";
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
