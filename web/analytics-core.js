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
        e.merchantId ? { ...e, merchantName: merchants.get(e.merchantId) } : e,
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
  const descriptionKey = (category, name) =>
    JSON.stringify(["description", category, normalize(name)]);
  const habitKey = (e, merchantId = e.merchantId) =>
    merchantId
      ? JSON.stringify(["merchant", merchantId])
      : descriptionKey(e.category, e.note || "");
  function habitMerchantLookup(expenses, today) {
    const names = new Map();
    for (const e of expenses) {
      if (e.date > today || !e.merchantId || !normalize(e.merchantName || ""))
        continue;
      const key = descriptionKey(e.category, e.merchantName);
      if (!names.has(key))
        names.set(key, { id: e.merchantId, name: e.merchantName });
      else if (names.get(key)?.id !== e.merchantId) names.set(key, null);
    }
    return (e) =>
      e.merchantId
        ? { id: e.merchantId, name: e.merchantName }
        : names.get(descriptionKey(e.category, e.note || ""));
  }
  function habits(source, p, today, category = "") {
    const data = source.expenses ? source : index(source);
    const groups = new Map(),
      first = data.first ?? data.expenses[0]?.date;
    const merchantFor = habitMerchantLookup(data.expenses, today);
    const start = first && first > p.from ? first : p.from,
      end = p.to > today ? today : p.to;
    const span = length({ from: start, to: end });
    for (const e of operations(data, { from: start, to: end }, category)) {
      if (!normalize(e.note || "")) continue;
      const merchant = merchantFor(e);
      const key = habitKey(e, merchant?.id);
      if (!groups.has(key))
        groups.set(key, {
          key,
          label: merchant?.name || e.note,
          merchantId: merchant?.id || null,
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
    const previous = new Map();
    for (const e of operations(data, prior, category)) {
      const key = habitKey(e, merchantFor(e)?.id);
      if (!previous.has(key)) previous.set(key, { count: 0, total: 0 });
      const group = previous.get(key);
      group.count++;
      group.total += e.amount;
    }
    return [...groups.values()]
      .filter((g) => g.count >= 3 && g.dates.size >= 3)
      .map((g) => ({
        ...g,
        previousCount: previous.get(g.key)?.count || 0,
        previousTotal: previous.get(g.key)?.total || 0,
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
    const data = index(source);
    if (w.closed || p.to < today) {
      const actual = summarize(data, p).total;
      return { status: "actual", total: actual, left: w.limit - actual };
    }
    if (p.from > today) return null;
    const actual = summarize(data, { from: p.from, to: today }).total;
    const completed = daily(
      data,
      { from: p.from, to: shift(today, -1) },
      today,
    ).filter((d) => data.first && d.date >= data.first);
    const completedDays = completed.length,
      spent = completed.reduce((sum, d) => sum + d.amount, 0);
    const historyWeeks = 6,
      periodDays = length(p),
      overlapWeeks = Math.ceil(periodDays / 7) - 1;
    const history = daily(
      data,
      {
        from: shift(p.from, -7 * (historyWeeks + overlapWeeks)),
        to: shift(p.from, -1),
      },
      today,
    );
    const elapsed = length({ from: p.from, to: shift(today, -1) }),
      remaining = length({ from: today, to: p.to });
    const sum = (days) => days.reduce((total, d) => total + d.amount, 0);
    const samples = [];
    for (let offset = 0; offset + periodDays <= history.length; offset += 7) {
      if (!data.first || history[offset].date < data.first) continue;
      samples.push({
        elapsed: sum(history.slice(offset, offset + elapsed)),
        remaining: sum(
          history.slice(offset + elapsed, offset + elapsed + remaining),
        ),
        future: sum(
          history.slice(offset + elapsed + 1, offset + elapsed + remaining),
        ),
      });
    }
    const enough = samples.length >= 4;
    if (!enough && completedDays < 2)
      return { status: "insufficient", observations: samples.length };
    const adaptability = enough ? completedDays / (completedDays + 3) : 1;
    const median = (part) =>
      quantile(
        samples.map((sample) => sample[part]),
        0.5,
      );
    const paceAdjustment = completedDays
      ? (spent - (enough ? median("elapsed") : 0)) / completedDays
      : 0;
    const estimate = (part, days) =>
      (enough ? median(part) : 0) + adaptability * paceAdjustment * days;
    const total = Math.round(
      Math.max(
        spent + estimate("remaining", remaining),
        actual + Math.max(0, estimate("future", remaining - 1)),
      ),
    );
    return {
      status: "forecast",
      total,
      left: w.limit - total,
      method: enough
        ? "Медиана расходов за сопоставимые дни прошлых недель"
        : "Темп завершённых дней недели",
      observations: samples.length,
      completedDays,
      adaptability,
    };
  }
  function smartBudget(source, period, today) {
    const remainingDays = daily(source, period, today).filter(
        (d) => d.date >= today && d.date <= period.to,
      ).length,
      left = period.limit - period.spent;
    if (!remainingDays) return { status: "actual", left, perDay: 0, forecast: left };
    const history = daily(
      source,
      { from: shift(today, -28), to: shift(today, -1) },
      shift(today, -1),
    ).filter((d) => d.date >= (source.first || today));
    const sample = history.map((d) => d.amount);
    if (sample.length < 14)
      return { status: "insufficient", left, remainingDays, observations: sample.length };
    const rate = Math.round(quantile(sample, 0.5));
    const forecast = left - rate * remainingDays;
    return {
      status: "forecast",
      left,
      remainingDays,
      perDay: left < 0 ? 0 : Math.floor(left / remainingDays),
      over: Math.max(0, -left),
      forecast,
      dailyMedian: rate,
      observations: sample.length,
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
  function anomalies(source, p, today, category = "", coverage = null) {
    if (coverage) {
      coverage.checked = 0;
      coverage.total = 0;
    }
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
      if (coverage) {
        coverage.total++;
        if (samples.length >= thresholds.minSamples) coverage.checked++;
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
  // Closed weeks are a conservative proxy for a completed ledger, not proof of completeness.
  function historicalMonths(
    state,
    month,
    window = 3,
    requiredDay = 1,
    indexed = null,
  ) {
    if (![3, 6, 12].includes(window))
      throw Error("Выберите 3, 6 или 12 месяцев истории");
    const source = indexed || index(state),
      accepted = [],
      excluded = [];
    for (let i = 1; i <= window; i++) {
      const d = date(month + "-01");
      d.setUTCMonth(d.getUTCMonth() - i);
      const key = iso(d).slice(0, 7);
      if (key < "2000-01") {
        excluded.push({
          month: key,
          reason: "До начала поддерживаемой истории",
        });
        continue;
      }
      const p = range("month", key + "-01"),
        m = state.months[key];
      let reason = "";
      if (!m) reason = "Нет данных";
      else if (!source.first || source.first > p.from)
        reason = "Учёт ещё не начался или начат в середине месяца";
      else if (length(p) < requiredDay)
        reason = `Нет ${requiredDay}-го дня месяца`;
      else {
        let next = 1;
        const closed =
          m.weeks?.length &&
          m.weeks.every((w) => {
            const valid = w.closed && w.start === next && w.end >= w.start;
            next = w.end + 1;
            return valid;
          }) &&
          next === length(p) + 1;
        if (!closed) reason = "Месяц не закрыт полностью";
      }
      if (reason) excluded.push({ month: key, reason });
      else accepted.push({ month: key, period: p, days: length(p) });
    }
    return { accepted, excluded, window };
  }
  function spendingPace(state, month, asOf, today, window = 3, category = "") {
    const p = range("month", month + "-01");
    if (
      !valid(asOf) ||
      !valid(today) ||
      asOf < p.from ||
      asOf > p.to ||
      asOf > today
    )
      throw Error("Выберите прошедшую дату внутри месяца");
    const day = Number(asOf.slice(8)),
      history = historicalMonths(state, month, window, day),
      n = history.accepted.length;
    const source = index(state),
      actualDays = daily(source, { from: p.from, to: asOf }, today, category);
    let cumulative = 0;
    const actual = [
      { day: 0, date: p.from, amount: 0 },
      ...actualDays.map((d) => ({
        day: Number(d.date.slice(8)),
        date: d.date,
        amount: (cumulative += d.amount),
      })),
    ];
    const commonDays = n
      ? Math.min(length(p), ...history.accepted.map((m) => m.days))
      : 0;
    const sums = Array(commonDays + 1).fill(0),
      categorySums = new Map();
    for (const m of history.accepted) {
      const historic = daily(
        source,
        { from: m.period.from, to: shift(m.period.from, commonDays - 1) },
        today,
        category,
      );
      let sum = 0;
      historic.forEach((d, i) => {
        sum += d.amount;
        sums[i + 1] += sum;
      });
      for (const e of operations(
        source,
        { from: m.period.from, to: shift(m.period.from, day - 1) },
        category,
      ))
        categorySums.set(
          e.category,
          (categorySums.get(e.category) || 0) + e.amount,
        );
    }
    const expected = n
      ? sums.map((sum, i) => ({ day: i, amount: Math.round(sum / n) }))
      : [];
    const actualSummary = summarize(
      source,
      { from: p.from, to: asOf },
      category,
    );
    const expectedTotal = n ? expected[day].amount : null;
    // Largest remainders reconcile rounded category means to the rounded total (integer kopecks).
    const averages = [...categorySums].map(([category, sum]) => ({
      category,
      amount: Math.floor(sum / n),
      remainder: sum % n,
    }));
    let remainder = n
      ? expectedTotal - averages.reduce((s, c) => s + c.amount, 0)
      : 0;
    averages.sort(
      (a, b) =>
        b.remainder - a.remainder || a.category.localeCompare(b.category),
    );
    for (const c of averages)
      if (remainder > 0) {
        c.amount++;
        remainder--;
      }
    const names = new Set([
      ...actualSummary.categories.map((c) => c.category),
      ...averages.map((c) => c.category),
    ]);
    const categories = [...names]
      .map((category) => {
        const actual =
          actualSummary.categories.find((c) => c.category === category)
            ?.amount || 0;
        const expected = n
          ? averages.find((c) => c.category === category)?.amount || 0
          : null;
        return {
          category,
          actual,
          expected,
          delta: n ? actual - expected : null,
        };
      })
      .sort(
        (a, b) =>
          Math.abs(b.delta || 0) - Math.abs(a.delta || 0) ||
          b.actual - a.actual ||
          a.category.localeCompare(b.category),
      );
    return {
      month,
      asOf,
      period: p,
      day,
      history,
      count: n,
      status: n === 0 ? "insufficient" : n < 3 ? "preliminary" : "established",
      actual,
      expected,
      actualTotal: actualSummary.total,
      expectedTotal,
      delta: n ? actualSummary.total - expectedTotal : null,
      categories,
      commonDays,
    };
  }
  function historicalDaily(state, p, today, window = 3, category = "") {
    const source = index(state),
      cache = new Map(),
      amounts = new Map();
    for (const e of source.expenses)
      if (!category || e.category === category)
        amounts.set(e.date, (amounts.get(e.date) || 0) + e.amount);
    return daily(source, p, today, category).map((d) => {
      const month = d.date.slice(0, 7),
        day = Number(d.date.slice(8));
      if (!cache.has(month))
        cache.set(
          month,
          historicalMonths(state, month, window, 1, source).accepted,
        );
      const months = cache.get(month).filter((m) => m.days >= day);
      const sum = months.reduce(
        (s, m) => s + (amounts.get(shift(m.period.from, day - 1)) || 0),
        0,
      );
      return {
        date: d.date,
        amount: months.length ? sum / months.length : null,
        count: months.length,
      };
    });
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
    smartBudget,
    thresholds,
    deviation,
    anomalies,
    report,
    historicalMonths,
    spendingPace,
    historicalDaily,
  };
  root.ExpenseAnalytics = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
