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
  let animation = null;
  let drag = null;

  function period(at = anchor) {
    const basis =
      at ||
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

  function adjacent(p, direction) {
    if (
      direction < 0
        ? p.from === firstDate
        : p.to >= todayDate() || p.to === lastDate
    )
      return "";
    return A.shift(direction < 0 ? p.from : p.to, direction);
  }

  function chartBreakdown(summary) {
    const primary = summary.categories.filter(
      (item, i) => i < 5 && (i === 0 || item.amount / summary.total >= 0.06),
    );
    const selectedItem = summary.categories.find(
      (item) => item.category === activeCategory,
    );
    if (selectedItem && !primary.includes(selectedItem)) {
      if (primary.length === 5) primary.pop();
      primary.push(selectedItem);
    }
    const tail = summary.categories.filter((item) => !primary.includes(item));
    if (tail.length < 2) return { slices: primary.concat(tail), remaining: [] };
    return {
      slices: primary.concat({
        amount: tail.reduce((sum, item) => sum + item.amount, 0),
        grouped: true,
      }),
      remaining: tail,
    };
  }

  const outerRadius = 97;
  const innerRadius = 73;
  const midRadius = (outerRadius + innerRadius) / 2;
  const turn = Math.PI * 2;
  const point = (r, a) => [116 + r * Math.cos(a), 116 + r * Math.sin(a)];
  const xy = (r, a) =>
    point(r, a)
      .map((value) => value.toFixed(2))
      .join(" ");

  function sector(start, end) {
    // Round each corner independently so thin slices keep the same radial thickness.
    const corner = Math.min(5, ((end - start) * innerRadius) / 4);
    const outerTrim = corner / outerRadius;
    const innerTrim = corner / innerRadius;
    const largeArc = (trim) => Number(end - start - 2 * trim > Math.PI);
    return `M ${xy(outerRadius, start + outerTrim)}
      A ${outerRadius} ${outerRadius} 0 ${largeArc(outerTrim)} 1 ${xy(outerRadius, end - outerTrim)}
      Q ${xy(outerRadius, end)} ${xy(outerRadius - corner, end)}
      L ${xy(innerRadius + corner, end)}
      Q ${xy(innerRadius, end)} ${xy(innerRadius, end - innerTrim)}
      A ${innerRadius} ${innerRadius} 0 ${largeArc(innerTrim)} 0 ${xy(innerRadius, start + innerTrim)}
      Q ${xy(innerRadius, start)} ${xy(innerRadius + corner, start)}
      L ${xy(outerRadius - corner, start)}
      Q ${xy(outerRadius, start)} ${xy(outerRadius, start + outerTrim)} Z`;
  }

  function chartMarkup(summary, slices, slot) {
    const current = slot === "current";
    const amount = money(
      activeCategory
        ? summary.categories.find((item) => item.category === activeCategory)
            ?.amount || 0
        : summary.total,
    );
    const chartLabel = activeCategory || "Траты за период";
    const parts = [];
    const labels = [];
    let start = -Math.PI / 2;
    for (const { category, amount, grouped } of slices) {
      const index = cats.indexOf(category);
      const label = grouped ? "Остальные" : category;
      const color = grouped ? "#748780" : colors[index] || "#687776";
      const share = amount / summary.total;
      const end = start + share * turn;
      const middle = (start + end) / 2;
      const gap = Math.min(2.6 / midRadius, (end - start) * 0.16);
      const full = slices.length === 1;
      const muted = activeCategory && activeCategory !== category;
      const hint = `${esc(label)} · ${percentage.format(share)} · ${money(amount)}`;
      const action = !current
        ? ""
        : grouped
          ? "data-history-remainder"
          : `data-history-category="${esc(category)}"`;
      const attributes = `class="history-ring-segment" ${action} ${muted ? 'opacity=".25"' : ""}`;
      parts.push(
        full
          ? `<circle ${attributes} cx="116" cy="116" r="${midRadius}" fill="none" stroke="${color}" stroke-width="${outerRadius - innerRadius}"><title>${hint}</title></circle>`
          : `<path ${attributes} fill="${color}" d="${sector(start + gap / 2, end - gap / 2)}"><title>${hint}</title></path>`,
      );
      start = end;

      if (full || share < 0.07) continue;
      const withIcon = share >= 0.14;
      const [x, y] = point(midRadius, middle + (withIcon ? 13 / midRadius : 0));
      const [ix, iy] = point(midRadius, middle - 13 / midRadius);
      const symbol = iconNames[index] || "ellipsis";
      labels.push(`<g ${muted ? 'opacity=".36"' : ""}>
        <text x="${x}" y="${y}" text-anchor="middle">${Math.round(share * 100)}%</text>
        ${withIcon ? `<image href="/icons/${symbol}.svg" x="${ix - 7}" y="${iy - 7}" width="14" height="14" />` : ""}
      </g>`);
    }
    const marker = current
      ? `role="group" aria-label="${esc(chartLabel)} · ${amount}"`
      : `aria-hidden="true" data-history-preview="${slot === "previous" ? -1 : 1}"`;
    const amountSize = Math.min(25, 128 / (amount.length * 0.62));
    const labelSize = Math.min(12, 124 / (chartLabel.length * 0.62));
    return `<div class="history-slide ${current ? "is-current" : "is-preview"}" ${marker}>
      <svg ${current ? 'id="historyChart"' : ""} viewBox="0 0 232 232" aria-hidden="true">
        ${parts.length ? "" : `<circle class="history-ring-track" cx="116" cy="116" r="${midRadius}" stroke-width="${outerRadius - innerRadius}" />`}
        ${parts.join("")}<g class="history-ring-labels">${labels.join("")}</g>
        <g class="history-ring-center" text-anchor="middle">
          <text ${current ? 'id="historyChartLabel"' : ""} x="116" y="109" font-size="${labelSize}">${esc(chartLabel)}</text>
          <text ${current ? 'id="historyChartAmount"' : ""} x="116" y="134" class="history-ring-amount" font-size="${amountSize}">${amount}</text>
        </g>
      </svg>
    </div>`;
  }

  function trackedExpenses(data, range, merchant) {
    return A.operations(data, {
      from: range.from,
      to: range.to < todayDate() ? range.to : todayDate(),
    }).filter(
      (expense) =>
        !merchant ||
        (merchant === "__none__"
          ? !expense.merchantId
          : expense.merchantId === merchant),
    );
  }

  function renderCarousel(data, p, summary, slices, merchant) {
    animation?.cancel();
    animation = null;
    drag = null;
    const preview = (direction, slot) => {
      const at = adjacent(p, direction);
      if (!at) return '<div class="history-slide" aria-hidden="true"></div>';
      const range = period(at);
      const neighbor = A.summarize(
        { expenses: trackedExpenses(data, range, merchant) },
        range,
      );
      return chartMarkup(neighbor, chartBreakdown(neighbor).slices, slot);
    };
    const track = $("historyTrack");
    track.style.removeProperty("--history-drag");
    track.innerHTML =
      preview(-1, "previous") +
      chartMarkup(summary, slices, "current") +
      preview(1, "next");
  }

  function categoryChip({ category, amount, grouped }) {
    const index = cats.indexOf(category);
    const color = grouped ? "#748780" : colors[index] || "#687776";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "history-category";
    chip.style.setProperty("--category-color", color);
    if (grouped) {
      chip.setAttribute("data-history-remainder", "");
      chip.setAttribute("aria-haspopup", "dialog");
      chip.setAttribute("aria-controls", "historyRemainderDialog");
    } else {
      chip.dataset.historyCategory = category;
      chip.setAttribute("aria-pressed", String(category === activeCategory));
    }
    chip.innerHTML = `<span class="history-category-icon" aria-hidden="true">${icons[index] || icon("ellipsis")}</span>
      <span class="history-category-copy">
        <span>${grouped ? "Остальные" : esc(category)}</span><strong>${money(amount)}</strong>
      </span>`;
    return chip;
  }

  function renderCategories({ slices, remaining }) {
    $("historyCategories").replaceChildren(...slices.map(categoryChip));
    $("historyRemainderCategories").replaceChildren(
      ...remaining.map(categoryChip),
    );
    if (!remaining.length && $("historyRemainderDialog").open)
      $("historyRemainderDialog").close();
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
    const data = A.index(state);
    const merchant = updateMerchant(trackedExpenses(data, range, ""));
    const matched = trackedExpenses(data, range, merchant);
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

    const breakdown = chartBreakdown(summary);
    renderCarousel(data, p, summary, breakdown.slices, merchant);
    renderCategories(breakdown);
    $("historyTotalLabel").textContent =
      budgetWeek || merchant || activeCategory
        ? "Потрачено по фильтрам"
        : `Потрачено за ${periodLabels[scale]}`;
    $("historyTotal").textContent = money(sumExpenses(visible));
    $("history").innerHTML = entries(visible);
  }

  function slideOffset() {
    const track = $("historyTrack");
    const gap = parseFloat(getComputedStyle(track).columnGap);
    return track.children[1].getBoundingClientRect().width + gap;
  }

  function settle(direction, offset = 0) {
    if (animation) return;
    const at = direction ? adjacent(period(), direction) : "";
    const finish = () => {
      animation?.cancel();
      animation = null;
      $("historyTrack").style.removeProperty("--history-drag");
      if (at) {
        anchor = at;
        $("filter").value = "";
        render();
      }
    };
    if (
      (!at && !offset) ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      finish();
      return;
    }
    const target = at ? -direction * slideOffset() : 0;
    animation = $("historyTrack").animate(
      [
        { transform: `translateX(calc(-50% + ${offset}px))` },
        { transform: `translateX(calc(-50% + ${target}px))` },
      ],
      {
        duration: at ? 270 : 200,
        easing: "cubic-bezier(.2,.75,.25,1)",
        fill: "forwards",
      },
    );
    animation.onfinish = finish;
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
    const remainderDialog = $("historyRemainderDialog");
    let swiped = false;
    ring.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0 || animation) return;
      swiped = false;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        offset: 0,
      };
    });
    ring.addEventListener("pointermove", (event) => {
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!swiped) {
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        ring.setPointerCapture(event.pointerId);
        swiped = true;
        drag.limit = slideOffset();
        const p = period();
        drag.canPrevious = Boolean(adjacent(p, -1));
        drag.canNext = Boolean(adjacent(p, 1));
      }
      const available = dx > 0 ? drag.canPrevious : drag.canNext;
      drag.offset = available
        ? Math.max(-drag.limit, Math.min(drag.limit, dx))
        : dx * 0.2;
      $("historyTrack").style.setProperty("--history-drag", `${drag.offset}px`);
    });
    const endDrag = (event) => {
      if (drag?.id !== event.pointerId) return;
      const { offset } = drag;
      drag = null;
      if (!offset) return;
      const direction =
        event.type === "pointerup" && Math.abs(offset) >= 44
          ? offset > 0
            ? -1
            : 1
          : 0;
      settle(direction, offset);
    };
    ring.addEventListener("pointerup", endDrag);
    ring.addEventListener("pointercancel", endDrag);
    ring.addEventListener("lostpointercapture", (event) => {
      if (event.target === ring) endDrag(event);
    });

    $("panel-history").addEventListener("click", (event) => {
      const periodButton = event.target.closest("[data-history-scale]");
      if (periodButton && periodButton.dataset.historyScale !== scale) {
        scale = periodButton.dataset.historyScale;
        $("filter").value = "";
        render();
      }
      if (ring.contains(event.target) && (swiped || animation)) return;
      const preview = event.target.closest("[data-history-preview]");
      if (preview) settle(Number(preview.dataset.historyPreview));
      if (event.target.closest("[data-history-remainder]")) {
        $("historyCategories")
          .querySelector("[data-history-remainder]")
          ?.focus({ preventScroll: true });
        remainderDialog.showModal();
        return;
      }
      const categoryButton = event.target.closest("[data-history-category]");
      if (categoryButton)
        toggleCategory(
          categoryButton.dataset.historyCategory,
          categoryButton instanceof HTMLButtonElement,
        );
    });
    $("historyPrevious").onclick = () => settle(-1);
    $("historyNext").onclick = () => settle(1);
    $("historyRemainderClose").onclick = () => remainderDialog.close();
    $("historyRemainderCategories").onclick = (event) => {
      const button = event.target.closest("[data-history-category]");
      if (!button) return;
      remainderDialog.close();
      toggleCategory(button.dataset.historyCategory, true);
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
