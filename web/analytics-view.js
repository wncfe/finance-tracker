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
  let cachedState,
    data,
    lastMonth = "",
    activeCategory = "",
    detail = null,
    scenarios = [],
    groups = [],
    found = [],
    repeated = [],
    trendDays = [],
    trendBuckets = [],
    selectedBucket = 0,
    selectedDay = "",
    allCategories = false,
    trendComparison = null,
    compareTrend = false,
    trendMode = "daily",
    historicalDays = [],
    paceData = null,
    pacePoint = null;
  const syncs = {};
  for (const id of [
    "analysisMode",
    "trendReference",
    "paceWindow",
    "analysisCategory",
    "heatmapMode",
    "simulationGroup",
    "simulationMode",
  ])
    syncs[id] = attachSelect($(id));
  for (const id of ["analysisDate", "analysisFrom", "analysisTo"])
    syncs[id] = attachPicker($(id), "date", { navigate: true });
  for (const id of ["reportMonth", "simulationMonth"])
    syncs[id] = attachPicker($(id), "month", { navigate: true });
  const compactAnalytics = matchMedia("(max-width: 680px)");
  function syncFilterDisclosure() {
    $("analysisFilters").open = !compactAnalytics.matches;
  }
  compactAnalytics.addEventListener("change", syncFilterDisclosure);
  syncFilterDisclosure();
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
  function currentPeriod() {
    return A.range(
      $("analysisMode").value,
      $("analysisDate").value,
      $("analysisFrom").value,
      $("analysisTo").value,
    );
  }
  function draw() {
    if ($("panel-analytics").hidden || $("dashboard").hidden) return;
    const d = source(),
      today = todayDate(),
      mode = $("analysisMode").value;
    if (lastMonth !== selected) {
      if (mode !== "custom")
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
    $("analysisFilterSummary").textContent =
      `${$("analysisMode").selectedOptions[0].textContent} · ${activeCategory || "Все категории"}`;
    for (const id of [
      "analysisMode",
      "analysisDate",
      "analysisFrom",
      "analysisTo",
      "analysisCategory",
      "heatmapMode",
    ])
      syncs[id]();
    $("analysisCustom").hidden = mode !== "custom";
    $("analysisAnchor").hidden = mode === "custom";
    let p;
    try {
      p = currentPeriod();
    } catch (e) {
      $("analysisRange").textContent = e.message;
      $("analysisContent").hidden = true;
      return;
    }
    $("analysisContent").hidden = false;
    if (p.from > today) {
      $("analysisContent").hidden = true;
      $("analysisRange").textContent = `${span(p)} · период ещё не начался`;
      return;
    }
    const effective = { from: p.from, to: p.to > today ? today : p.to },
      summary = A.summarize(d, effective),
      c = A.compare(d, p, mode, today, activeCategory);
    $("analysisRange").textContent =
      `${span(effective)} · ${operationCount(A.summarize(d, effective, activeCategory).count)}${p.from > today ? " · будущий период" : ""}`;
    $("analysisComparison").textContent =
      p.from > today
        ? "Будущие дни не участвуют в расчётах."
        : `Сравниваем ${span(c.current)} (${A.length(c.current)} дн.) с ${span(c.previous)} (${A.length(c.previous)} дн.).${c.partial ? " Сегодняшний день ещё не завершён." : ""}${A.length(c.current) !== A.length(c.previous) ? " Длительность периодов различается — учитывайте среднедневные расходы." : ""}`;
    const days = A.daily(d, effective, today, activeCategory);
    const actual = A.summarize(d, effective, activeCategory);
    $("clearAnalysisCategory").hidden = !activeCategory;
    const average = days.length ? Math.round(actual.total / days.length) : 0;
    const delta = `${c.delta > 0 ? "+" : ""}${money(c.delta)}`;
    const badge =
      c.percent === null
        ? "Ранее расходов не было"
        : `${c.percent > 0 ? "+" : ""}${percent(c.percent)}`;
    $("analysisMetrics").innerHTML =
      `<div class="kpi-main"><span>Расходы за период</span><strong>${money(actual.total)}</strong><div class="kpi-context"><span class="delta-badge ${c.percent !== null && c.delta > 0 ? "delta-up" : ""}">${esc(badge)}</span><span>${c.percent === null ? "Без процентного сравнения" : esc(delta) + " к прошлому периоду"}</span></div></div>` +
      `<div><span>В среднем за день</span><strong>${money(average)}</strong><small>Включая дни без расходов</small></div>` +
      `<div><span>Медиана дня</span><strong>${money(
        Math.round(
          A.quantile(
            days.map((x) => x.amount || 0),
            0.5,
          ),
        ),
      )}</strong><small>Половина дней — не выше этой суммы</small></div>`;
    trendDays = days;
    historicalDays = A.historicalDaily(
      state,
      effective,
      today,
      Number($("paceWindow").value),
      activeCategory,
    );
    trendComparison = c;
    selectedBucket = -1;
    drawTrend(days);
    drawCategories(summary);
    drawHeatmap(p);
    drawPace(effective.to);
    repeated = A.habits(d, effective, today, activeCategory);
    $("habitCount").textContent = repeated.length;
    $("habits").classList.toggle("is-single", repeated.length === 1);
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
    $("habits").innerHTML = repeated.length
      ? repeated
          .map((h, i) => {
            const frequency = new Intl.NumberFormat("ru-RU", {
              maximumFractionDigits: 1,
            }).format((h.count / Math.max(1, h.span)) * 7);
            return `<article class="habit-card"><div class="habit-heading"><span class="habit-icon" aria-hidden="true">↻</span><div><h4>${esc(h.label)}</h4><span>${esc(h.category)}</span></div></div><strong class="habit-total">${money(h.total)}</strong><div class="habit-stats"><div><strong>${h.count}</strong><span>операций</span></div><div><strong>${money(h.average)}</strong><span>средний чек</span></div><div><strong>≈ ${frequency}</strong><span>раз в неделю</span></div></div><p class="habit-observation">${h.dates === h.span ? "Покупки каждый день в этом периоде." : `Покупки в ${h.dates} из ${h.span} дней с историей.`}</p><details><summary>Сравнение и частота</summary><p>Предыдущий равный период: ${operationCount(h.previousCount)} · ${money(h.previousTotal)}.</p><p>${h.weekdays.map((n, j) => `${weekdaysNames[j]}: ${n}`).join(" · ")}</p><p>${h.monthly === null ? "Прогноз на месяц появится после 28 дней истории." : `При той же частоте: ≈ ${money(h.monthly)}/мес. и ${money(h.yearly)}/год.`}</p></details><div class="habit-actions"><button type="button" data-habit="${i}">Операции <span aria-hidden="true">↗</span></button><button type="button" data-sim-habit="${i}">Оценить экономию</button></div></article>`;
          })
          .join("")
      : '<div class="analytics-empty"><strong>Повторяющиеся покупки пока не найдены</strong><p>Нужно минимум три покупки на разных датах с одним магазином или одинаковым описанием и категорией.</p></div>';
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
            return `<article class="observation"><div class="observation-marker" aria-hidden="true">${a.kind === "new" ? "+" : "↗"}</div><div><span class="insight-type">${a.kind === "new" ? "Раньше таких расходов почти не было" : "Расходы выше привычных"}${a.period.to === today ? " · итог ещё может измениться" : ""}</span><button type="button" class="insight-title" data-anomaly="${i}">${esc(label)} <span aria-hidden="true">↗</span></button><strong class="insight-amount">${money(a.amount)}</strong><p>${a.kind === "new" ? "В большинстве похожих периодов расходов не было." : `Обычно в ${a.type === "day" ? "этот день недели" : "такую неделю"} — около ${money(a.median)}.`}</p><details><summary>Почему мы это заметили</summary><p>Сравнили с ${a.samples} ${a.type === "day" ? "такими же днями недели" : "завершёнными неделями"}. ${a.kind === "new" ? "Это новая трата на фоне истории, а не обязательно необычный расход." : "Сумма заметно выше привычного диапазона. Покупки могут объяснить разницу."} Обычная сумма — медиана: половина прошлых значений не выше неё.</p></details></div></article>`;
          })
          .join("") +
        (coverage.checked < coverage.total
          ? `<p class="panel-caption">${coverageText}</p>`
          : "")
      : `<div class="analytics-empty"><span class="empty-symbol" aria-hidden="true">${coverage.checked ? "✓" : "⋯"}</span><strong>${coverage.checked ? "Заметных отклонений не нашли" : "Пока мало истории для выводов"}</strong><p>${coverage.checked === coverage.total && coverage.checked ? "В днях и неделях, которые удалось сравнить, расходы в привычном диапазоне." : coverageText}</p></div>`;
  }
  function drawTrend(days) {
    if (!days.length) {
      $("trendChart").innerHTML =
        '<p class="analytics-empty">За этот период нет данных</p>';
      $("trendSelection").innerHTML = "";
      $("trendTable").innerHTML = "";
      return;
    }
    const focusIndex = document.activeElement?.dataset.bucket;
    const tooltipWasVisible = $("trendTooltip") && !$("trendTooltip").hidden;
    const size = Math.max(1, Math.ceil(days.length / 90));
    const priorDays = trendComparison
      ? A.daily(source(), trendComparison.previous, todayDate(), activeCategory)
      : [];
    const previousAvailable = Boolean(
      source().first &&
      trendComparison &&
      source().first <= trendComparison.previous.to,
    );
    const usingHistory = $("trendReference").value === "historical";
    const cumulativeMode = trendMode === "cumulative";
    const canCompare = usingHistory
      ? cumulativeMode
        ? historicalDays.length > 0 &&
          historicalDays.every((d) => d.amount !== null)
        : historicalDays.some((d) => d.amount !== null)
      : previousAvailable;
    $("toggleTrendComparison").disabled = !canCompare;
    $("toggleTrendComparison").textContent =
      compareTrend && canCompare ? "Скрыть ориентир" : "Показать ориентир";
    $("toggleTrendComparison").setAttribute(
      "aria-pressed",
      String(compareTrend && canCompare),
    );
    const comparing = compareTrend && canCompare;
    $("priorChartKey").hidden = !comparing;
    const empty = !days.some((d) => d.amount) && !comparing;
    $("trendChart").hidden = empty;
    $("trendSelection").hidden = empty;
    $("trendEmpty").hidden = !empty;
    const matchedDays = trendComparison
      ? Math.min(A.length(trendComparison.current), priorDays.length)
      : 0;
    const countByDate = (p) => {
      const counts = new Map();
      for (const e of A.operations(source(), p, activeCategory))
        counts.set(e.date, (counts.get(e.date) || 0) + 1);
      return counts;
    };
    const currentCounts = countByDate({
      from: days[0].date,
      to: days.at(-1).date,
    });
    const priorCounts =
      comparing && !usingHistory
        ? countByDate(trendComparison.previous)
        : new Map();
    const expenses = A.operations(
      source(),
      { from: days[0].date, to: days.at(-1).date },
      activeCategory,
    );
    trendBuckets = [];
    for (let i = 0; i < days.length; i += size) {
      const group = days.slice(i, i + size);
      const from = group[0].date,
        to = group.at(-1).date;
      const categorySums = new Map();
      for (const e of expenses)
        if (e.date >= from && e.date <= to)
          categorySums.set(
            e.category,
            (categorySums.get(e.category) || 0) + e.amount,
          );
      const topCategory = [...categorySums].sort((a, b) => b[1] - a[1])[0];
      const historical = historicalDays.slice(i, i + group.length);
      trendBuckets.push({
        from,
        to,
        topCategory,
        reference:
          comparing &&
          usingHistory &&
          historical.every((d) => d.amount !== null)
            ? {
                rawAmount: historical.reduce((n, d) => n + d.amount, 0),
                amount: Math.round(
                  historical.reduce((n, d) => n + d.amount, 0),
                ),
                count: Math.min(...historical.map((d) => d.count)),
              }
            : null,
        amount: group.reduce((sum, d) => sum + (d.amount || 0), 0),
        count: group.reduce((n, d) => n + (currentCounts.get(d.date) || 0), 0),
        prior:
          comparing && !usingHistory && i + group.length <= matchedDays
            ? {
                from: priorDays[i].date,
                to: priorDays[i + group.length - 1].date,
                amount: priorDays
                  .slice(i, i + group.length)
                  .reduce((n, d) => n + (d.amount || 0), 0),
                count: priorDays
                  .slice(i, i + group.length)
                  .reduce((n, d) => n + (priorCounts.get(d.date) || 0), 0),
              }
            : null,
      });
    }
    let actualRunning = 0,
      priorRunning = 0,
      referenceRunning = 0,
      referenceValid = true,
      priorValid = true;
    for (const b of trendBuckets) {
      actualRunning += b.amount;
      b.plotAmount = cumulativeMode ? actualRunning : b.amount;
      priorValid = priorValid && !!b.prior;
      if (b.prior) {
        priorRunning += b.prior.amount;
        b.prior.plotAmount =
          cumulativeMode && priorValid
            ? priorRunning
            : cumulativeMode
              ? null
              : b.prior.amount;
      }
      referenceValid = referenceValid && !!b.reference;
      if (b.reference) {
        referenceRunning += b.reference.rawAmount;
        b.reference.plotAmount =
          cumulativeMode && referenceValid
            ? Math.round(referenceRunning)
            : cumulativeMode
              ? null
              : b.reference.amount;
      }
    }
    const baseMessage = usingHistory
      ? "Пунктир — среднее по закрытым месяцам для тех же дней месяца"
      : `Линия — предыдущий период: ${span(trendComparison.previous)}`;
    const counts = historicalDays.filter((d) => d.count).map((d) => d.count),
      minCount = counts.length ? Math.min(...counts) : 0;
    $("trendComparisonNote").textContent = !canCompare
      ? usingHistory
        ? cumulativeMode
          ? "Для накопленного ориентира нужна история для всего выбранного периода. Факт доступен без сравнения."
          : "Для исторического ориентира нужны подходящие закрытые месяцы. Факт доступен без сравнения."
        : "За прошлый период ещё нет истории для сравнения."
      : comparing
        ? `${baseMessage}.${usingHistory ? ` База: ${minCount}–${Math.max(...counts)} мес.${minCount < 3 ? " Предварительно." : ""}` : " По порядку дней; дни без пары не сравниваем."}${cumulativeMode ? " Значения накоплены с начала выбранного периода." : size > 1 ? ` Один столбец — до ${size} дней.` : ""}`
        : "";
    const max = Math.max(
      100,
      ...trendBuckets.flatMap((d) => [
        d.plotAmount,
        d.prior?.plotAmount || 0,
        d.reference?.plotAmount || 0,
      ]),
    );
    const ceiling =
      Math.ceil(max / 10 ** Math.floor(Math.log10(max))) *
      10 ** Math.floor(Math.log10(max));
    const width = Math.max(220, $("trendChart").clientWidth),
      left = width < 400 ? 46 : 58,
      right = 8,
      height = 188,
      top = 12,
      bottom = top + height;
    const plotWidth = width - left - right,
      step = plotWidth / trendBuckets.length;
    const compactMoney = (n) =>
      new Intl.NumberFormat("ru-RU", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n / 100) + " ₽";
    const priorPath = trendBuckets
      .map((d, i) =>
        (d.prior?.plotAmount ?? d.reference?.plotAmount) != null
          ? `${i === 0 || (trendBuckets[i - 1].prior?.plotAmount ?? trendBuckets[i - 1].reference?.plotAmount) == null ? "M" : "L"}${left + (i + 0.5) * step},${bottom - (height * (d.prior?.plotAmount ?? d.reference.plotAmount)) / ceiling}`
          : "",
      )
      .join(" ");
    const actualPath =
      `M${left},${bottom} ` +
      trendBuckets
        .map(
          (d, i) =>
            `L${left + (i + 0.5) * step},${bottom - (height * d.plotAmount) / ceiling}`,
        )
        .join(" ");
    $("trendChart").innerHTML =
      `<div class="trend-plot"><svg width="${width}" height="232" viewBox="0 0 ${width} 232" role="img" aria-label="${cumulativeMode ? "Накопленные расходы" : "Ежедневные расходы"}; сравнительный слой в тех же единицах.">${[
        0, 1, 2, 3,
      ]
        .map((i) => {
          const y = top + (height * i) / 3;
          return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="chart-gridline"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${compactMoney((ceiling * (3 - i)) / 3)}</text>`;
        })
        .join(
          "",
        )}${cumulativeMode ? `<path class="trend-cumulative" d="${actualPath}"/>` : trendBuckets.map((d, i) => `<rect class="trend-bar" data-bar="${i}" x="${left + i * step + step * 0.13}" y="${bottom - Math.max(2, (height * d.amount) / ceiling)}" width="${Math.max(1, step * 0.74)}" height="${d.amount ? Math.max(2, (height * d.amount) / ceiling) : 0}" rx="${Math.min(4, step * 0.15)}"/>`).join("")}${comparing ? `<path d="${cumulativeMode ? `M${left},${bottom} ` : ""}${priorPath}" class="chart-prior ${usingHistory ? "historical-reference" : ""}"/>` : ""}<text x="${left}" y="225">${fmt(days[0].date).slice(0, 5)}</text>${days.length > 5 ? `<text x="${left + plotWidth / 2}" y="225" text-anchor="middle">${fmt(days[Math.floor(days.length / 2)].date).slice(0, 5)}</text>` : ""}<text x="${width - right}" y="225" text-anchor="end">${fmt(days.at(-1).date).slice(0, 5)}</text></svg><div class="trend-hitareas">${trendBuckets.map((d, i) => `<button type="button" data-bucket="${i}" aria-label="${span(d)}: ${money(d.amount)}, ${operationCount(d.count)}${d.reference ? `; обычно ${money(d.reference.amount)}` : ""}" aria-pressed="false"></button>`).join("")}</div><div id="trendTooltip" class="trend-tooltip" role="tooltip" hidden></div></div>`;
    const hitareas = $("trendChart").querySelector(".trend-hitareas");
    Object.assign(hitareas.style, {
      left: `${left}px`,
      right: `${right}px`,
      top: `${top}px`,
      height: `${height}px`,
    });
    if (selectedBucket < 0 || selectedBucket >= trendBuckets.length)
      selectedBucket = trendBuckets.length - 1;
    selectBucket(selectedBucket);
    if (focusIndex !== undefined) {
      $("trendChart")
        .querySelector(`[data-bucket="${focusIndex}"]`)
        ?.focus({ preventScroll: true });
      if (!tooltipWasVisible) $("trendTooltip").hidden = true;
    }
    $("trendTable").innerHTML =
      '<div class="daily-table">' +
      days
        .map(
          (d) =>
            `<button type="button" data-day="${d.date}"><span>${fmt(d.date)}${d.partial ? " · сегодня" : ""}</span><strong>${money(d.amount || 0)}</strong></button>`,
        )
        .join("") +
      "</div>";
  }
  function selectBucket(index, tooltip = false, commit = true) {
    const d = trendBuckets[index];
    if (!d) return;
    if (commit) selectedBucket = index;
    $("trendChart")
      .querySelectorAll("[data-bucket]")
      .forEach((b) => {
        const active = Number(b.dataset.bucket) === selectedBucket;
        b.setAttribute("aria-pressed", String(active));
        b.tabIndex = active ? 0 : -1;
        if (Number(b.dataset.bucket) === index && tooltip)
          b.setAttribute("aria-describedby", "trendTooltip");
        else b.removeAttribute("aria-describedby");
      });
    $("trendChart")
      .querySelectorAll("[data-bar]")
      .forEach((b) =>
        b.classList.toggle("is-active", Number(b.dataset.bar) === index),
      );
    $("trendSelection").innerHTML =
      `<div><span>${d.from === d.to ? fmt(d.from) : span(d)}${d.to === todayDate() ? " · сегодня" : ""}</span><strong>${money(d.amount)} <small>· ${operationCount(d.count)}</small></strong></div><button type="button" id="openTrendOperations">Операции <span aria-hidden="true">↗</span></button>`;
    if (
      compareTrend &&
      $("trendReference").value === "previous" &&
      $("toggleTrendComparison").getAttribute("aria-pressed") === "true"
    ) {
      const comparison = document.createElement("div");
      comparison.className = "selected-comparison";
      comparison.innerHTML = d.prior
        ? `<span>Ранее: ${d.prior.from === d.prior.to ? fmt(d.prior.from) : span(d.prior)}</span><strong>${money(d.prior.amount)}</strong><button type="button" id="openPriorOperations">Прошлые операции ↗</button>`
        : "<span>Для этих дней нет пары в прошлом периоде.</span>";
      $("trendSelection").append(comparison);
    }
    if (d.reference && d.reference.plotAmount !== null)
      $("trendSelection").insertAdjacentHTML(
        "beforeend",
        `<div class="historical-selection"><span>${cumulativeModeLabel()} ориентир: ${money(d.reference.plotAmount)} · ${d.reference.count} мес.${d.reference.count < 3 ? " · предварительно" : ""}</span><strong>${signedMoney(d.plotAmount - d.reference.plotAmount)} к ориентиру</strong></div>`,
      );
    if (trendMode === "cumulative")
      $("trendSelection")
        .querySelector("div")
        .insertAdjacentHTML(
          "beforeend",
          `<span class="trend-top-category">С начала периода: ${money(d.plotAmount)}</span>`,
        );
    if (d.topCategory)
      $("trendSelection")
        .querySelector("div")
        .insertAdjacentHTML(
          "beforeend",
          `<span class="trend-top-category">Больше всего: ${esc(d.topCategory[0])} · ${money(d.topCategory[1])}</span>`,
        );
    const tip = $("trendTooltip");
    tip.hidden = !tooltip;
    if (tooltip) {
      tip.textContent = `${d.from === d.to ? fmt(d.from) : span(d)} · ${money(d.amount)} · ${operationCount(d.count)}${trendMode === "cumulative" ? `; накоплено ${money(d.plotAmount)}` : ""}${d.reference && d.reference.plotAmount !== null ? `; ориентир ${money(d.reference.plotAmount)}, разница ${signedMoney(d.plotAmount - d.reference.plotAmount)}` : ""}${d.topCategory ? `; больше всего: ${d.topCategory[0]}` : ""}${d.prior ? `; ранее ${d.prior.from === d.prior.to ? fmt(d.prior.from) : span(d.prior)}: ${money(d.prior.amount)}` : ""}`;
      const chartWidth = $("trendChart").clientWidth;
      const tipWidth = Math.min(180, chartWidth * 0.75);
      tip.style.left = `${Math.max(0, Math.min(chartWidth - tipWidth, (chartWidth * (index + 0.5)) / trendBuckets.length - tipWidth / 2))}px`;
    }
  }
  const signedMoney = (n) =>
    `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;
  const cumulativeModeLabel = () =>
    trendMode === "cumulative" ? "Накопленный" : "Исторический";
  $("trendReference").addEventListener("change", () => {
    compareTrend = false;
    drawTrend(trendDays);
  });
  document.querySelectorAll("[data-trend-mode]").forEach(
    (button) =>
      (button.onclick = () => {
        trendMode = button.dataset.trendMode;
        document
          .querySelectorAll("[data-trend-mode]")
          .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
        drawTrend(trendDays);
      }),
  );
  function applyFillWidths(container) {
    container.querySelectorAll("[data-fill]").forEach((el) => {
      el.style.width = `${Number(el.dataset.fill)}%`;
    });
  }
  function drawCategories(summary) {
    $("categoryCount").textContent = summary.categories.length;
    $("categoryChart").innerHTML =
      `<p class="category-context">Все категории · <strong>${money(summary.total)}</strong></p>`;
    $("showAllCategories").hidden = summary.categories.length <= 5;
    $("showAllCategories").setAttribute("aria-expanded", String(allCategories));
    $("showAllCategories").textContent = allCategories
      ? "Свернуть список ↑"
      : `Все категории (${summary.categories.length}) ↓`;
    $("analysisLegend").innerHTML = summary.total
      ? summary.categories
          .filter(
            (c, i) => allCategories || i < 5 || c.category === activeCategory,
          )
          .map(
            (c) =>
              `<button type="button" class="chart-legend category-row" data-chart-category="${esc(c.category)}" aria-pressed="${activeCategory === c.category}"><span class="category-row-title"><span>${esc(c.category)}</span><strong>${money(c.amount)}</strong></span><span class="category-bar-track"><span data-fill="${(c.amount / summary.total) * 100}"></span></span><small>${percent((c.amount / summary.total) * 100)} от всех расходов</small></button>`,
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
    $("paceContext").textContent =
      `${new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(A.date(r.period.from))} · с 1-го по ${fmt(asOf)} · ${activeCategory || "все категории"}. По внесённым расходам; это сравнение с историей, не прогноз.${asOf === todayDate() ? " Сегодняшний день ещё не завершён." : ""}`;
    $("paceHeadline").innerHTML = n
      ? `<span class="pace-status ${n < 3 ? "is-preliminary" : ""}">${n < 3 ? "Предварительно" : "Исторический ориентир"} · ${n} ${plural(n, ["месяц", "месяца", "месяцев"])}</span><p>${r.delta < 0 ? "Тратишь меньше обычного" : r.delta > 0 ? "Тратишь больше обычного" : "Расходы совпадают с ориентиром"}</p><strong class="pace-amount ${r.delta > 0 ? "pace-above" : ""}">${r.delta ? "на " + money(Math.abs(r.delta)) : money(0)}</strong>`
      : `<span class="pace-status">Без исторического сравнения</span><p>Твои расходы с начала месяца</p><strong class="pace-amount">${money(r.actualTotal)}</strong><p class="panel-caption">Пока нет подходящих закрытых месяцев. Показываем реальные расходы; историческая линия появится, когда будет база для сравнения.</p>`;
    $("paceTotals").innerHTML =
      `<div><strong>${money(r.actualTotal)}</strong><span>Сейчас · по ${fmt(asOf)}</span></div><div><strong>${n ? money(r.expectedTotal) : "—"}</strong><span>${n ? `Обычно к ${r.day}-му числу · ${n} мес.` : "Истории для среднего пока нет"}</span></div>`;
    const paceRows = r.categories.map(
      (c, i) =>
        `<button type="button" class="pace-category" data-pace-category="${i}"><span><strong>${esc(c.category)}</strong><small>Обычно ${money(c.expected)} · за те же ${r.day} дн.</small></span><span><strong>${money(c.actual)}</strong><small class="pace-difference ${c.delta > 0 ? "is-above" : c.delta === 0 ? "is-flat" : ""}">${signedMoney(c.delta || 0)}</small></span></button>`,
    );
    $("paceCategories").innerHTML = n
      ? paceRows.length
        ? paceRows.slice(0, 3).join("") +
          (paceRows.length > 3
            ? `<details class="pace-more"><summary>Ещё ${paceRows.length - 3} ${plural(paceRows.length - 3, ["категория", "категории", "категорий"])}</summary>${paceRows.slice(3).join("")}</details>`
            : "")
        : '<p class="analytics-empty">В обеих частях месяца расходов нет.</p>'
      : '<div class="analytics-empty"><strong>Расшифровка появится вместе с историей</strong><p>Сравним категории за одинаковую часть месяца и покажем, что изменилось сильнее всего.</p></div>';
    $("paceMethod").innerHTML =
      `<p>Берём ${r.history.window} предыдущих календарных месяцев. В базу входят только месяцы со всеми закрытыми неделями и историей с первого дня. Это признак подведённых итогов, но приложение не может проверить, все ли покупки были записаны. Месяц начала учёта с первой записью после 1-го числа исключаем.</p><p>Один–два подходящих месяца — предварительный ориентир; от трёх — обычное сравнение. Для ${r.day}-го числа используются только месяцы, где есть такой день. Одна и та же база используется для всей линии и категорий. Линия заканчивается на самом коротком месяце этой базы: несуществующие дни не заменяем нулями.</p><p>${n ? `В базе: ${r.history.accepted.map((m) => m.month).join(", ")}.` : "Подходящих месяцев пока нет."} ${r.history.excluded.length ? `Исключены: ${r.history.excluded.map((m) => `${m.month} — ${m.reason.toLowerCase()}`).join("; ")}.` : ""}</p><p>Среднее считаем по фактически внесённым операциям. Расшифровка относится к тем же ${r.day} дням; округление категорий до копейки согласовано с общей суммой. Снижение относительно истории не означает гарантированную экономию.</p>`;
    pacePoint = r.day;
    drawPaceChart();
  }
  function drawPaceChart() {
    const r = paceData;
    if (!r) return;
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
      `<div class="pace-chart-key"><span><i></i>Факт</span>${r.count ? '<span><i class="pace-key-reference"></i>Историческое среднее</span>' : ""}</div><div class="pace-plot"><svg width="${width}" height="213" viewBox="0 0 ${width} 213" role="img" aria-label="Накопленные расходы с нуля: ${money(r.actualTotal)}${r.count ? `; историческое среднее к той же дате ${money(r.expectedTotal)}` : "; исторических данных пока нет"}. Обе линии на одной шкале."><defs><linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#79b5a2" stop-opacity=".2"/><stop offset="100%" stop-color="#79b5a2" stop-opacity="0"/></linearGradient></defs><line x1="${left}" x2="${width - right}" y1="${bottom}" y2="${bottom}" class="chart-gridline"/>${r.count ? `<path d="${line(r.expected)}" class="pace-reference"/>` : ""}<path d="${actualPath} L${x(r.day)},${bottom} L${left},${bottom} Z" fill="url(#paceFill)"/><path d="${actualPath}" class="pace-actual"/><circle class="pace-endpoint" cx="${x(r.day)}" cy="${y(actualEnd.amount)}" r="5"/><line id="paceCrosshair" x1="${x(r.day)}" x2="${x(r.day)}" y1="${top}" y2="${bottom}"/><text x="${left}" y="204">Начало</text>${r.day < totalDays && r.day > 3 ? `<text x="${x(r.day)}" y="204" text-anchor="middle">${r.day}</text>` : ""}<text x="${width - right}" y="204" text-anchor="end">${totalDays}</text></svg><div class="pace-hitareas">${r.actual
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
    $("paceSelection").innerHTML =
      `<span>${fmt(p.date)} · накоплено <strong>${money(p.amount)}</strong>${r.expected[day] ? ` · обычно ${money(r.expected[day].amount)} · разница ${signedMoney(p.amount - r.expected[day].amount)}` : ""}</span><button id="openPaceDay" type="button">Операции дня ↗</button>`;
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
    if (b) selectPacePoint(Number(b.dataset.paceDay));
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
    $("analysisDetailsBody").innerHTML =
      `<p>${esc(detail.explanation)}</p><p>Всего: ${money(expenses.reduce((s, e) => s + e.amount, 0))}</p>` +
      entries(expenses);
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
  function simulationGroups() {
    scenarios = [];
    const month = $("simulationMonth").value;
    if (!month) return;
    const p = A.range("month", month + "-01"),
      summary = A.summarize(source(), p);
    groups = summary.categories
      .map((c) => ({ kind: "category", key: c.category, label: c.category }))
      .concat(
        A.habits(source(), p, todayDate()).map((h) => ({
          kind: "habit",
          key: h.key,
          label: `Привычка: ${h.label} · ${h.category}`,
        })),
      );
    $("simulationGroup").innerHTML = groups
      .map((g, i) => `<option value="${i}">${esc(g.label)}</option>`)
      .join("");
    syncs.simulationGroup();
    simulationResult();
  }
  function simulationResult() {
    $("simulationScenarios").innerHTML = scenarios
      .map(
        (s, i) =>
          `<p>${esc(s.label)}: ${s.mode === "percent" ? s.value + "%" : money(s.value)} <button type="button" data-remove-scenario="${i}" aria-label="Удалить сценарий ${esc(s.label)}">×</button></p>`,
      )
      .join("");
    try {
      const r = A.simulate(
        source(),
        $("simulationMonth").value,
        scenarios,
        todayDate(),
      );
      $("simulationResult").textContent =
        `Потенциальная экономия: ${money(r.monthly)}/мес. и ${money(r.yearly)}/год при повторении такого месяца. База: ${money(r.base)}.`;
    } catch (e) {
      $("simulationResult").textContent = e.message;
    }
  }
  function openSimulation(habit) {
    const previous = A.shift(todayDate().slice(0, 7) + "-01", -1).slice(0, 7);
    $("simulationMonth").max = previous;
    $("simulationMonth").value =
      selected < todayDate().slice(0, 7) ? selected : previous;
    syncs.simulationMonth();
    simulationGroups();
    const choice = groups.findIndex((g) =>
      habit
        ? g.kind === "habit" && g.key === habit.key
        : g.kind === "category" && g.key === activeCategory,
    );
    if (choice >= 0) $("simulationGroup").value = String(choice);
    syncs.simulationGroup();
    $("simulatorDialog").showModal();
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
    const sim = e.target.closest("[data-sim-habit]");
    if (sim) openSimulation(repeated[Number(sim.dataset.simHabit)]);
    const remove = e.target.closest("[data-remove-scenario]");
    if (remove) {
      scenarios.splice(Number(remove.dataset.removeScenario), 1);
      simulationResult();
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
    if (b) selectBucket(Number(b.dataset.bucket), true, false);
  });
  $("trendChart").addEventListener("focusin", (e) => {
    const b = e.target.closest("[data-bucket]");
    if (b) selectBucket(Number(b.dataset.bucket), true);
  });
  $("trendChart").addEventListener("pointerleave", () => {
    selectBucket(selectedBucket);
  });
  $("trendChart").addEventListener("focusout", () => {
    if ($("trendTooltip")) $("trendTooltip").hidden = true;
  });
  $("trendChart").addEventListener("click", (e) => {
    const b = e.target.closest("[data-bucket]");
    if (b) {
      selectBucket(Number(b.dataset.bucket), true);
      const d = trendBuckets[Number(b.dataset.bucket)];
      showOperations(
        d.from === d.to ? fmt(d.from) : span(d),
        A.operations(source(), d, activeCategory),
        activeCategory || "Все категории",
      );
    }
  });
  $("trendChart").addEventListener("keydown", (e) => {
    const b = e.target.closest("[data-bucket]");
    if (!b) return;
    if (e.key === "Escape") {
      $("trendTooltip").hidden = true;
      return;
    }
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
  $("toggleTrendComparison").onclick = () => {
    compareTrend = !compareTrend;
    drawTrend(trendDays);
  };
  $("trendSelection").onclick = (e) => {
    if (!e.target.closest("#openTrendOperations, #openPriorOperations")) return;
    const bucket = trendBuckets[selectedBucket];
    const d = e.target.closest("#openPriorOperations") ? bucket?.prior : bucket;
    if (d)
      showOperations(
        d.from === d.to ? fmt(d.from) : span(d),
        A.operations(source(), d, activeCategory),
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
  $("openReport").onclick = () => {
    $("reportMonth").max = todayDate().slice(0, 7);
    $("reportMonth").value =
      selected > todayDate().slice(0, 7) ? todayDate().slice(0, 7) : selected;
    syncs.reportMonth();
    drawReport();
    $("reportDialog").showModal();
  };
  $("reportMonth").addEventListener("change", drawReport);
  $("openSimulator").onclick = () => openSimulation();
  $("simulationMonth").addEventListener("change", simulationGroups);
  $("simulationForm").onsubmit = (e) => {
    e.preventDefault();
    const g = groups[Number($("simulationGroup").value)];
    if (!g) return;
    const mode = $("simulationMode").value;
    scenarios.push({
      ...g,
      mode,
      value:
        mode === "amount"
          ? Math.round(Number($("simulationValue").value) * 100)
          : Number($("simulationValue").value),
    });
    simulationResult();
  };
  const previousRender = render;
  render = function () {
    previousRender();
    draw();
    if ($("reportDialog").open) drawReport();
    if ($("analysisDetails").open) renderDetail();
    if ($("simulatorDialog").open) simulationResult();
  };
  document.addEventListener("finance-navigation", draw);
})();
