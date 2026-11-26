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

  function chartMarkup(summary, slot) {
    const current = slot === "current";
    const amount = money(
      activeCategory
        ? summary.categories.find((item) => item.category === activeCategory)
            ?.amount || 0
        : summary.total,
    );
    const parts = [];
    const labels = [];
    const gradients = [];
    let offset = 0;
    for (const { category, amount } of summary.categories) {
      const index = cats.indexOf(category);
      const color = colors[index] || "#687776";
      const key = `history-ring-${slot}-${parts.length}`;
      const share = (amount / summary.total) * 100;
      const full = summary.categories.length === 1;
      const rounded = !full && share >= 6.5;
      const gap = full ? 0 : Math.min(1.05, share * 0.24) + (rounded ? 4.6 : 0);
      const position = offset + gap / 2;
      const radians = ((offset + share / 2) * Math.PI) / 50 - Math.PI / 2;
      offset += share;
      const muted = activeCategory && activeCategory !== category;
      const hint = `${esc(category)} · ${percentage.format(share / 100)} · ${money(amount)}`;

      gradients.push(`<linearGradient id="${key}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop stop-color="${color}" /><stop offset="100%" stop-color="${color}" stop-opacity=".78" />
      </linearGradient>`);
      parts.push(`<circle class="history-ring-segment" ${current ? `data-history-category="${esc(category)}"` : ""}
        cx="116" cy="116" r="86" pathLength="100" transform="rotate(-90 116 116)"
        stroke="url(#${key})" stroke-linecap="${rounded ? "round" : "butt"}"
        stroke-dasharray="${share - gap} 100" stroke-dashoffset="${-position}"
        ${muted ? 'opacity=".24"' : ""}><title>${hint}</title></circle>`);

      if (full || share < 11) continue;
      const x = Math.max(17, Math.min(215, 116 + Math.cos(radians) * 108));
      const y = Math.max(12, Math.min(220, 116 + Math.sin(radians) * 108));
      const symbol = iconNames[index] || "ellipsis";
      labels.push(`<g ${muted ? 'opacity=".32"' : ""}>
        <text x="${x}" y="${y}" text-anchor="middle">${Math.round(share)}%</text>
        <image href="/icons/${symbol}.svg" x="${108 + Math.cos(radians) * 86}" y="${108 + Math.sin(radians) * 86}" width="16" height="16" />
      </g>`);
    }
    const marker = current
      ? ""
      : `aria-hidden="true" data-history-preview="${slot === "previous" ? -1 : 1}"`;
    return `<div class="history-slide ${current ? "is-current" : "is-preview"}" ${marker}>
      <svg ${current ? 'id="historyChart"' : ""} viewBox="0 0 232 232" aria-hidden="true">
        <defs>${gradients.join("")}</defs>
        <circle class="history-ring-track" cx="116" cy="116" r="86" />
        ${parts.join("")}<g class="history-ring-labels">${labels.join("")}</g>
      </svg>
      <div class="history-ring-center">
        <span ${current ? 'id="historyChartLabel"' : ""}>${esc(activeCategory || "Траты за период")}</span>
        <strong ${current ? 'id="historyChartAmount"' : ""} ${amount.length >= 13 ? 'class="is-long"' : ""}>${amount}</strong>
      </div>
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

  function renderCarousel(data, p, summary, merchant) {
    animation?.cancel();
    animation = null;
    drag = null;
    const preview = (direction, slot) => {
      const at = adjacent(p, direction);
      if (!at) return '<div class="history-slide" aria-hidden="true"></div>';
      const range = period(at);
      return chartMarkup(
        A.summarize(
          { expenses: trackedExpenses(data, range, merchant) },
          range,
        ),
        slot,
      );
    };
    const track = $("historyTrack");
    track.style.removeProperty("--history-drag");
    track.innerHTML =
      preview(-1, "previous") +
      chartMarkup(summary, "current") +
      preview(1, "next");
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

    renderCarousel(data, p, summary, merchant);
    renderCategories(summary);
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
      const categoryButton = event.target.closest("[data-history-category]");
      if (categoryButton)
        toggleCategory(
          categoryButton.dataset.historyCategory,
          categoryButton instanceof HTMLButtonElement,
        );
    });
    $("historyPrevious").onclick = () => settle(-1);
    $("historyNext").onclick = () => settle(1);
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
