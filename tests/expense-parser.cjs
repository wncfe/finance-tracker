const assert = require("node:assert/strict");
const fs = require("node:fs");
require("../web/expense-history.js");
const P = require("../web/expense-parser.js");
const today = new Date(2026, 10, 7, 12);
const one = (t) => P.parse(t, { today })[0];
let count = 0;
for (const [input, amount, date, category] of [
  ["кофе 250", 25000, "2026-11-07", "Кофейни"],
  ["250 кофе", 25000, "2026-11-07", "Кофейни"],
  ["вчера такси 430", 43000, "2026-11-06", "Транспорт"],
  ["5 ноября магнит 1200", 120000, "2026-11-05", "Продукты"],
  ["позавчера купил раф за 350", 35000, "2026-11-05", "Кофейни"],
  ["продукты 1 250,50 руб", 125050, "2026-11-07", "Продукты"],
  ["кофе 43.50", 4350, "2026-11-07", "Кофейни"],
  ["кофе 250р", 25000, "2026-11-07", "Кофейни"],
  ["2026-10-31 кофе 250", 25000, "2026-10-31", "Кофейни"],
  ["05.11.2026 кофе 250", 25000, "2026-11-05", "Кофейни"],
  ["05.11 кофе 250", 25000, "2026-11-05", "Кофейни"],
  ["ПЯТЁРОЧКА 500", 50000, "2026-11-07", "Продукты"],
  ["пятерочк 500", 50000, "2026-11-07", "Продукты"],
  ["аренда самоката 200", 20000, "2026-11-07", "Транспорт"],
]) {
  const r = one(input);
  assert.deepEqual(
    [r.amount, r.date, r.category, r.issues],
    [amount, date, category, []],
    input,
  );
  count++;
}
for (const text of [
  "кофе 12.05",
  "кофе 200 или 350",
  "31 февраля кофе 250",
  "вчера сегодня кофе 250",
  "возврат 300",
  "перевод 500",
  "снятие наличных 1000",
  "кофе -250",
]) {
  assert(one(text).issues.length, text);
  count++;
}
for (const text of [
  "магазин 500",
  "самокат 250",
  "яндекс 500",
  "абракадабра 200",
]) {
  assert.equal(one(text).category, "", text);
  count++;
}
for (const text of [
  "продукты 850, кофе 250",
  "кофе 250; такси 400",
  "кофе 250\nтакси 400",
]) {
  assert.equal(P.parse(text, { today }).length, 2);
  count++;
}
assert.equal(
  P.categoryFor("Кофе", { кофе: "Рестораны" }).category,
  "Рестораны",
);
assert.equal(
  P.categoryFor("xxx", {}, [
    { note: "xxx", category: "Дом" },
    { note: "xxx", category: "Спорт" },
  ]).category,
  "",
);
assert.equal(
  P.parse("вчера кофе 250", { today: new Date(2027, 0, 1) })[0].date,
  "2026-12-31",
);
console.log(`Parser checks passed: ${count + 3} cases`);
if (fs.existsSync("data/expense-analysis/holdout.json")) {
  const test = JSON.parse(
    fs.readFileSync("data/expense-analysis/holdout.json", "utf8"),
  );
  const stat = {
    total: test.length,
    amount: 0,
    date: 0,
    category: 0,
    manual: 0,
    errors: [],
  };
  for (const e of test) {
    const r = one(
      `${e.date} ${e.note} ${(e.amount / 100).toFixed(2).replace(".", ",")}`,
    );
    stat.amount += r.amount === e.amount;
    stat.date += r.date === e.date;
    stat.category += r.category === e.category;
    stat.manual += !r.category || r.issues.length > 0;
    if (r.category !== e.category)
      stat.errors.push({
        note: e.note,
        expected: e.category,
        actual: r.category,
      });
  }
  fs.writeFileSync(
    "data/expense-analysis/metrics.json",
    JSON.stringify(stat, null, 2),
  );
  console.log(JSON.stringify(stat, null, 2));
}
