(function (root) {
  const canonical = (value) => (value === "Продукты" ? "Супермаркеты" : value);
  function rank(categories, state) {
    const counts = new Map(categories.map((c) => [c, 0]));
    for (const month of Object.values(state.months || {}))
      for (const e of month.expenses || []) {
        const c = canonical(e.category);
        counts.set(c, (counts.get(c) || 0) + 1);
      }
    return [...categories].sort(
      (a, b) =>
        (counts.get(b) || 0) - (counts.get(a) || 0) ||
        categories.indexOf(a) - categories.indexOf(b),
    );
  }
  root.CategoryUtils = { canonical, rank };
  if (typeof module !== "undefined") module.exports = root.CategoryUtils;
})(globalThis);
