"use strict";

const ExpenseHistoryView = (() => {
  const A = ExpenseAnalytics;
  const firstDate = "2000-01-01";
  const lastDate = "2100-12-31";
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

  const center = 124;
  const outerRadius = 95;
  const innerRadius = 69;
  const midRadius = (outerRadius + innerRadius) / 2;
  const labelRadius = 115;
  const remainingColor = "#788780";
  const turn = Math.PI * 2;
  const point = (r, a) => [center + r * Math.cos(a), center + r * Math.sin(a)];
  const xy = (r, a) =>
    point(r, a)
      .map((value) => value.toFixed(3))
      .join(" ");
  const segmentSymbol = (category, grouped) => {
    if (grouped) return "ellipsis";
    return category === "Другое" ? "wallet" : categoryIcon(category);
  };

  function sector(start, end) {
    const largeArc = Number(end - start > Math.PI);
    return `M ${xy(outerRadius, start)}
      A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${xy(outerRadius, end)}
      L ${xy(innerRadius, end)}
      A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${xy(innerRadius, start)} Z`;
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
    const heads = [];
    const full = slices.length === 1;
    let start = -Math.PI / 2;
    for (const [
      sliceIndex,
      { category, amount, grouped },
    ] of slices.entries()) {
      const index = cats.indexOf(category);
      const label = grouped ? "Остальные" : category;
      const sliceColor = grouped ? remainingColor : categoryColor(category);
      const share = amount / summary.total;
      const end = start + share * turn;
      const middle = (start + end) / 2;
      const muted = activeCategory && activeCategory !== category;
      const color = muted
        ? `color-mix(in srgb, ${sliceColor} 25%, #f5f8f2)`
        : sliceColor;
      const hint = `${esc(label)} · ${percentage.format(share)} · ${money(amount)}`;
      const action = !current
        ? ""
        : grouped
          ? "data-history-remainder"
          : `data-history-category="${esc(category)}"`;
      const attributes = `class="history-ring-segment" ${action}`;
      parts.push(
        full
          ? `<circle ${attributes} cx="${center}" cy="${center}" r="${midRadius}" fill="none" stroke="${color}" stroke-width="${outerRadius - innerRadius}"><title>${hint}</title></circle>`
          : `<path ${attributes} fill="${color}" d="${sector(start, end)}"><title>${hint}</title></path>`,
      );
      if (!full) {
        // Finish each arc with a rounded cap that blends into the next category.
        const length = share * turn * midRadius;
        const inset = Math.min(3, length / 5);
        const nextAmount = slices[(sliceIndex + 1) % slices.length].amount;
        const nextLength = (nextAmount / summary.total) * turn * midRadius;
        const capRadius = Math.min(
          (outerRadius - innerRadius) / 2,
          length * 0.46,
          inset + nextLength * 0.55,
        );
        const [x, y] = point(midRadius, end - inset / midRadius);
        const symbol = segmentSymbol(category, grouped);
        heads.push(`<g class="history-ring-trailing">
          <circle class="history-ring-head history-ring-segment" ${action} cx="${x}" cy="${y}" r="${capRadius}" fill="${color}"><title>${hint}</title></circle>
          ${capRadius >= 8 ? `<image class="history-ring-symbol" href="/icons/${symbol}.svg" x="${x - 6.5}" y="${y - 6.5}" width="13" height="13" ${muted ? 'opacity=".5"' : ""} />` : ""}
        </g>`);
      }
      start = end;

      if (full || share < 0.047) continue;
      const [x, y] = point(labelRadius, middle);
      const labelX = Math.max(15, Math.min(233, x));
      labels.push(
        `<text x="${labelX}" y="${y}" ${muted ? 'opacity=".4"' : ""}>${Math.round(share * 100)}%</text>`,
      );
    }
    const marker = current
      ? `role="group" aria-label="${esc(chartLabel)} · ${amount}"`
      : `aria-hidden="true" data-history-preview="${slot === "previous" ? -1 : 1}"`;
    const amountSize = Math.min(25, 128 / (amount.length * 0.62));
    const labelSize = Math.min(12, 124 / (chartLabel.length * 0.62));
    return `<div class="history-slide ${current ? "is-current" : "is-preview"}" ${marker}>
      <svg ${current ? 'id="historyChart"' : ""} viewBox="0 0 ${center * 2} ${center * 2}" aria-hidden="true">
        ${parts.length ? "" : `<circle class="history-ring-track" cx="${center}" cy="${center}" r="${midRadius}" stroke-width="${outerRadius - innerRadius}" />`}
        ${parts.join("")}
        <g class="history-ring-heads">${heads.join("")}</g>
        <g class="history-ring-labels" text-anchor="middle">${labels.join("")}</g>
        <g class="history-ring-center" text-anchor="middle">
          <text ${current ? 'id="historyChartLabel"' : ""} x="${center}" y="${center - 6}" font-size="${labelSize}">${esc(chartLabel)}</text>
          <text ${current ? 'id="historyChartAmount"' : ""} x="${center}" y="${center + 19}" class="history-ring-amount" font-size="${amountSize}">${amount}</text>
        </g>
      </svg>
    </div>`;
  }

  function trackedExpenses(data, range) {
    return A.operations(data, {
      from: range.from,
      to: range.to < todayDate() ? range.to : todayDate(),
    });
  }

  function renderCarousel(data, p, summary, slices) {
    animation?.cancel();
    animation = null;
    drag = null;
    const preview = (direction, slot) => {
      const at = adjacent(p, direction);
      if (!at) return '<div class="history-slide" aria-hidden="true"></div>';
      const range = period(at);
      const neighbor = A.summarize(
        { expenses: trackedExpenses(data, range) },
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
    const color = grouped ? remainingColor : categoryColor(category);
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
    chip.innerHTML = `<span class="history-category-icon" aria-hidden="true">${icon(segmentSymbol(category, grouped))}</span>
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
    const range = p;
    const data = A.index(state);
    const matched = trackedExpenses(data, range);
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
    renderCarousel(data, p, summary, breakdown.slices);
    renderCategories(breakdown);
    renderEntries($("history"), visible);
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
  }

  function reset() {
    anchor = "";
  }

  return { init, render, reset };
})();
