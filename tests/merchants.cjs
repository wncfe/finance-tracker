const assert = require("node:assert/strict");
const dictionary = require("../web/merchants.js");

assert.equal(
  dictionary.resolve("  ЯНДЕКС   ТАКСИ ").matches[0].id,
  "b-yandex-taxi",
);
assert.equal(dictionary.resolve("Yandex Taxi").matches[0].id, "b-yandex-taxi");
assert.equal(dictionary.resolve("ROSTIC’S").matches[0].id, "b-rostics");
assert.equal(dictionary.resolve("кафе").status, "unknown");
assert.equal(dictionary.resolve("магнит косметик").status, "unknown");
assert.equal(dictionary.resolve("магни").status, "unknown");
assert.equal(dictionary.resolve("магни").suggestions[0].id, "b-magnit");
for (const text of ["Пятёрочка", "пятерочка", "  ПЯТЕРОЧКА ", "5КА"])
  assert.equal(dictionary.resolve(text).matches[0].id, "b-pyaterochka");
for (const text of ["яндекс", "магазин", "перевод", "кафе", "магнит доставка"])
  assert.equal(dictionary.resolve(text).status, "unknown");
assert.equal(dictionary.resolve("ростикс").matches[0].id, "b-rostics");
assert.equal(dictionary.resolve("").status, "unknown");
assert.equal(
  dictionary.resolve("общий", [
    { id: "a", name: "Первый", aliases: ["общий"] },
    { id: "b", name: "Второй", aliases: ["общий"] },
  ]).status,
  "ambiguous",
);
assert.equal(
  dictionary.resolve(
    "Магнит",
    dictionary.all([
      { id: "b-magnit", name: "Магнит", aliases: [], hidden: true },
    ]),
  ).status,
  "unknown",
);
console.log("Merchant dictionary checks passed");
