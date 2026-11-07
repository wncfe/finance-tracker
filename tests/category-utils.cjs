const assert = require("node:assert/strict");
const { canonical, rank } = require("../web/category-utils.js");
assert.equal(canonical("Продукты"), "Супермаркеты");
const cats = ["Кофейни", "Супермаркеты", "Транспорт", "Другое"];
const state = {
  months: {
    a: {
      expenses: [
        { category: "Продукты" },
        { category: "Супермаркеты" },
        { category: "Транспорт" },
      ],
    },
    b: { expenses: [{ category: "Транспорт" }, { category: "Транспорт" }] },
  },
};
assert.deepEqual(rank(cats, state), [
  "Транспорт",
  "Супермаркеты",
  "Кофейни",
  "Другое",
]);
assert.deepEqual(rank(cats, { months: {} }), cats);
assert.deepEqual(cats, ["Кофейни", "Супермаркеты", "Транспорт", "Другое"]);
console.log("Category ranking/aliases passed");
