(function () {
  "use strict";
  const A = ExpenseAnalytics,
    fmt = (s) => s.split("-").reverse().join("."),
    span = (p) => `${fmt(p.from)} — ${fmt(p.to)}`;
  const colors = [
    "#79b5a2",
    "#ecc27f",
    "#8eb2e0",
    "#dca0b9",
    "#b0a2d9",
    "#abc681",
    "#e5a58c",
    "#87c5c9",
  ];
  let previousChartKey = "",
    cachedState,
    data,
    lastMonth = "",
    activeCategory = "",
    detail = null,
    scenarios = [],
    groups = [],
    found = [],
    repeated = [];
  const syncs = {};
  for (const id of [
    "analysisMode",
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
    return `${c.delta > 0 ? "+" : ""}${money(c.delta)}${c.percent === null ? " · ранее расходов не было" : ` (${c.percent > 0 ? "+" : ""}${c.percent.toFixed(1)}%)`}`;
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
      `${span(effective)} · ${A.summarize(d, effective, activeCategory).count} трат${p.from > today ? " · будущий период" : ""}`;
    $("analysisComparison").textContent =
      p.from > today
        ? "Будущие дни не участвуют в расчётах."
        : `Сравниваем ${span(c.current)} (${A.length(c.current)} дн.) с ${span(c.previous)} (${A.length(c.previous)} дн.).${c.partial ? " Сегодняшний день ещё не завершён." : ""}${A.length(c.current) !== A.length(c.previous) ? " Длительность периодов различается — учитывайте среднедневные расходы." : ""}`;
    const days = A.daily(d, effective, today, activeCategory);
    const actual = A.summarize(d, effective, activeCategory);
    $("analysisMetrics").innerHTML =
      metric("Расходы", money(actual.total)) +
      metric("Изменение", change(c)) +
      metric(
        "В среднем за день",
        money(days.length ? Math.round(actual.total / days.length) : 0),
      ) +
      metric(
        "Медиана дня",
        money(
          Math.round(
            A.quantile(
              days.map((x) => x.amount || 0),
              0.5,
            ),
          ),
        ),
      );
    drawTrend(days);
    drawCategories(summary);
    drawHeatmap(p);
    repeated = A.habits(d, effective, today, activeCategory);
    const weekdays = Array(7).fill(0);
    for (const e of A.operations(d, effective, activeCategory))
      weekdays[A.weekday(e.date)] += e.amount;
    const weekdaySummary =
      '<p class="muted">Расходы по дням недели: ' +
      weekdays
        .map(
          (sum, i) =>
            ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][i] + ": " + money(sum),
        )
        .join(" · ") +
      "</p>";
    $("habits").innerHTML = repeated.length
      ? repeated
          .map(
            (h, i) =>
              `<article class="insight"><button type="button" data-habit="${i}">${esc(h.label)}</button><p>${esc(h.category)} · ${h.count} покупок на ${h.dates} датах · ${money(h.total)}</p><small>За предыдущий равный по длине период: ${h.previousCount} покупок, ${money(h.previousTotal)}. Средняя покупка сейчас ${money(h.average)}. ${h.weekdays
                .map((n, i) =>
                  n
                    ? `${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][i]}: ${n}`
                    : "",
                )
                .filter(Boolean)
                .join(
                  " · ",
                )}</small>${h.monthly === null ? '<p class="muted">Для экстраполяции нужно 28 дней истории.</p>' : `<p>При той же частоте: ≈ ${money(h.monthly)}/мес., ${money(h.yearly)}/год.</p>`}<button type="button" data-sim-habit="${i}">Оценить экономию</button></article>`,
          )
          .join("")
      : '<p class="muted">Повторы появятся после трёх покупок на трёх разных датах.</p>';
    $("habits").insertAdjacentHTML("afterbegin", weekdaySummary);
    found = A.anomalies(d, effective, today, activeCategory);
    $("anomalies").innerHTML = found.length
      ? found
          .map(
            (a, i) =>
              `<article class="insight"><button type="button" data-anomaly="${i}">${esc(a.label)}</button><p>${a.kind === "new" ? "Появились расходы на фоне нулевой исторической базы" : "Выше обычного"}: ${money(a.amount)}.</p><small>Медиана сравнения: ${money(a.median)}; ${a.samples} наблюдений. ${a.type === "day" ? "Сравнение с тем же днём недели." : "Сравнение с завершёнными неделями."}</small></article>`,
          )
          .join("")
      : '<p class="muted">Значимых отклонений не найдено или пока недостаточно истории.</p>';
  }
  function drawTrend(days) {
    if (!days.length) {
      $("trendChart").innerHTML =
        '<p class="muted">За этот период нет данных</p>';
      $("trendTable").innerHTML = "";
      return;
    }
    // Aggregate long ranges into at most 90 adjacent buckets; the table retains exact daily values.
    const size = Math.max(1, Math.ceil(days.length / 90)),
      buckets = [];
    for (let i = 0; i < days.length; i += size) {
      const group = days.slice(i, i + size);
      buckets.push({
        from: group[0].date,
        to: group.at(-1).date,
        amount: group.reduce((s, d) => s + (d.amount || 0), 0),
      });
    }
    const max = Math.max(1, ...buckets.map((d) => d.amount)),
      width = Math.max(260, $("trendChart").clientWidth),
      height = 180,
      step = width / buckets.length;
    $("trendChart").innerHTML =
      `<svg viewBox="0 0 ${width} ${height + 30}" role="img" aria-label="Динамика расходов. Точные суммы доступны в таблице по дням.">${buckets.map((d, i) => `<rect x="${i * step + 1}" y="${height - (height * d.amount) / max}" width="${Math.max(1, step - 2)}" height="${(height * d.amount) / max}" rx="2" fill="#79b5a2"><title>${span(d)}: ${money(d.amount)}</title></rect>`).join("")}<text x="0" y="${height + 24}">${fmt(days[0].date)}</text><text x="${width}" y="${height + 24}" text-anchor="end">${fmt(days.at(-1).date)}</text></svg>`;
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
  function drawCategories(summary) {
    const chartKey = JSON.stringify(summary);
    if (
      chartKey === previousChartKey &&
      $("categoryChart").querySelector("svg")
    ) {
      $("categoryChart")
        .querySelectorAll("[data-chart-category]")
        .forEach((el) => {
          const active = el.dataset.chartCategory === activeCategory;
          el.setAttribute("opacity", !activeCategory || active ? "1" : "0.38");
          el.classList.toggle("is-selected", active);
        });
      $("analysisLegend")
        .querySelectorAll("[data-chart-category]")
        .forEach((el) =>
          el.setAttribute(
            "aria-pressed",
            String(el.dataset.chartCategory === activeCategory),
          ),
        );
      return;
    }
    previousChartKey = chartKey;
    $("categories").hidden = true;
    if (!summary.total) {
      $("categoryChart").innerHTML =
        '<p class="muted">За этот период нет расходов</p>';
      $("analysisLegend").innerHTML = "";
      return;
    }
    let offset = 0;
    const segments = summary.categories
      .map((c, i) => {
        const share = (c.amount / summary.total) * 100;
        const circle = `<circle class="chart-segment ${activeCategory === c.category ? "is-selected" : ""}" data-chart-category="${esc(c.category)}" cx="100" cy="100" r="72" fill="none" stroke="${colors[i % colors.length]}" stroke-width="20" pathLength="100" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)" opacity="${!activeCategory || activeCategory === c.category ? 1 : 0.38}"><title>${esc(c.category)}: ${money(c.amount)} (${share.toFixed(1)}%)</title></circle>`;
        offset += share;
        return circle;
      })
      .join("");
    $("categoryChart").innerHTML =
      `<svg viewBox="0 0 200 200" role="img" aria-label="Расходы по категориям: ${money(summary.total)}">${segments}<text x="100" y="96" text-anchor="middle" class="chart-caption">Всего</text><text x="100" y="116" text-anchor="middle" class="chart-amount">${money(summary.total)}</text></svg>`;
    $("analysisLegend").innerHTML = summary.categories
      .map(
        (c, i) =>
          `<button type="button" class="chart-legend" data-chart-category="${esc(c.category)}" aria-pressed="${activeCategory === c.category}"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="${colors[i % colors.length]}"/></svg><span>${esc(c.category)}<small>${((c.amount / summary.total) * 100).toFixed(1)}%</small></span><strong>${money(c.amount)}</strong></button>`,
      )
      .join("");
  }
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
      max = Math.max(1, ...all.map((d) => d.amount || 0));
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
                `<button type="button" class="heat-cell heat-${d.amount === null ? "future" : d.amount === 0 ? 0 : Math.min(4, Math.ceil((d.amount / max) * 4))} ${d.partial ? "is-today" : ""}" data-day="${d.date}" ${d.amount === null ? "disabled" : ""} aria-label="${fmt(d.date)}: ${d.amount === null ? "будущий день" : money(d.amount)}${d.partial ? ", день не завершён" : ""}" title="${fmt(d.date)}: ${d.amount === null ? "будущий день" : money(d.amount)}">${Number(d.date.slice(8))}</button>`,
            )
            .join("")}</div></section>`,
      )
      .join("");
  }
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
      entries({ expenses });
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
    if (day)
      showOperations(
        fmt(day.dataset.day),
        A.operations(
          source(),
          { from: day.dataset.day, to: day.dataset.day },
          activeCategory,
        ),
        activeCategory || "Все категории",
      );
    const h = e.target.closest("[data-habit]");
    if (h) {
      const habit = repeated[Number(h.dataset.habit)];
      showOperations(
        habit.label,
        habit.expenses,
        habit.merchantId
          ? "Операции одного магазина или сервиса"
          : "Покупки с одинаковой категорией и нормализованным описанием",
      );
    }
    const a = e.target.closest("[data-anomaly]");
    if (a) {
      const finding = found[Number(a.dataset.anomaly)];
      showOperations(
        finding.label,
        finding.expenses,
        `Медиана: ${money(finding.median)}; ${finding.samples} сопоставимых наблюдений. Расходы объясняют отклонение.`,
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
    }
  });
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
  $("analysisDetailsBody").onclick = deleteExpense;
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
