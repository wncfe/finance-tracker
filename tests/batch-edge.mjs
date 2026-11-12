const apply = (state, action) => domainApply(state, action, "2027-12-31");
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { apply as domainApply, categories } from "../cloudflare/budget.mjs";
const base = {
  date: "2026-11-02",
  amount: 1,
  category: "Кофейни",
  note: "Кофе",
};
const state = { months: {} };
const closed = apply(
  apply(state, { type: "budget", month: "2026-11", amount: 10000 }),
  { type: "close", month: "2026-11", week: 0, mode: "next" },
);
const cases = [];
const add = (name, items, ok = true, s = state) =>
  cases.push({ name, action: { type: "expenses", items }, ok, state: s });
add("minimum", [base]);
add("max amount", [{ ...base, amount: 1e10 }]);
add("cross year", [
  { ...base, date: "2026-12-31" },
  { ...base, date: "2027-01-01" },
]);
add("leap day", [{ ...base, date: "2024-02-29" }]);
add("50 items", Array(50).fill(base));
add(
  "all categories",
  categories.map((category) => ({ ...base, category })),
);
add("HTML description", [{ ...base, note: "<script>alert(1)</script>" }]);
add("200 UTF16 units", [{ ...base, note: "☕".repeat(200) }]);
for (const [name, change] of Object.entries({
  zero: { amount: 0 },
  negative: { amount: -1 },
  fraction: { amount: 1.5 },
  string: { amount: "100" },
  bool: { amount: true },
  overflow: { amount: 1e10 + 1 },
  missing: { amount: null },
  badCategory: { category: "Unknown" },
  tooLong: { note: "a".repeat(201) },
  emojiTooLong: { note: "😀".repeat(101) },
  nonLeap: { date: "2026-02-29" },
  badMonth: { date: "2026-13-02" },
  badDay: { date: "2026-11-31" },
  lowerYear: { date: "1999-12-31" },
  upperYear: { date: "2101-01-01" },
  compactDate: { date: "20261102" },
  weekDate: { date: "2026-W45-1" },
  invalidDate: { date: "bad" },
  dateType: { date: 42 },
}))
  add(name, [base, { ...base, ...change }], false);
for (const items of [
  [],
  null,
  {},
  "bad",
  Array(51).fill(base),
  [null],
  [4],
  [[]],
])
  add("invalid container " + JSON.stringify(items).slice(0, 20), items, false);
add(
  "closed week",
  [
    { ...base, date: "2026-12-01" },
    { ...base, date: "2026-11-01" },
  ],
  false,
  closed,
);
const normalize = (s) => {
  s = structuredClone(s);
  for (const m of Object.values(s.months))
    for (const e of m.expenses) e.id = "id";
  return s;
};
const python = spawnSync(
  "python",
  [
    "-X",
    "utf8",
    "-c",
    `import json,sys,copy,budget
results=[]
for c in json.load(sys.stdin):
 s=c['state']; before=copy.deepcopy(s)
 try: result={'ok':True,'state':budget.apply(s,c['action'],'2027-12-31')}
 except Exception: result={'ok':False}
 assert s==before
 results.append(result)
print(json.dumps({'results':results,'categories':budget.CATEGORIES}))`,
  ],
  { input: JSON.stringify(cases), encoding: "utf8" },
);
assert.equal(python.status, 0, python.stderr || String(python.error));
const py = JSON.parse(python.stdout);
assert.deepEqual(categories, py.categories);
const frontend = fs
  .readFileSync("web/app.js", "utf8")
  .match(/cats = (\[[\s\S]*?\]),/)[1];
assert.deepEqual(JSON.parse(frontend.replace(/,\s*\]/g, "]")), categories);
for (const [i, c] of cases.entries()) {
  const before = structuredClone(c.state);
  let result;
  try {
    result = { ok: true, state: apply(c.state, c.action) };
  } catch {
    result = { ok: false };
  }
  assert.deepEqual(c.state, before, c.name + " mutated input");
  assert.equal(result.ok, c.ok, c.name);
  assert.equal(py.results[i].ok, c.ok, "Python " + c.name);
  if (c.ok)
    assert.deepEqual(
      normalize(result.state),
      normalize(py.results[i].state),
      c.name,
    );
}
console.log(
  `Batch validation/atomicity/parity passed: ${cases.length} cases; category lists match`,
);
