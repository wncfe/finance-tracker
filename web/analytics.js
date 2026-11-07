(function (root) {
  "use strict";
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function valid(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return false;
    const d = new Date(value + "T12:00:00");
    return (
      !isNaN(d) &&
      iso(d) === value &&
      value >= "2000-01-01" &&
      value <= "2100-12-31"
    );
  }
  function range(mode, anchor, from, to) {
    if (mode === "custom") {
      if (!valid(from) || !valid(to) || from > to)
        throw Error("Выберите корректный период: начало не позже окончания");
      return { from, to };
    }
    if (!valid(anchor)) throw Error("Выберите дату периода");
    const start = new Date(anchor + "T12:00:00"),
      end = new Date(start);
    if (mode === "week") {
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 6);
    } else if (mode === "month") {
      start.setDate(1);
      end.setMonth(end.getMonth() + 1, 0);
    } else if (mode !== "day") throw Error("Неизвестный период");
    return {
      from: iso(start) < "2000-01-01" ? "2000-01-01" : iso(start),
      to: iso(end) > "2100-12-31" ? "2100-12-31" : iso(end),
    };
  }
  function summarize(state, period) {
    const sums = new Map();
    let total = 0,
      count = 0;
    for (const m of Object.values(state.months))
      for (const e of m.expenses)
        if (e.date >= period.from && e.date <= period.to) {
          sums.set(e.category, (sums.get(e.category) || 0) + e.amount);
          total += e.amount;
          count++;
        }
    return {
      total,
      count,
      categories: [...sums]
        .map(([category, amount]) => ({ category, amount }))
        .sort(
          (a, b) => b.amount - a.amount || a.category.localeCompare(b.category),
        ),
    };
  }
  root.ExpenseAnalytics = { range, summarize };
  if (typeof module !== "undefined") module.exports = root.ExpenseAnalytics;
  if (typeof document === "undefined") return;
  const colors = [
    "#79b5a2",
    "#ecc27f",
    "#8eb2e0",
    "#dca0b9",
    "#b0a2d9",
    "#abc681",
    "#e5a58c",
    "#87c5c9",
    "#c9ad95",
    "#bfa3b8",
    "#99bdc5",
    "#a6bfa0",
    "#d7bf94",
    "#b99bcb",
    "#c4c58c",
    "#88bcac",
    "#c4b8ac",
    "#a1add4",
    "#d0bd85",
    "#a6cccc",
    "#d3a2b5",
  ];
  let selectedCategory = "",
    lastMonth = "",
    syncDates = [];
  const syncCategory = attachSelect($("expenseCategory"));
  let editing = null;
  root.openCategoryEditor = (button) => {
    const month = button.dataset.month,
      identifier = button.dataset.recategorize;
    const expense = state.months[month]?.expenses.find(
      (e) => e.id === identifier,
    );
    if (!expense) return;
    editing = { month, id: expense.id, week: expense.week };
    $("categoryEditorNote").textContent = expense.note || expense.category;
    $("expenseCategory").innerHTML = categoryOptions()
      .map((c) => `<option>${esc(c)}</option>`)
      .join("");
    $("expenseCategory").value = expense.category;
    syncCategory();
    $("categoryEditor").showModal();
  };
  $("categoryEditorClose").onclick = () => {
    if (!busy) $("categoryEditor").close();
  };
  $("categoryEditor").addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  $("categoryEditorForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!editing || busy) return;
    if (
      await mutate({
        type: "recategorize",
        ...editing,
        category: $("expenseCategory").value,
      })
    ) {
      $("categoryEditor").close();
      toast("Категория изменена");
    }
  };
  const syncMode = attachSelect($("analysisMode"));
  for (const id of ["analysisDate", "analysisFrom", "analysisTo"])
    syncDates.push(attachPicker($(id), "date", { navigate: true }));
  let previousChartKey = "";
  function draw() {
    const mode = $("analysisMode").value;
    if (lastMonth !== selected) {
      if (mode !== "custom")
        $("analysisDate").value =
          selected === iso(new Date()).slice(0, 7)
            ? iso(new Date())
            : selected + "-01";
      lastMonth = selected;
    }
    if (!$("analysisFrom").value) $("analysisFrom").value = selected + "-01";
    if (!$("analysisTo").value)
      $("analysisTo").value = range("month", selected + "-01").to;
    syncDates.forEach((sync) => sync());
    syncMode();
    $("analysisCustom").hidden = mode !== "custom";
    $("analysisAnchor").hidden = mode === "custom";
    $("categories").hidden = true;
    let period;
    try {
      period = range(
        mode,
        $("analysisDate").value,
        $("analysisFrom").value,
        $("analysisTo").value,
      );
    } catch (error) {
      $("analysisRange").textContent = error.message;
      $("categoryChart").innerHTML = "";
      $("analysisLegend").innerHTML = "";
      return;
    }
    const summary = summarize(state, period);
    $("analysisRange").textContent =
      `${period.from.split("-").reverse().join(".")} — ${period.to.split("-").reverse().join(".")} · ${summary.count} трат`;
    if (!summary.total) {
      $("categoryChart").innerHTML =
        '<p class="muted">За этот период нет расходов</p>';
      $("analysisLegend").innerHTML = "";
      return;
    }
    if (!summary.categories.some((c) => c.category === selectedCategory))
      selectedCategory = "";
    const chartKey = JSON.stringify([period, summary]);
    if (
      chartKey === previousChartKey &&
      $("categoryChart").querySelector("svg")
    ) {
      updateSelection();
      return;
    }
    previousChartKey = chartKey;
    let offset = 0;
    const segments = summary.categories
      .map((c, i) => {
        const share = (c.amount / summary.total) * 100;
        const circle = `<circle class="chart-segment" data-chart-category="${esc(c.category)}" cx="100" cy="100" r="72" fill="none" stroke="${colors[i % colors.length]}" stroke-width="20" pathLength="100" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)" opacity="${!selectedCategory || selectedCategory === c.category ? 1 : 0.38}"><title>${esc(c.category)}: ${esc(money(c.amount))} (${share.toFixed(1)}%)</title></circle>`;
        offset += share;
        return circle;
      })
      .join("");
    $("categoryChart").innerHTML =
      `<svg viewBox="0 0 200 200" role="img" aria-label="Расходы по категориям: ${esc(money(summary.total))}">${segments}<text x="100" y="96" text-anchor="middle" class="chart-caption">Всего</text><text x="100" y="116" text-anchor="middle" class="chart-amount">${esc(money(summary.total))}</text></svg>`;
    $("analysisLegend").innerHTML = summary.categories
      .map(
        (c, i) =>
          `<button type="button" class="chart-legend" data-chart-category="${esc(c.category)}" aria-pressed="${selectedCategory === c.category}"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="${colors[i % colors.length]}"/></svg><span>${esc(c.category)}<small>${((c.amount / summary.total) * 100).toFixed(1)}%</small></span><strong>${money(c.amount)}</strong></button>`,
      )
      .join("");
    updateSelection();
  }
  function updateSelection() {
    $("categoryChart")
      .querySelectorAll("[data-chart-category]")
      .forEach((segment) => {
        const active = segment.dataset.chartCategory === selectedCategory;
        segment.setAttribute(
          "opacity",
          !selectedCategory || active ? "1" : "0.38",
        );
        segment.classList.toggle("is-selected", active);
      });
    $("analysisLegend")
      .querySelectorAll("[data-chart-category]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.chartCategory === selectedCategory),
        ),
      );
  }
  function chooseCategory(e) {
    const target = e.target.closest("[data-chart-category]");
    if (!target) return;
    selectedCategory =
      selectedCategory === target.dataset.chartCategory
        ? ""
        : target.dataset.chartCategory;
    updateSelection();
  }
  $("analysisLegend").onclick = chooseCategory;
  $("categoryChart").onclick = chooseCategory;
  for (const id of [
    "analysisMode",
    "analysisDate",
    "analysisFrom",
    "analysisTo",
  ])
    $(id).addEventListener("change", () => {
      selectedCategory = "";
      draw();
    });
  const previousRender = render;
  render = function () {
    previousRender();
    draw();
  };
  draw();
})(globalThis);
