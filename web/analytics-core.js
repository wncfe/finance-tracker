(function (root) {
  "use strict";
  const DAY = 86400000;
  const iso = (d) => d.toISOString().slice(0, 10);
  const date = (s) => new Date(s + "T12:00:00Z");
  const shift = (s, n) => iso(new Date(date(s).getTime() + n * DAY));
  const length = (p) =>
    Math.max(0, Math.round((date(p.to) - date(p.from)) / DAY) + 1);
  const weekday = (s) => (date(s).getUTCDay() + 6) % 7;
  const todayAt = (d = new Date()) => iso(new Date(d.getTime() + 5 * 3600000));
  function valid(s) {
    return (
      typeof s === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !isNaN(date(s)) &&
      iso(date(s)) === s &&
      s >= "2000-01-01" &&
      s <= "2100-12-31"
    );
  }
  function range(mode, anchor, from, to) {
    if (mode === "custom") {
      if (!valid(from) || !valid(to) || from > to)
        throw Error("Выберите корректный период: начало не позже окончания");
      return { from, to };
    }
    if (!valid(anchor)) throw Error("Выберите дату периода");
    let start = anchor,
      end = anchor;
    if (mode === "week") {
      start = shift(anchor, -weekday(anchor));
      end = shift(start, 6);
    } else if (mode === "month") {
      start = anchor.slice(0, 7) + "-01";
      const d = date(start);
      d.setUTCMonth(d.getUTCMonth() + 1, 0);
      end = iso(d);
    } else if (mode !== "day") throw Error("Неизвестный период");
    return {
      from: start < "2000-01-01" ? "2000-01-01" : start,
      to: end > "2100-12-31" ? "2100-12-31" : end,
    };
  }
  function index(state) {
    const merchants = new Map(
      (
        root.MerchantDictionary?.all(state.merchants || [], true) ||
        state.merchants ||
        []
      ).map((m) => [m.id, m.name]),
    );
    const expenses = Object.values(state.months)
      .flatMap((m) => m.expenses)
      .map((e) =>
        e.merchantId
          ? { ...e, merchantName: merchants.get(e.merchantId) || e.note }
          : e,
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    return { expenses, first: expenses[0]?.date || null };
  }
  const rows = (source) => source.expenses || index(source).expenses;
  function operations(source, p, category = "") {
    return rows(source).filter(
      (e) =>
        e.date >= p.from &&
        e.date <= p.to &&
        (!category || e.category === category),
    );
  }
  function summarize(source, p, category = "") {
    const sums = new Map();
    let total = 0,
      count = 0;
    for (const e of operations(source, p, category)) {
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
  function daily(source, p, today, category = "") {
    const sums = new Map();
    for (const e of operations(source, p, category))
      sums.set(e.date, (sums.get(e.date) || 0) + e.amount);
    const result = [];
    for (let d = p.from; d <= p.to; d = shift(d, 1))
      result.push({
        date: d,
        amount: d > today ? null : sums.get(d) || 0,
        partial: d === today,
      });
    return result;
  }
  function quantile(values, q) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b),
      pos = (sorted.length - 1) * q,
      lo = Math.floor(pos);
    return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
  }
  function compare(source, p, mode, today, category = "") {
    let current = { ...p },
      previous;
    const partial = p.from <= today && p.to >= today;
    if (mode === "month") {
      previous = range("month", shift(p.from, -1));
      if (partial) {
        const n = Math.min(
          length({ from: p.from, to: today }),
          length(previous),
        );
        current.to = shift(current.from, n - 1);
        previous.to = shift(previous.from, n - 1);
      }
    } else {
      const n =
        mode === "custom" && partial
          ? length({ from: p.from, to: today })
          : length(p);
      previous = { from: shift(p.from, -n), to: shift(p.from, -1) };
      if (partial) {
        current.to = today;
        previous.to = shift(previous.from, length(current) - 1);
      }
    }
    current.to = current.to > today ? today : current.to;
    const summary = summarize(source, current, category),
      prior = summarize(source, previous, category);
    const days = daily(source, current, today, category),
      delta = summary.total - prior.total;
    return {
      current,
      previous,
      summary,
      prior,
      days,
      delta,
      percent: prior.total ? (delta / prior.total) * 100 : null,
      average: days.length ? Math.round(summary.total / days.length) : 0,
      median: Math.round(
        quantile(
          days.map((d) => d.amount),
          0.5,
        ),
      ),
      partial,
    };
  }
  const normalize = (s) =>
    (
      root.ExpenseParser?.normalize(s) ??
      String(s).toLowerCase().replace(/ё/g, "е")
    )
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const habitKey = (e) =>
    e.merchantId
      ? JSON.stringify(["merchant", e.merchantId])
      : JSON.stringify(["description", e.category, normalize(e.note || "")]);
  function habits(source, p, today, category = "") {
    const groups = new Map(),
      first = source.first ?? rows(source)[0]?.date;
    const start = first && first > p.from ? first : p.from,
      end = p.to > today ? today : p.to;
    const span = length({ from: start, to: end });
    for (const e of operations(source, { from: start, to: end }, category)) {
      if (!normalize(e.note || "")) continue;
      const key = habitKey(e);
      if (!groups.has(key))
        groups.set(key, {
          key,
          label: e.merchantName || e.note,
          merchantId: e.merchantId || null,
          category: e.category,
          total: 0,
          count: 0,
          dates: new Set(),
          weekdays: Array(7).fill(0),
          expenses: [],
        });
      const g = groups.get(key);
      if (g.category !== e.category) g.category = "Разные категории";
      g.total += e.amount;
      g.count++;
      g.dates.add(e.date);
      g.weekdays[weekday(e.date)]++;
      g.expenses.push(e);
    }
    const prior = { from: shift(p.from, -length(p)), to: shift(p.from, -1) };
    return [...groups.values()]
      .filter((g) => g.count >= 3 && g.dates.size >= 3)
      .map((g) => ({
        ...g,
        previousCount: operations(source, prior, category).filter(
          (e) => habitKey(e) === g.key,
        ).length,
        previousTotal: operations(source, prior, category)
          .filter((e) => habitKey(e) === g.key)
          .reduce((s, e) => s + e.amount, 0),
        dates: g.dates.size,
        average: Math.round(g.total / g.count),
        monthly: span >= 28 ? Math.round((g.total / span) * 30.4375) : null,
        yearly: span >= 28 ? Math.round((g.total / span) * 365.25) : null,
        span,
      }))
      .sort((a, b) => b.total - a.total);
  }
  function forecast(source, month, week, today) {
    const m = source.months?.[month];
    if (!m) return null;
    const w = m.weeks[week],
      p = {
        from: month + "-" + String(w.start).padStart(2, "0"),
        to: month + "-" + String(w.end).padStart(2, "0"),
      };
    const data = index(source),
      actual = summarize(data, p).total;
    if (w.closed || p.to < today)
      return { status: "actual", total: actual, left: w.limit - actual };
    if (p.from > today) return null;
    const completed = daily(
      data,
      { from: p.from, to: shift(today, -1) },
      today,
    ).filter((d) => data.first && d.date >= data.first);
    const n = completed.length,
      pace = n ? completed.reduce((s, d) => s + d.amount, 0) / n : 0;
    const history = daily(
      data,
      { from: shift(p.from, -56), to: shift(p.from, -1) },
      today,
    ).filter((d) => data.first && d.date >= data.first);
    const samples = Array.from({ length: 7 }, (_, i) =>
      history.filter((d) => weekday(d.date) === i),
    );
    const remaining = daily(data, { from: today, to: p.to }, today);
    const enough = remaining.every((d) => samples[weekday(d.date)].length >= 4);
    if (!enough && n < 2)
      return { status: "insufficient", observations: history.length };
    const weight = n / (n + 3);
    let total = completed.reduce((s, d) => s + d.amount, 0);
    for (const d of remaining) {
      const sample = samples[weekday(d.date)];
      const historical = sample.length
        ? sample.reduce((s, x) => s + x.amount, 0) / sample.length
        : 0;
      const expected = enough
        ? weight * pace + (1 - weight) * historical
        : pace;
      total += d.date === today ? Math.max(d.amount || 0, expected) : expected;
    }
    total = Math.max(actual, Math.round(total));
    return {
      status: "forecast",
      total,
      left: w.limit - total,
      method: enough
        ? "История по дням недели и текущий темп"
        : "Темп завершённых дней недели",
      observations: history.length,
      completedDays: n,
    };
  }
  const thresholds = Object.freeze({
    weeks: 12,
    minSamples: 8,
    growth: 0.5,
    day: 50000,
    category: 50000,
    week: 150000,
  });
  function deviation(value, samples, kind) {
    if (samples.length < thresholds.minSamples) return null;
    const median = quantile(samples, 0.5),
      q1 = quantile(samples, 0.25),
      q3 = quantile(samples, 0.75);
    if (median === 0)
      return value >= thresholds[kind]
        ? { kind: "new", median, samples: samples.length }
        : null;
    return value > q3 + 1.5 * (q3 - q1) &&
      value >= median * (1 + thresholds.growth) &&
      value - median >= thresholds[kind]
      ? { kind: "anomaly", median: Math.round(median), samples: samples.length }
      : null;
  }
  function anomalies(source, p, today, category = "") {
    const first = source.first ?? rows(source)[0]?.date;
    if (!first) return [];
    const end = p.to > today ? today : p.to,
      result = [];
    const add = (target, kind, label, cat = "") => {
      const samples = [];
      for (let n = 1; n <= thresholds.weeks; n++) {
        const prior = {
          from: shift(target.from, -7 * n),
          to: shift(target.to, -7 * n),
        };
        if (prior.from >= first && prior.to < today)
          samples.push(summarize(source, prior, cat).total);
      }
      const amount = summarize(source, target, cat).total,
        finding = deviation(amount, samples, kind);
      if (finding)
        result.push({
          ...finding,
          type: kind,
          label,
          category: cat,
          period: target,
          amount,
          expenses: operations(source, target, cat).sort(
            (a, b) => b.amount - a.amount,
          ),
        });
    };
    for (let d = p.from; d <= end; d = shift(d, 1))
      add({ from: d, to: d }, "day", d, category);
    for (
      let d = shift(p.from, (7 - weekday(p.from)) % 7);
      shift(d, 6) <= end && shift(d, 6) < today;
      d = shift(d, 7)
    ) {
      const target = { from: d, to: shift(d, 6) };
      add(target, "week", d + " — " + target.to, category);
      const cats = category
        ? [category]
        : summarize(source, target).categories.map((c) => c.category);
      for (const cat of cats)
        add(target, "category", cat + ": " + d + " — " + target.to, cat);
    }
    return result.sort((a, b) => b.amount - b.median - (a.amount - a.median));
  }
  function simulate(source, month, scenarios, today) {
    if (!/^\d{4}-\d{2}$/.test(month) || month >= today.slice(0, 7))
      throw Error("Выберите завершённый месяц");
    const p = range("month", month + "-01"),
      expenses = operations(source, p);
    const rules = scenarios.map((s) => {
      if (!Number.isFinite(s.value) || s.value < 0)
        throw Error("Укажите неотрицательное сокращение");
      if (
        !["percent", "amount"].includes(s.mode) ||
        !["category", "habit"].includes(s.kind)
      )
        throw Error("Некорректный сценарий");
      const match = (e) =>
        s.kind === "category" ? e.category === s.key : habitKey(e) === s.key;
      const base = expenses.filter(match).reduce((a, e) => a + e.amount, 0);
      const ratio =
        s.mode === "percent"
          ? Math.min(100, s.value) / 100
          : base
            ? Math.min(base, s.value) / base
            : 0;
      return { match, ratio };
    });
    const monthly = Math.round(
      expenses.reduce(
        (sum, e) =>
          sum +
          e.amount *
            Math.max(0, ...rules.filter((r) => r.match(e)).map((r) => r.ratio)),
        0,
      ),
    );
    return { monthly, yearly: monthly * 12, base: summarize(source, p).total };
  }
  function report(source, month, today) {
    const p = range("month", month + "-01");
    const actualPeriod = { from: p.from, to: p.to > today ? today : p.to };
    const actual = summarize(source, actualPeriod);
    return {
      ...compare(source, p, "month", today),
      actual,
      actualPeriod,
      actualAverage: length(actualPeriod)
        ? Math.round(actual.total / length(actualPeriod))
        : 0,
      month,
      habits: habits(source, p, today),
      anomalies: anomalies(source, p, today),
    };
  }
  const api = {
    iso,
    date,
    shift,
    length,
    weekday,
    todayAt,
    valid,
    range,
    index,
    operations,
    summarize,
    daily,
    quantile,
    compare,
    normalize,
    habitKey,
    habits,
    forecast,
    thresholds,
    deviation,
    anomalies,
    simulate,
    report,
  };
  root.ExpenseAnalytics = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
