(function () {
  "use strict";
  const A = ExpenseAnalytics,
    fmt = (s) => s.split("-").reverse().join("."),
    span = (p) => `${fmt(p.from)} — ${fmt(p.to)}`;
  const percent = (n) =>
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n) +
    "%";
  const plural = (n, forms) =>
    forms[
      n % 100 >= 11 && n % 100 <= 14
        ? 2
        : n % 10 === 1
          ? 0
          : n % 10 >= 2 && n % 10 <= 4
            ? 1
            : 2
    ];
  const operationCount = (n) =>
    `${n} ${plural(n, ["операция", "операции", "операций"])}`;
  const weekdaysNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const monthLabel = (day) =>
    `${months[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
  const shortRange = (p) => {
    if (p.from.slice(0, 4) !== p.to.slice(0, 4)) return span(p);
    return dateLabel.formatRange(A.date(p.from), A.date(p.to));
  };
  const signedMoney = (n) =>
    `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;
  const compactMoney = (n) =>
    new Intl.NumberFormat("ru-RU", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n / 100) + " ₽";
  let cachedState,
    data,
    lastMonth = "",
    activeCategory = "",
    detail = null,
    found = [],
    repeated = [],
    trendDays = [],
    trendBuckets = [],
    selectedBucket = 0,
    selectedDay = "",
    allCategories = false,
    paceData = null,
    pacePoint = null;
  const quickLaunch = $("quickopen").parentElement;
  const analyticsPanel = $("panel-analytics");
  const helpPopup = $("analyticsHelp");
  let helpTrigger = null,
    helpPinned = false,
    helpTimer;
  function closeHelp() {
    clearTimeout(helpTimer);
    if (helpPopup.matches(":popover-open")) helpPopup.hidePopover();
    helpTrigger = null;
    helpPinned = false;
  }
  function showHelp(button) {
    clearTimeout(helpTimer);
    if (helpTrigger === button && helpPopup.matches(":popover-open")) return;
    helpTrigger = button;
    helpPopup.textContent = button.dataset.analyticsHelp;
    if (!helpPopup.matches(":popover-open")) helpPopup.showPopover();
    positionHelp();
  }
  function positionHelp() {
    if (!helpTrigger || !helpPopup.matches(":popover-open")) return;
    const rect = helpTrigger.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    if (
      !helpTrigger.isConnected ||
      rect.bottom < 0 ||
      rect.top > clientHeight
    ) {
      closeHelp();
      return;
    }
    const margin = 10,
      gap = 6,
      width = helpPopup.offsetWidth,
      height = helpPopup.offsetHeight;
    const left = Math.max(
      margin,
      Math.min(
        rect.left + (rect.width - width) / 2,
        clientWidth - width - margin,
      ),
    );
    const top =
      rect.bottom + gap + height > clientHeight - margin
        ? Math.max(margin, rect.top - height - gap)
        : rect.bottom + gap;
    Object.assign(helpPopup.style, { left: `${left}px`, top: `${top}px` });
  }
  function leaveHelp() {
    if (helpPinned || helpTrigger?.matches(":focus-visible")) return;
    clearTimeout(helpTimer);
    helpTimer = setTimeout(closeHelp, 120);
  }
  analyticsPanel.addEventListener("pointerover", (e) => {
    const button = e.target.closest("[data-analytics-help]");
    if (button && e.pointerType === "mouse" && !helpPinned) showHelp(button);
  });
  analyticsPanel.addEventListener("pointerout", (e) => {
    if (e.target === helpTrigger) leaveHelp();
  });
  analyticsPanel.addEventListener("focusin", (e) => {
    if (e.target.matches("[data-analytics-help]:focus-visible"))
      showHelp(e.target);
  });
  analyticsPanel.addEventListener("focusout", (e) => {
    if (e.target === helpTrigger) closeHelp();
  });
  analyticsPanel.addEventListener("click", (e) => {
    const button = e.target.closest("[data-analytics-help]");
    if (!button) return;
    if (
      helpPinned &&
      helpTrigger === button &&
      helpPopup.matches(":popover-open")
    )
      closeHelp();
    else {
      showHelp(button);
      helpPinned = true;
    }
  });
  helpPopup.addEventListener("pointerenter", () => clearTimeout(helpTimer));
  helpPopup.addEventListener("pointerleave", leaveHelp);
  helpPopup.addEventListener("toggle", () => {
    if (!helpPopup.matches(":popover-open")) closeHelp();
  });
  window.addEventListener("resize", positionHelp);
  window.addEventListener("scroll", positionHelp, true);
  const syncs = {};
  for (const id of [
    "analysisMode",
    "paceWindow",
    "analysisCategory",
    "heatmapMode",
  ])
    syncs[id] = attachSelect($(id));
  for (const id of ["analysisDate", "analysisFrom", "analysisTo"])
    syncs[id] = attachPicker($(id), "date", { navigate: true });
  for (const id of ["analysisMonth", "reportMonth"])
    syncs[id] = attachPicker($(id), "month", { navigate: true });
  document.addEventListener("finance-saving", (e) => {
    $("analysisUpdateStatus").hidden = !e.detail;
    $("analysisContent").setAttribute("aria-busy", String(e.detail));
  });
  function source() {
    if (cachedState !== state) {
      cachedState = state;
      data = A.index(state);
    }
    return data;
  }
  function metric(label, value) {
    return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }
  function change(c) {
    return `${c.delta > 0 ? "+" : ""}${money(c.delta)}${c.percent === null ? " · ранее расходов не было" : ` (${c.percent > 0 ? "+" : ""}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(c.percent)}%)`}`;
  }
  function helpButton(label, text) {
    return `<button type="button" class="analytics-help" data-analytics-help="${esc(text)}" aria-label="${esc(label)}" aria-description="${esc(text)}">?</button>`;
  }
  function periodMetric(label, value, explanation = "") {
    return `<div><div class="kpi-label"><span>${label}</span>${explanation ? helpButton(`О показателе «${label}»`, explanation) : ""}</div><strong>${money(value)}</strong></div>`;
  }
  function currentPeriod() {
    return A.range(
      $("analysisMode").value,
      $("analysisDate").value,
      $("analysisFrom").value,
      $("analysisTo").value,
    );
  }
  function draw() {
    closeHelp();
    if ($("panel-analytics").hidden || $("dashboard").hidden) return;
    const d = source(),
      today = todayDate(),
      mode = $("analysisMode").value;
    if (lastMonth !== selected) {
      $("analysisDate").value =
        selected === today.slice(0, 7) ? today : selected + "-01";
      $("analysisFrom").value = selected + "-01";
      $("analysisTo").value = A.range("month", selected + "-01").to;
      lastMonth = selected;
    }
    const selectedCat = $("analysisCategory").value;
    $("analysisCategory").innerHTML =
      '<option value="">Все категории</option>' +
      [...new Set([...cats, ...d.expenses.map((e) => e.category)])]
        .map((c) => `<option>${esc(c)}</option>`)
        .join("");
    $("analysisCategory").value = selectedCat;
    activeCategory = $("analysisCategory").value;
    $("clearAnalysisCategory").hidden = !activeCategory;
    $("analysisMonth").value = $("analysisDate").value.slice(0, 7);
    for (const id of [
      "analysisMode",
      "analysisMonth",
      "analysisDate",
      "analysisFrom",
      "analysisTo",
      "analysisCategory",
      "heatmapMode",
    ])
      syncs[id]();
    $("analysisCustom").hidden = mode !== "custom";
    $("analysisAnchor").hidden = mode === "custom" || mode === "month";
    $("analysisMonthControl").hidden = mode !== "month";
    $("analysisFilterSummary").textContent =
      mode === "month"
        ? monthLabel($("analysisDate").value)
        : $("analysisMode").selectedOptions[0].textContent;
    let p;
    try {
      p = currentPeriod();
    } catch (e) {
      $("analysisError").textContent = e.message;
      $("analysisError").hidden = false;
      $("analysisContent").hidden = true;
      return;
    }
    if (mode !== "month")
      $("analysisFilterSummary").textContent =
        mode === "day" ? fmt(p.from) : shortRange(p);
    if (p.from > today) {
      $("analysisError").textContent = `${span(p)} · период ещё не начался`;
      $("analysisError").hidden = false;
      $("analysisContent").hidden = true;
      return;
    }
    $("analysisError").hidden = true;
    $("analysisContent").hidden = false;
    const effective = { from: p.from, to: p.to > today ? today : p.to },
      summary = A.summarize(d, effective),
      actual = activeCategory
        ? A.summarize(d, effective, activeCategory)
        : summary,
      days = A.daily(d, effective, today, activeCategory),
      average = Math.round(actual.total / days.length),
      median = Math.round(
        A.quantile(
          days.map((day) => day.amount),
          0.5,
        ),
      ),
      c = A.compare(d, p, mode, today, activeCategory),
      hasPrevious = d.first && d.first <= c.previous.from;
    const comparable =
      hasPrevious && A.length(c.current) === A.length(c.previous);
    const previousHelp = comparable
      ? `За прошлый сопоставимый период (${shortRange(c.previous)}) — ${money(c.prior.total)}.${c.percent !== null && c.current.to === effective.to ? ` Изменение ${c.percent > 0 ? "+" : ""}${percent(c.percent)}.` : ""}`
      : "";
    $("analysisMetrics").innerHTML =
      periodMetric("За период", actual.total, previousHelp) +
      periodMetric(
        "Среднее",
        average,
        "Средний расход за день. Дни без покупок тоже учитываются.",
      ) +
      periodMetric(
        "Медиана",
        median,
        "В половине дней расходы были не выше этой суммы. Дни без покупок тоже учитываются.",
      );
    trendDays = days;
    selectedBucket = -1;
    drawTrend(days);
    drawCategories(summary);
    drawHeatmap(p);
    drawPace(effective.to);
    repeated = A.habits(d, effective, today, activeCategory);
    const weekdays = Array(7).fill(0);
    for (const e of A.operations(d, effective, activeCategory))
      weekdays[A.weekday(e.date)] += e.amount;
    const weekdayMax = Math.max(1, ...weekdays);
    $("weekdaySpending").innerHTML = weekdays
      .map(
        (sum, i) =>
          `<div class="weekday-row"><span>${weekdaysNames[i]}</span><div><i data-fill="${(sum / weekdayMax) * 100}"></i></div><strong>${money(sum)}</strong></div>`,
      )
      .join("");
    applyFillWidths($("weekdaySpending"));
    const openHabits = new Set(
      [...$("habits").querySelectorAll("details[open]")].map(
        (el) => el.dataset.habitKey,
      ),
    );
    $("habits").innerHTML = repeated.length
      ? repeated
          .map((h, i) => {
            const frequency = new Intl.NumberFormat("ru-RU", {
              maximumFractionDigits: 1,
            }).format((h.count / h.span) * 7);
            const maximum = Math.max(...h.weekdays);
            const byWeekday = h.weekdays
              .map(
                (n, j) =>
                  `<li aria-label="${weekdaysNames[j]}: ${n}"><span class="habit-weekday-track"><i data-fill="${(100 * n) / maximum}"></i></span><span>${weekdaysNames[j]}</span></li>`,
              )
              .join("");
            return `<details class="habit-card" data-habit-key="${esc(h.key)}"${openHabits.has(h.key) ? " open" : ""}>
            <summary><span class="habit-name"><strong>${esc(h.label)}</strong><span>${h.count} ${plural(h.count, ["покупка", "покупки", "покупок"])} · ≈ ${frequency} раза в неделю</span></span><strong class="habit-total">${money(h.total)}</strong></summary>
            <div class="habit-details">
              <p>${esc(h.category)} · средний чек <strong>${money(h.average)}</strong></p>
              ${h.previousCount ? `<p>За предыдущий равный период — ${money(h.previousTotal)} · ${operationCount(h.previousCount)}</p>` : ""}
              <ul class="habit-weekdays" aria-label="Покупки по дням недели">${byWeekday}</ul>
              ${h.monthly === null ? "" : `<p>При той же частоте — около ${money(h.monthly)} в месяц</p>`}
              <div class="habit-actions"><button class="analytics-link" type="button" data-habit="${i}">Операции</button></div>
            </div>
          </details>`;
          })
          .join("")
      : '<div class="analytics-empty"><strong>Повторяющиеся покупки пока не найдены</strong><p>Здесь появятся магазины и покупки, которые повторились хотя бы в три разных дня.</p></div>';
    $("habits")
      .querySelectorAll(".habit-weekday-track i")
      .forEach((el) => {
        el.style.height = `${Number(el.dataset.fill)}%`;
      });
    const coverage = {};
    found = A.anomalies(d, effective, today, activeCategory, coverage);
    $("observationCount").textContent = found.length;
    $("anomalies").classList.toggle("is-many", found.length > 1);
    const coverageText = coverage.checked
      ? "Для части дней истории ещё мало. Выводы относятся только к дням и неделям, которые удалось сравнить."
      : "Нужно хотя бы восемь похожих дней или завершённых недель в истории. Пока рано делать выводы.";
    $("anomalies").innerHTML = found.length
      ? found
          .map((a, i) => {
            const label =
              a.type === "day"
                ? fmt(a.period.from)
                : a.type === "category"
                  ? `${a.category} · ${span(a.period)}`
                  : span(a.period);
            const comparisonHelp =
              a.type === "day"
                ? `Сравнили с тем же днём недели за предыдущие недели (${a.samples} наблюдений).`
                : `Сравнили с завершёнными неделями (${a.samples} наблюдений).`;
            return `<article class="observation"><div class="observation-marker" aria-hidden="true">${a.kind === "new" ? "+" : "↗"}</div><div><span class="insight-type">${a.kind === "new" ? "Раньше таких расходов почти не было" : "Расходы выше привычных"}${a.period.to === today ? " · итог ещё может измениться" : ""}</span><button type="button" class="insight-title" data-anomaly="${i}">${esc(label)} <span aria-hidden="true">↗</span></button><div class="observation-value"><strong class="insight-amount">${money(a.amount)}</strong>${helpButton("Как рассчитано отклонение", comparisonHelp)}</div><p>${a.kind === "new" ? "В большинстве похожих периодов расходов не было." : `Обычно в ${a.type === "day" ? "этот день недели" : "такую неделю"} — около ${money(a.median)}.`}</p></div></article>`;
          })
          .join("") +
        (coverage.checked < coverage.total
          ? `<p class="panel-caption">${coverageText}</p>`
          : "")
      : `<div class="analytics-empty"><span class="empty-symbol" aria-hidden="true">${coverage.checked ? "✓" : "⋯"}</span><strong>${coverage.checked ? "Заметных отклонений не нашли" : "Пока мало истории для выводов"}</strong><p>${coverage.checked === coverage.total && coverage.checked ? "В днях и неделях, которые удалось сравнить, расходы в привычном диапазоне." : coverageText}</p></div>`;
  }
  function drawTrend(days) {
    const focusIndex = document.activeElement?.dataset.bucket;
    const empty = !days.some((d) => d.amount);
    $("trendChart").hidden = empty;
    $("trendSelection").hidden = empty;
    $("trendDailyDetails").hidden = empty;
    $("trendEmpty").hidden = !empty;
    const size = Math.max(1, Math.ceil(days.length / 90));
    $("trendTitle").textContent =
      size > 1 ? "Расходы по отрезкам" : "Расходы по дням";
    if (empty) return;
    const expensesByDay = new Map();
    for (const e of A.operations(
      source(),
      { from: days[0].date, to: days.at(-1).date },
      activeCategory,
    )) {
      if (!expensesByDay.has(e.date)) expensesByDay.set(e.date, []);
      expensesByDay.get(e.date).push(e);
    }
    trendBuckets = [];
    for (let i = 0; i < days.length; i += size) {
      const group = days.slice(i, i + size);
      const expenses = group.flatMap((d) => expensesByDay.get(d.date) || []);
      trendBuckets.push({
        from: group[0].date,
        to: group.at(-1).date,
        amount: group.reduce((sum, d) => sum + d.amount, 0),
        expenses,
      });
    }
    const max = Math.max(100, ...trendBuckets.map((d) => d.amount));
    const unit = 10 ** Math.floor(Math.log10(max));
    const ceiling = Math.ceil(max / unit) * unit;
    const width = Math.max(220, $("trendChart").clientWidth),
      left = width < 400 ? 48 : 58,
      right = 6,
      height = width < 400 ? 136 : 166,
      top = 12,
      bottom = top + height,
      plotWidth = width - left - right,
      step = plotWidth / trendBuckets.length,
      axisY = bottom + 22,
      svgHeight = axisY + 5;
    const tick = (index) => fmt(days[index].date).slice(0, 5);
    $("trendChart").innerHTML =
      `<div class="trend-plot"><svg width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="${size > 1 ? `Расходы, до ${size} дней на столбец` : "Расходы по дням"}">${[
        0, 1, 2, 3,
      ]
        .map((i) => {
          const y = top + (height * i) / 3;
          return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="chart-gridline"/><text x="${left - 7}" y="${y + 4}" text-anchor="end">${compactMoney((ceiling * (3 - i)) / 3)}</text>`;
        })
        .join("")}${trendBuckets
        .map((d, i) => {
          const bar = d.amount ? Math.max(2, (height * d.amount) / ceiling) : 0;
          return `<rect class="trend-bar" data-bar="${i}" x="${left + i * step + step * 0.13}" y="${bottom - bar}" width="${Math.max(1, step * 0.74)}" height="${bar}" rx="${Math.min(4, step * 0.15)}"/>`;
        })
        .join(
          "",
        )}<text x="${left}" y="${axisY}">${tick(0)}</text>${days.length > 5 ? `<text x="${left + plotWidth / 2}" y="${axisY}" text-anchor="middle">${tick(Math.floor(days.length / 2))}</text>` : ""}${days.length > 1 ? `<text x="${width - right}" y="${axisY}" text-anchor="end">${tick(days.length - 1)}</text>` : ""}</svg><div class="trend-hitareas">${trendBuckets
        .map(
          (d, i) =>
            `<button type="button" data-bucket="${i}" aria-label="${shortRange(d)}, ${money(d.amount)}, ${operationCount(d.expenses.length)}" aria-pressed="false"></button>`,
        )
        .join("")}</div></div>`;
    Object.assign($("trendChart").querySelector(".trend-hitareas").style, {
      left: `${left}px`,
      right: `${right}px`,
      top: `${top}px`,
      height: `${height}px`,
    });
    if (selectedBucket < 0 || selectedBucket >= trendBuckets.length)
      selectedBucket = trendBuckets.length - 1;
    selectBucket(selectedBucket);
    if (focusIndex !== undefined)
      $("trendChart")
        .querySelector(`[data-bucket="${focusIndex}"]`)
        ?.focus({ preventScroll: true });
    $("trendTable").innerHTML =
      '<div class="daily-table">' +
      days
        .map(
          (d) =>
            `<button type="button" data-day="${d.date}"><span>${fmt(d.date)}${d.partial ? " · сегодня" : ""}</span><strong>${money(d.amount)}</strong></button>`,
        )
        .join("") +
      "</div>";
  }
  function selectBucket(index, commit = true) {
    const d = trendBuckets[index];
    if (!d) return;
    if (commit) selectedBucket = index;
    $("trendChart")
      .querySelectorAll("[data-bucket]")
      .forEach((b) => {
        const active = Number(b.dataset.bucket) === selectedBucket;
        b.setAttribute("aria-pressed", String(active));
        b.tabIndex = active ? 0 : -1;
      });
    $("trendChart")
      .querySelectorAll("[data-bar]")
      .forEach((b) =>
        b.classList.toggle("is-active", Number(b.dataset.bar) === index),
      );
    const single = d.expenses.length === 1;
    $("trendSelection").innerHTML =
      `<div><span>${shortRange(d)}${d.to === todayDate() && d.from === d.to ? " · сегодня" : ""}</span><strong>${money(d.amount)}</strong>${d.expenses.length ? `<small>${single ? esc(d.expenses[0].category) : operationCount(d.expenses.length)}</small>` : ""}</div>${d.expenses.length ? `<button type="button" id="openTrendOperations" data-trend-operations="${index}">${single ? "Открыть операцию" : "Операции"}</button>` : ""}`;
  }
  function applyFillWidths(container) {
    container.querySelectorAll("[data-fill]").forEach((el) => {
      el.style.width = `${Number(el.dataset.fill)}%`;
    });
  }
  function drawCategories(summary) {
    $("showAllCategories").hidden = summary.categories.length <= 5;
    $("showAllCategories").setAttribute("aria-expanded", String(allCategories));
    $("showAllCategories").textContent = allCategories
      ? "Свернуть список"
      : `Все категории (${summary.categories.length})`;
    $("analysisLegend").innerHTML = summary.total
      ? summary.categories
          .filter(
            (c, i) => allCategories || i < 5 || c.category === activeCategory,
          )
          .map(
            (c) =>
              `<button type="button" class="chart-legend category-row" data-chart-category="${esc(c.category)}" aria-pressed="${activeCategory === c.category}"><span class="category-row-title"><span>${esc(c.category)}</span><strong>${money(c.amount)}</strong></span><span class="category-bar-track"><span data-fill="${(c.amount / summary.total) * 100}"></span></span><small>${percent((c.amount / summary.total) * 100)}</small></button>`,
          )
          .join("")
      : '<div class="analytics-empty"><strong>Расходов пока нет</strong><p>Здесь появится распределение ваших покупок.</p></div>';
    applyFillWidths($("analysisLegend"));
  }
  function drawPace(asOf) {
    paceData = A.spendingPace(
      state,
      asOf.slice(0, 7),
      asOf,
      todayDate(),
      Number($("paceWindow").value),
      activeCategory,
    );
    const r = paceData,
      n = r.count;
    $("paceHeadline").innerHTML = n
      ? `<strong class="pace-amount ${r.delta > 0 ? "pace-above" : ""}">${r.delta ? money(Math.abs(r.delta)) : ""}</strong><p>${r.delta > 0 ? "больше обычного" : r.delta < 0 ? "меньше обычного" : "Расходы на привычном уровне"}${n < 3 ? " · предварительно" : ""}</p>`
      : '<p class="pace-empty">Сравнение появится, когда накопится история за закрытые месяцы.</p>';
    $("paceChart").hidden = !n;
    $("paceSelection").hidden = !n;
    $("paceWindow").parentElement.hidden =
      !n &&
      (r.history.window === 12 ||
        !A.historicalMonths(state, r.month, 12, r.day, source()).accepted
          .length);
    const paceRows = r.categories.flatMap((c, i) =>
      c.delta
        ? [
            `<button type="button" class="pace-category" data-pace-category="${i}"><span><strong>${esc(c.category)}</strong><small>Обычно ${money(c.expected)}</small></span><span><strong>${money(c.actual)}</strong><small class="pace-difference ${c.delta > 0 ? "is-above" : ""}">${signedMoney(c.delta)}</small></span></button>`,
          ]
        : [],
    );
    $("paceBreakdown").hidden = !paceRows.length;
    $("paceCategories").innerHTML =
      paceRows.slice(0, 3).join("") +
      (paceRows.length > 3
        ? `<details class="pace-more"><summary>Ещё ${paceRows.length - 3} ${plural(paceRows.length - 3, ["категория", "категории", "категорий"])}</summary>${paceRows.slice(3).join("")}</details>`
        : "");
    const paceHelp = n
      ? `Сравниваем накопленные расходы к тому же числу. Из последних ${r.history.window} мес. подошло ${n}.`
      : "Для сравнения берём месяцы с учётом с первого дня и всеми закрытыми неделями.";
    const paceHelpButton = $("paceHelp");
    paceHelpButton.dataset.analyticsHelp = paceHelp;
    paceHelpButton.setAttribute("aria-description", paceHelp);
    pacePoint = r.day;
    if (n) drawPaceChart();
    else {
      $("paceChart").replaceChildren();
      $("paceSelection").replaceChildren();
    }
  }
  function drawPaceChart() {
    const r = paceData;
    if (!r?.count) return;
    const width = Math.max(220, $("paceChart").clientWidth),
      left = 12,
      right = 12,
      top = 20,
      height = 155,
      bottom = top + height,
      totalDays = A.length(r.period),
      plot = width - left - right;
    const max = Math.max(
      100,
      ...r.actual.map((p) => p.amount),
      ...r.expected.map((p) => p.amount),
    );
    const x = (day) => left + (plot * day) / totalDays,
      y = (amount) => bottom - (height * amount) / max;
    const line = (points) =>
      points
        .map((p, i) => `${i ? "L" : "M"}${x(p.day)},${y(p.amount)}`)
        .join(" ");
    const actualPath = line(r.actual),
      actualEnd = r.actual.at(-1);
    $("paceChart").innerHTML =
      `<div class="pace-chart-key"><span><i></i>Факт</span><span><i class="pace-key-reference"></i>Историческое среднее</span></div><div class="pace-plot"><svg width="${width}" height="213" viewBox="0 0 ${width} 213" role="img" aria-label="Накопленные расходы и историческое среднее на одной шкале"><defs><linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#79b5a2" stop-opacity=".2"/><stop offset="100%" stop-color="#79b5a2" stop-opacity="0"/></linearGradient></defs>${[
        0, 1, 2, 3,
      ]
        .map((i) => {
          const gridY = top + (height * i) / 3;
          return `<line x1="${left}" x2="${width - right}" y1="${gridY}" y2="${gridY}" class="chart-gridline"/>`;
        })
        .join(
          "",
        )}<path d="${line(r.expected)}" class="pace-reference"/><path d="${actualPath} L${x(r.day)},${bottom} L${left},${bottom} Z" fill="url(#paceFill)"/><path d="${actualPath}" class="pace-actual"/><circle class="pace-endpoint" cx="${x(r.day)}" cy="${y(actualEnd.amount)}" r="5"/><line id="paceCrosshair" x1="${x(r.day)}" x2="${x(r.day)}" y1="${top}" y2="${bottom}"/><text x="${left}" y="204">Начало</text>${r.day < totalDays && r.day > 3 ? `<text x="${x(r.day)}" y="204" text-anchor="middle">${r.day}</text>` : ""}<text x="${width - right}" y="204" text-anchor="end">${totalDays}</text></svg><div class="pace-hitareas">${r.actual
        .slice(1)
        .map(
          (p) =>
            `<button type="button" data-pace-day="${p.day}" tabindex="${p.day === pacePoint ? 0 : -1}" aria-label="${fmt(p.date)}: накоплено ${money(p.amount)}${r.expected[p.day] ? `, обычно ${money(r.expected[p.day].amount)}` : ""}"></button>`,
        )
        .join("")}</div></div>`;
    const hits = $("paceChart").querySelector(".pace-hitareas");
    Object.assign(hits.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${(plot * r.day) / totalDays}px`,
      height: `${height}px`,
    });
    selectPacePoint(pacePoint || r.day);
  }
  function selectPacePoint(day) {
    const r = paceData,
      p = r.actual[day];
    if (!p) return;
    pacePoint = day;
    const usual = r.expected[day].amount;
    const hasOperations = day > 0 && p.amount > r.actual[day - 1].amount;
    $("paceSelection").innerHTML =
      `<div><span>${dateLabel.format(A.date(p.date))}</span><div class="pace-point-values"><span>Факт <strong>${money(p.amount)}</strong></span><span>Обычно <strong>${money(usual)}</strong></span></div></div>${hasOperations ? '<button id="openPaceDay" class="analytics-link" type="button">Операции дня</button>' : ""}`;
    $("paceChart")
      .querySelectorAll("[data-pace-day]")
      .forEach((b) => {
        b.tabIndex = Number(b.dataset.paceDay) === day ? 0 : -1;
        b.setAttribute(
          "aria-pressed",
          String(Number(b.dataset.paceDay) === day),
        );
      });
    const cross = $("paceCrosshair"),
      width = Math.max(220, $("paceChart").clientWidth),
      x = 12 + ((width - 24) * day) / A.length(r.period);
    cross.setAttribute("x1", x);
    cross.setAttribute("x2", x);
  }
  $("paceChart").addEventListener("pointerover", (e) => {
    const b = e.target.closest("[data-pace-day]");
    if (b && e.pointerType === "mouse")
      selectPacePoint(Number(b.dataset.paceDay));
  });
  $("paceChart").addEventListener("focusin", (e) => {
    const b = e.target.closest("[data-pace-day]");
    if (b) selectPacePoint(Number(b.dataset.paceDay));
  });
  $("paceChart").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pace-day]");
    if (b) selectPacePoint(Number(b.dataset.paceDay));
  });
  $("paceChart").addEventListener("keydown", (e) => {
    const b = e.target.closest("[data-pace-day]");
    if (!b) return;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (step) {
      e.preventDefault();
      $("paceChart")
        .querySelector(
          `[data-pace-day="${Math.max(1, Math.min(paceData.day, Number(b.dataset.paceDay) + step))}"]`,
        )
        ?.focus();
    }
  });
  $("paceSelection").onclick = (e) => {
    if (!e.target.closest("#openPaceDay")) return;
    const date = paceData.actual[pacePoint].date;
    showOperations(
      fmt(date),
      A.operations(source(), { from: date, to: date }, activeCategory),
      activeCategory || "Все категории",
    );
  };
  $("paceCategories").onclick = (e) => {
    const b = e.target.closest("[data-pace-category]");
    if (!b) return;
    const c = paceData.categories[Number(b.dataset.paceCategory)];
    showOperations(
      `${c.category} · ${paceData.month}`,
      A.operations(
        source(),
        { from: paceData.period.from, to: paceData.asOf },
        c.category,
      ),
      `Сейчас ${money(c.actual)}, обычно ${money(c.expected)} за первые ${paceData.day} дн.; база ${paceData.count} мес.`,
    );
  };
  $("paceWindow").addEventListener("change", draw);
  let paceWidth = 0;
  new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    if (width > 0 && width !== paceWidth) {
      paceWidth = width;
      if (paceData && !$("panel-analytics").hidden) drawPaceChart();
    }
  }).observe($("paceChart"));
  function drawHeatmap(p) {
    const last = p.from.slice(0, 7) + "-01",
      months = [];
    for (let i = $("heatmapMode").value === "year" ? 11 : 0; i >= 0; i--) {
      const d = A.date(last);
      d.setUTCMonth(d.getUTCMonth() - i);
      if (A.iso(d) >= "2000-01-01") months.push(A.range("month", A.iso(d)));
    }
    const all = months.flatMap((m) =>
        A.daily(source(), m, todayDate(), activeCategory),
      ),
      maximum = Math.max(0, ...all.map((d) => d.amount || 0)),
      max = Math.max(1, maximum);
    $("heatmapDayPreview").hidden = true;
    $("calendarPanel").classList.toggle(
      "is-year",
      $("heatmapMode").value === "year",
    );
    $("heatmapScale").innerHTML =
      `<span>0 ₽</span><div class="heat-scale-swatches">${[0, 1, 2, 3, 4].map((i) => `<span class="heat-${i}" title="${i === 0 ? "0 ₽" : `Больше ${money(Math.floor(((i - 1) * maximum) / 4))}, до ${money(Math.floor((i * maximum) / 4))}`}" aria-label="${i === 0 ? "Нет расходов" : `До ${money(Math.floor((i * maximum) / 4))}`}"></span>`).join("")}</div><span>${money(maximum)}<br><small>максимум</small></span>`;
    if ($("heatmapMode").value === "year") {
      drawYearHeatmap(all, maximum);
      return;
    }
    $("heatmap").classList.remove("is-year-heatmap");
    $("heatmap").innerHTML = months
      .map(
        (m) =>
          `<section class="heatmap-month"><h4>${new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(A.date(m.from))}</h4><div class="heatmap-grid">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => `<span>${d}</span>`).join("")}${Array(A.weekday(m.from)).fill("<span></span>").join("")}${A.daily(
            source(),
            m,
            todayDate(),
            activeCategory,
          )
            .map(
              (d) =>
                `<button type="button" class="heat-cell heat-${d.amount === null ? "future" : d.amount === 0 ? 0 : Math.min(4, Math.ceil((d.amount / max) * 4))} ${d.partial ? "is-today" : ""} ${selectedDay === d.date ? "is-selected" : ""}" aria-pressed="${selectedDay === d.date}" data-day="${d.date}" ${d.amount === null ? "disabled" : ""} aria-label="${fmt(d.date)}: ${d.amount === null ? "будущий день" : money(d.amount)}${d.partial ? ", день не завершён" : ""}" title="${fmt(d.date)}: ${d.amount === null ? "будущий день" : money(d.amount)}">${Number(d.date.slice(8))}</button>`,
            )
            .join("")}</div></section>`,
      )
      .join("");
  }
  function drawYearHeatmap(days, maximum) {
    const offset = A.weekday(days[0].date),
      weeks = Math.ceil((offset + days.length) / 7);
    const max = Math.max(1, maximum);
    const focusDate =
      selectedDay &&
      days.some((d) => d.date === selectedDay && d.amount !== null)
        ? selectedDay
        : days.findLast((d) => d.amount !== null)?.date;
    $("heatmap").classList.add("is-year-heatmap");
    $("heatmap").innerHTML =
      `<div class="year-scroll" tabindex="0" role="region" aria-label="Расходы за 12 месяцев. Прокрутите по горизонтали; стрелки выбирают день."><div class="year-heatmap"><div class="year-weekdays" aria-hidden="true">${weekdaysNames.map((name, i) => `<span>${i % 2 === 0 ? name : ""}</span>`).join("")}</div><div class="year-timeline"><div class="year-month-labels" aria-hidden="true">${days.map((d, i) => (d.date.endsWith("-01") ? `<span data-week="${Math.floor((offset + i) / 7) + 1}">${new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" }).format(A.date(d.date))}</span>` : "")).join("")}</div><div class="year-grid">${Array(offset).fill('<span class="year-spacer"></span>').join("")}${days.map((d) => `<button type="button" class="heat-cell heat-${d.amount === null ? "future" : d.amount === 0 ? 0 : Math.min(4, Math.ceil((d.amount / max) * 4))} ${d.partial ? "is-today" : ""} ${selectedDay === d.date ? "is-selected" : ""}" data-day="${d.date}" data-amount="${d.amount ?? ""}" tabindex="${d.date === focusDate ? 0 : -1}" aria-pressed="${selectedDay === d.date}" ${d.amount === null ? "disabled" : ""} aria-label="${fmt(d.date)}: ${d.amount === null ? "будущий день" : money(d.amount)}${d.partial ? ", день ещё не завершён" : ""}"></button>`).join("")}</div></div></div></div><p class="year-range">${span({ from: days[0].date, to: days.at(-1).date })} · один квадрат — один день</p>`;
    const labels = $("heatmap").querySelector(".year-month-labels");
    labels.style.gridTemplateColumns = `repeat(${weeks}, var(--year-cell))`;
    labels.querySelectorAll("[data-week]").forEach((el) => {
      el.style.gridColumn = `${el.dataset.week} / span ${Math.min(3, weeks - Number(el.dataset.week) + 1)}`;
    });
    requestAnimationFrame(() => {
      const cell = $("heatmap").querySelector('.year-grid [tabindex="0"]');
      const scroll = $("heatmap").querySelector(".year-scroll");
      if (cell && scroll)
        scroll.scrollLeft = Math.max(
          0,
          cell.offsetLeft - scroll.clientWidth + 64,
        );
    });
  }
  function previewHeatDay(button) {
    if (
      !button?.dataset.day ||
      button.disabled ||
      !button.closest(".year-grid")
    )
      return;
    const preview = $("heatmapDayPreview");
    preview.hidden = false;
    preview.textContent = `${fmt(button.dataset.day)} · ${money(Number(button.dataset.amount))}${button.classList.contains("is-today") ? " · день ещё не завершён" : ""}. Нажмите, чтобы открыть операции.`;
  }
  $("heatmap").addEventListener("pointerover", (e) =>
    previewHeatDay(e.target.closest("[data-day]")),
  );
  $("heatmap").addEventListener("focusin", (e) =>
    previewHeatDay(e.target.closest("[data-day]")),
  );
  $("heatmap").addEventListener("keydown", (e) => {
    const button = e.target.closest(".year-grid [data-day]");
    if (!button) return;
    const shift = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[
      e.key
    ];
    if (shift === undefined) return;
    e.preventDefault();
    const next = $("heatmap").querySelector(
      `[data-day="${A.shift(button.dataset.day, shift)}"]`,
    );
    if (next && !next.disabled) {
      button.tabIndex = -1;
      next.tabIndex = 0;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
  function showOperations(title, expenses, explanation = "") {
    detail = { title, ids: new Set(expenses.map((e) => e.id)), explanation };
    renderDetail();
    $("analysisDetails").showModal();
  }
  function renderDetail() {
    if (!detail) return;
    const expenses = source().expenses.filter((e) => detail.ids.has(e.id));
    $("analysisDetailsTitle").textContent = detail.title;
    renderCategoryMarkup(
      $("analysisDetailsBody"),
      `<p>${esc(detail.explanation)}</p><p>Всего: ${money(expenses.reduce((s, e) => s + e.amount, 0))}</p>` +
        entries(expenses),
    );
  }
  function drawReport() {
    const month = $("reportMonth").value;
    if (!month) return;
    if (month > todayDate().slice(0, 7)) {
      $("reportBody").textContent = "Этот месяц ещё не начался";
      return;
    }
    const r = A.report(source(), month, todayDate());
    $("reportBody").innerHTML =
      `<p class="eyebrow">${r.partial ? "ПРОМЕЖУТОЧНЫЕ ИТОГИ" : "ИТОГИ МЕСЯЦА"}</p><div class="analysis-metrics">${metric("Расходы", money(r.actual.total))}${metric("Изменение", change(r))}${metric("В день", money(r.actualAverage))}</div><p class="muted">Расходы за ${span(r.actualPeriod)}. Сравнение: ${span(r.current)} с ${span(r.previous)}. По актуальным операциям.</p><h3>Категории</h3>${r.actual.categories.map((c) => `<p>${esc(c.category)}: ${money(c.amount)} (${((c.amount / r.actual.total) * 100).toFixed(1)}%)</p>`).join("") || '<p class="muted">Расходов нет</p>'}<h3>Основные изменения</h3>${r.summary.categories
        .map((c) => {
          const old =
            r.prior.categories.find((x) => x.category === c.category)?.amount ||
            0;
          return { ...c, delta: c.amount - old };
        })
        .concat(
          r.prior.categories
            .filter(
              (c) =>
                !r.summary.categories.some((x) => x.category === c.category),
            )
            .map((c) => ({ ...c, delta: -c.amount })),
        )
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 3)
        .map(
          (c) =>
            `<p>${esc(c.category)}: ${c.delta > 0 ? "+" : ""}${money(c.delta)}</p>`,
        )
        .join("")}<h3>Привычки</h3>${
        r.habits
          .slice(0, 5)
          .map(
            (h) =>
              `<p>${esc(h.label)} · ${h.count} покупок · ${money(h.total)}</p>`,
          )
          .join("") || '<p class="muted">Недостаточно повторов</p>'
      }<h3>Необычные расходы</h3>${
        r.anomalies
          .slice(0, 5)
          .map(
            (a) =>
              `<p>${esc(a.label)}: ${money(a.amount)}; медиана ${money(a.median)} (${a.samples} наблюдений). ${a.kind === "new" ? "Появление расходов" : "Выше обычного"}.</p>`,
          )
          .join("") ||
        '<p class="muted">Отклонений не найдено или недостаточно истории</p>'
      }`;
  }
  document.addEventListener("click", (e) => {
    const close = e.target.closest("[data-close]");
    if (close) $(close.dataset.close).close();
    const day = e.target.closest("[data-day]");
    if (day) {
      selectedDay = day.dataset.day;
      $("heatmap")
        .querySelectorAll("[data-day]")
        .forEach((b) => {
          b.classList.toggle("is-selected", b.dataset.day === selectedDay);
          b.setAttribute("aria-pressed", String(b.dataset.day === selectedDay));
          if (b.closest(".year-grid"))
            b.tabIndex = b.dataset.day === selectedDay ? 0 : -1;
        });
      showOperations(
        fmt(day.dataset.day),
        A.operations(
          source(),
          { from: day.dataset.day, to: day.dataset.day },
          activeCategory,
        ),
        activeCategory || "Все категории",
      );
    }
    const h = e.target.closest("[data-habit]");
    if (h) {
      const habit = repeated[Number(h.dataset.habit)];
      const includesDescriptions = habit.expenses.some((e) => !e.merchantId);
      showOperations(
        habit.label,
        habit.expenses,
        habit.merchantId
          ? includesDescriptions
            ? "Расходы сервиса и записи той же категории с совпадающим описанием"
            : "Операции одного магазина или сервиса"
          : "Покупки одной категории с одинаковым описанием",
      );
    }
    const a = e.target.closest("[data-anomaly]");
    if (a) {
      const finding = found[Number(a.dataset.anomaly)];
      showOperations(
        finding.label,
        finding.expenses,
        `Обычно — около ${money(finding.median)}. Сравнили с ${finding.samples} похожими периодами. Здесь можно посмотреть покупки, из которых сложилась сумма.`,
      );
    }
    const cat = e.target.closest("[data-chart-category]");
    if (cat) {
      $("analysisCategory").value =
        activeCategory === cat.dataset.chartCategory
          ? ""
          : cat.dataset.chartCategory;
      draw();
      $("analysisLegend")
        .querySelector(
          `[data-chart-category="${CSS.escape(cat.dataset.chartCategory)}"]`,
        )
        ?.focus({ preventScroll: true });
    }
  });
  $("clearAnalysisCategory").onclick = () => {
    $("analysisCategory").value = "";
    draw();
    $("analysisCategory").parentElement.querySelector("button")?.focus();
  };
  $("showAllCategories").onclick = () => {
    allCategories = !allCategories;
    const p = currentPeriod();
    drawCategories(
      A.summarize(source(), {
        from: p.from,
        to: p.to > todayDate() ? todayDate() : p.to,
      }),
    );
  };
  $("trendChart").addEventListener("pointerover", (e) => {
    const b = e.target.closest("[data-bucket]");
    if (b && e.pointerType === "mouse")
      selectBucket(Number(b.dataset.bucket), false);
  });
  $("trendChart").addEventListener("pointerleave", () =>
    selectBucket(selectedBucket),
  );
  for (const event of ["focusin", "click"])
    $("trendChart").addEventListener(event, (e) => {
      const b = e.target.closest("[data-bucket]");
      if (b) selectBucket(Number(b.dataset.bucket));
    });
  $("trendChart").addEventListener("keydown", (e) => {
    const b = e.target.closest("[data-bucket]");
    if (!b) return;
    const index = Number(b.dataset.bucket),
      next =
        e.key === "ArrowRight"
          ? Math.min(trendBuckets.length - 1, index + 1)
          : e.key === "ArrowLeft"
            ? Math.max(0, index - 1)
            : null;
    if (next !== null) {
      e.preventDefault();
      $("trendChart").querySelector(`[data-bucket="${next}"]`).focus();
    }
  });
  $("trendSelection").onclick = (e) => {
    const button = e.target.closest("[data-trend-operations]");
    if (!button) return;
    const d = trendBuckets[Number(button.dataset.trendOperations)];
    showOperations(
      shortRange(d),
      d.expenses,
      activeCategory || "Все категории",
    );
  };
  let trendWidth = 0;
  new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    if (width > 0 && width !== trendWidth) {
      trendWidth = width;
      if (trendDays.length && !$("panel-analytics").hidden)
        drawTrend(trendDays);
    }
  }).observe($("trendChart"));
  for (const id of [
    "analysisMode",
    "analysisDate",
    "analysisFrom",
    "analysisTo",
    "analysisCategory",
    "heatmapMode",
  ])
    $(id).addEventListener("change", draw);
  const filters = $("analysisFilters");
  document.addEventListener("pointerdown", (e) => {
    if (
      filters.open &&
      !filters.contains(e.target) &&
      !e.target.closest("dialog")
    )
      filters.open = false;
  });
  filters.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !filters.open) return;
    e.preventDefault();
    filters.open = false;
    filters.querySelector("summary").focus();
  });
  $("analysisMonth").addEventListener("change", () => {
    if (!$("analysisMonth").value) return;
    const month = $("analysisMonth").value;
    const today = todayDate();
    $("analysisDate").value =
      month === today.slice(0, 7) ? today : month + "-01";
    draw();
    $("analysisFilters").open = false;
    queueMicrotask(() => $("analysisFilters").querySelector("summary").focus());
  });
  $("openReport").onclick = () => {
    $("reportMonth").max = todayDate().slice(0, 7);
    const day =
      $("analysisMode").value === "custom"
        ? $("analysisTo").value
        : $("analysisDate").value;
    $("reportMonth").value = (
      day && day <= todayDate() ? day : todayDate()
    ).slice(0, 7);
    syncs.reportMonth();
    drawReport();
    $("reportDialog").showModal();
  };
  $("reportMonth").addEventListener("change", drawReport);
  const previousRender = render;
  render = function () {
    previousRender();
    draw();
    if ($("reportDialog").open) drawReport();
    if ($("analysisDetails").open) renderDetail();
  };
  document.addEventListener("finance-navigation", () => {
    const actions = $("panel-analytics").hidden
      ? quickLaunch
      : $("openReport").parentElement;
    if ($("quickopen").parentElement !== actions)
      actions.append($("quickopen"));
    draw();
  });
})();
