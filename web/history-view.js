"use strict";

const ExpenseHistoryView = (() => {
  const A = ExpenseAnalytics;
  const firstDate = "2000-01-01";
  const lastDate = "2100-12-31";
  const periodLabels = { week: "неделю", month: "месяц", year: "год" };
  const colors = [
    "#ad5e42",
    "#906049",
    "#a76b39",
    "#567fa0",
    "#477694",
    "#5571a2",
    "#427a64",
    "#a75666",
    "#8461a3",
    "#775798",
    "#a85b88",
    "#42766e",
    "#a06658",
    "#8f526e",
    "#8a7844",
    "#526d8b",
    "#615faa",
    "#35818a",
    "#a05679",
    "#687776",
    "#5b803f",
    "#895e3f",
  ];
  const monthLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const dayLabel = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const percentage = new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 1,
  });
  let scale = "month";
  let anchor = "";
  let activeCategory = "";
  let expanded = false;

  function period() {
    const basis =
      anchor ||
      (selected === todayDate().slice(0, 7) ? todayDate() : selected + "-01");
    const year = basis.slice(0, 4);
    return scale === "year"
      ? { from: year + "-01-01", to: year + "-12-31" }
      : A.range(scale, basis);
  }

  function updateWeek(month) {
    const select = $("filter");
    const previous = select.value;
    $("historyBudgetWeek").hidden = scale !== "month";
    const weeks = state.months[month]?.weeks || calendar(month);
    const dateInMonth = (day) =>
      A.date(month + "-" + String(day).padStart(2, "0"));
    select.innerHTML =
      '<option value="">Весь месяц</option>' +
      weeks
        .map((week, i) => {
          const label = dayLabel.formatRange(
            dateInMonth(week.start),
            dateInMonth(week.end),
          );
          return `<option value="${i}">${esc(label)}</option>`;
        })
        .join("");
    select.value = weeks[Number(previous)] && previous !== "" ? previous : "";
    return scale === "month" && select.value !== ""
      ? weeks[Number(select.value)]
      : null;
  }

  function updateMerchant(expenses) {
    const select = $("historyMerchant");
    const previous = select.value;
    const used = new Set(expenses.map((expense) => expense.merchantId));
    const merchants = MerchantDictionary.all(state.merchants, true).filter(
      (merchant) => used.has(merchant.id) || merchant.id === previous,
    );
    select.innerHTML =
      '<option value="">Все магазины</option><option value="__none__">Без магазина</option>' +
      merchants
        .map(
          (merchant) =>
            `<option value="${esc(merchant.id)}">${esc(merchant.name)}</option>`,
        )
        .join("");
    select.value =
      previous === "__none__" ||
      merchants.some((merchant) => merchant.id === previous)
        ? previous
        : "";
    return select.value;
  }

  function renderChart(summary) {
    const track =
      '<circle class="history-ring-track" cx="116" cy="116" r="94" />';
    let offset = 0;
    const segments = summary.categories.map(({ category, amount }) => {
      const share = (amount / summary.total) * 100;
      const gap =
        summary.categories.length > 1 ? Math.min(1.25, share * 0.28) : 0;
      const position = offset + gap / 2;
      offset += share;
      return `<circle class="history-ring-segment" data-history-category="${esc(category)}"
        cx="116" cy="116" r="94" pathLength="100" transform="rotate(-90 116 116)"
        stroke="${colors[cats.indexOf(category)] || "#687776"}"
        stroke-dasharray="${share - gap} 100" stroke-dashoffset="${-position}"
        ${activeCategory && activeCategory !== category ? 'opacity="0.26"' : ""}>
        <title>${esc(category)} · ${percentage.format(share / 100)} · ${money(amount)}</title>
      </circle>`;
    });
    $("historyChart").innerHTML = track + segments.join("");
    const amount = activeCategory
      ? summary.categories.find((item) => item.category === activeCategory)
          ?.amount || 0
      : summary.total;
    $("historyChartLabel").textContent = activeCategory || "Траты за период";
    const total = $("historyChartAmount");
    total.textContent = money(amount);
    total.classList.toggle("is-long", total.textContent.length >= 13);
  }

  function renderCategories(summary) {
    const limit = 6;
    const visible = summary.categories.filter(
      (item, i) => expanded || i < limit || item.category === activeCategory,
    );
    const container = $("historyCategories");
    container.innerHTML = visible
      .map(({ category, amount }) => {
        const index = cats.indexOf(category);
        return `<button type="button" class="history-category" data-history-category="${esc(category)}" aria-pressed="${category === activeCategory}">
        <span class="history-category-icon" aria-hidden="true">${icons[index] || icon("ellipsis")}</span>
        <span class="history-category-copy">
          <span>${esc(category)}</span><strong>${money(amount)}</strong>
        </span>
      </button>`;
      })
      .join("");
    for (const button of container.children) {
      const color =
        colors[cats.indexOf(button.dataset.historyCategory)] || "#687776";
      button.style.setProperty("--category-color", color);
    }
    const expand = $("historyExpandCategories");
    expand.hidden = summary.categories.length <= limit;
    expand.setAttribute("aria-expanded", String(expanded));
    expand.textContent = expanded
      ? "Свернуть категории"
      : `Все категории (${summary.categories.length})`;
    $("historyClearCategory").hidden = !activeCategory;
  }

  function render() {
    const p = period();
    const month = p.from.slice(0, 7);
    const budgetWeek = updateWeek(month);
    const range = budgetWeek
      ? {
          from: month + "-" + String(budgetWeek.start).padStart(2, "0"),
          to: month + "-" + String(budgetWeek.end).padStart(2, "0"),
        }
      : p;
    const expenses = A.operations(state, {
      from: range.from,
      to: range.to < todayDate() ? range.to : todayDate(),
    });
    const merchant = updateMerchant(expenses);
    const matched = expenses.filter(
      (expense) =>
        !merchant ||
        (merchant === "__none__"
          ? !expense.merchantId
          : expense.merchantId === merchant),
    );
    const summary = A.summarize({ expenses: matched }, range);
    const visible = activeCategory
      ? matched.filter((expense) => expense.category === activeCategory)
      : matched;

    const label =
      scale === "year"
        ? p.from.slice(0, 4)
        : scale === "month"
          ? monthLabel.format(A.date(p.from)).replace(/ г\.$/, "")
          : dateLabel.formatRange(A.date(p.from), A.date(p.to));
    $("historyPeriod").textContent = label;
    $("historyPrevious").disabled = p.from === firstDate;
    $("historyNext").disabled = p.to >= todayDate() || p.to === lastDate;
    for (const button of document.querySelectorAll("[data-history-scale]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.historyScale === scale),
      );

    renderChart(summary);
    renderCategories(summary);
    $("historyTotalLabel").textContent =
      budgetWeek || merchant || activeCategory
        ? "Потрачено по фильтрам"
        : `Потрачено за ${periodLabels[scale]}`;
    $("historyTotal").textContent = money(sumExpenses(visible));
    $("history").innerHTML = entries(visible);
  }

  function step(direction) {
    const p = period();
    if (
      direction < 0
        ? p.from === firstDate
        : p.to >= todayDate() || p.to === lastDate
    )
      return false;
    anchor = A.shift(direction < 0 ? p.from : p.to, direction);
    $("filter").value = "";
    render();
    return true;
  }

  function toggleCategory(category, returnFocus = false) {
    activeCategory = activeCategory === category ? "" : category;
    render();
    if (returnFocus) {
      const buttons = Array.from($("historyCategories").children);
      buttons
        .find((button) => button.dataset.historyCategory === category)
        ?.focus({ preventScroll: true });
    }
  }

  function init() {
    const ring = $("historyRing");
    let touchStart = null;
    let swiped = false;
    ring.addEventListener("pointerdown", (event) => {
      swiped = false;
      if (event.isPrimary && event.pointerType !== "mouse")
        touchStart = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
    });
    ring.addEventListener("pointercancel", () => {
      touchStart = null;
    });
    ring.addEventListener("pointerup", (event) => {
      if (touchStart?.id !== event.pointerId) return;
      const dx = event.clientX - touchStart.x;
      const dy = event.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      swiped = true;
      if (
        step(dx > 0 ? -1 : 1) &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        ring.animate(
          [
            { transform: `translateX(${dx > 0 ? -12 : 12}px)`, opacity: 0.7 },
            { transform: "translateX(0)", opacity: 1 },
          ],
          { duration: 180, easing: "ease-out" },
        );
    });

    $("panel-history").addEventListener("click", (event) => {
      const periodButton = event.target.closest("[data-history-scale]");
      if (periodButton && periodButton.dataset.historyScale !== scale) {
        scale = periodButton.dataset.historyScale;
        $("filter").value = "";
        render();
      }
      const categoryButton = event.target.closest("[data-history-category]");
      if (categoryButton && (!ring.contains(categoryButton) || !swiped))
        toggleCategory(
          categoryButton.dataset.historyCategory,
          categoryButton instanceof HTMLButtonElement,
        );
    });
    $("historyPrevious").onclick = () => step(-1);
    $("historyNext").onclick = () => step(1);
    $("historyExpandCategories").onclick = () => {
      expanded = !expanded;
      render();
    };
    $("historyClearCategory").onclick = () => {
      activeCategory = "";
      render();
      ($("historyCategories").firstElementChild || $("historyPrevious")).focus({
        preventScroll: true,
      });
    };
    $("filter").onchange = render;
    $("historyMerchant").onchange = render;
  }

  function reset() {
    anchor = "";
    $("filter").value = "";
    $("historyMerchant").value = "";
  }

  return { init, render, reset };
})();
