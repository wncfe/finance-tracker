export const categories = [
  "Продукты",
  "Фастфуд",
  "Рестораны",
  "Кофейни",
  "Транспорт",
  "Дом",
  "Здоровье",
  "Покупки",
  "Одежда и обувь",
  "Красота",
  "Спорт",
  "Дети",
  "Подарки и творчество",
  "Книги и образование",
  "Связь и интернет",
  "Подписки и цифровые сервисы",
  "Путешествия",
  "Развлечения",
  "Другое",
  "Супермаркеты",
  "Кафе",
];
function check(ok, message = "Некорректные данные") {
  if (!ok) throw Error(message);
}
export function amount(n, positive = false) {
  check(
    Number.isSafeInteger(n) && n >= (positive ? 1 : 0) && n <= 1e10,
    "Некорректная сумма",
  );
  return n;
}
export function weeks(key) {
  check(
    typeof key === "string" && /^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(key),
    "Некорректный месяц",
  );
  const [y, m] = key.split("-").map(Number),
    days = new Date(Date.UTC(y, m, 0)).getUTCDate(),
    result = [];
  for (let start = 1; start <= days;) {
    const end = Math.min(
      days,
      start + 6 - ((new Date(Date.UTC(y, m - 1, start)).getUTCDay() + 6) % 7),
    );
    result.push({ start, end, days: end - start + 1 });
    start = end + 1;
  }
  return result;
}
export function allocate(total, weights) {
  check(total >= 0, "Бюджета недостаточно для сохранения закрытых лимитов");
  if (!weights.length) {
    check(total === 0, "Нет открытых недель для перераспределения");
    return [];
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  let used = 0,
    cumulative = 0;
  return weights.map((w) => {
    cumulative += w;
    const target = Math.floor((total * cumulative) / sum),
      value = target - used;
    used = target;
    return value;
  });
}
function rebalance(m, ids, total) {
  allocate(
    total,
    ids.map((i) => m.weeks[i].days),
  ).forEach((n, j) => (m.weeks[ids[j]].limit = n));
}
function ensure(state, key) {
  weeks(key);
  return (state.months[key] ??= {
    budget: 0,
    incoming: 0,
    outgoing: 0,
    weeks: weeks(key).map((w) => ({ ...w, limit: 0, closed: false })),
    expenses: [],
  });
}
export const spent = (m, i) =>
  m.expenses
    .filter((e) => i === undefined || e.week === i)
    .reduce((s, e) => s + e.amount, 0);
const accounted = (w) => w.settled ?? w.limit;
function previous(key) {
  const [y, m] = key.split("-").map(Number),
    d = new Date(Date.UTC(y, m - 1, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function validDate(value, key, w) {
  check(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Некорректная дата",
  );
  const d = new Date(value + "T12:00:00Z");
  check(
    !isNaN(d) &&
      d.toISOString().slice(0, 10) === value &&
      value.slice(0, 7) === key &&
      d.getUTCDate() >= w.start &&
      d.getUTCDate() <= w.end,
    "Дата должна попадать в выбранную неделю",
  );
}
function redistribute(m) {
  const available = m.budget + m.incoming - m.outgoing;
  check(
    !m.outgoing || available >= spent(m),
    "Средства уже перенесены в следующий месяц",
  );
  const ids = m.weeks.flatMap((w, i) => (w.closed ? [] : [i]));
  if (ids.length) {
    const reserved = m.weeks
      .filter((w) => w.closed)
      .reduce((sum, w) => sum + accounted(w), 0);
    rebalance(m, ids, available - reserved);
  } else {
    const reserved = m.weeks
      .slice(0, -1)
      .reduce((sum, w) => sum + accounted(w), 0);
    check(available >= reserved, "Бюджета недостаточно для закрытых недель");
    m.weeks.at(-1).limit = available - reserved;
    delete m.weeks.at(-1).settled;
  }
}

export function apply(original, action) {
  if (action.type === "expenses") {
    check(
      Array.isArray(action.items) &&
        action.items.length > 0 &&
        action.items.length <= 50,
      "Добавьте от 1 до 50 расходов",
    );
    let result = structuredClone(original);
    for (const item of action.items) {
      check(
        item && typeof item === "object" && !Array.isArray(item),
        "Некорректный расход",
      );
      check(
        typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date),
        "Некорректная дата",
      );
      const month = item.date.slice(0, 7),
        day = Number(item.date.slice(8));
      const week = weeks(month).findIndex(
        (w) => w.start <= day && day <= w.end,
      );
      result = apply(result, { ...item, type: "expense", month, week });
    }
    return result;
  }
  const state = structuredClone(original),
    key = action.month,
    m = ensure(state, key),
    effective = m.budget + m.incoming - m.outgoing,
    type = action.type;
  const open = () => m.weeks.flatMap((w, i) => (w.closed ? [] : [i])),
    closedTotal = () =>
      m.weeks.filter((w) => w.closed).reduce((s, w) => s + accounted(w), 0);
  if (type === "budget") {
    m.budget = amount(action.amount);
    redistribute(m);
  } else if (type === "transfer") {
    const source = state.months[previous(key)];
    check(
      source && source.weeks.every((w) => w.closed),
      "Сначала закройте все недели предыдущего месяца",
    );
    const value = amount(action.amount, true);
    check(
      value <=
        source.budget + source.incoming - source.outgoing - spent(source),
      "Недостаточно остатка для переноса",
    );
    source.outgoing += value;
    m.incoming += value;
    redistribute(source);
    redistribute(m);
  } else {
    const i = action.week;
    check(
      Number.isInteger(i) && i >= 0 && i < m.weeks.length,
      "Некорректная неделя",
    );
    const w = m.weeks[i];
    if (type === "reopen") {
      check(w.closed, "Неделя уже открыта");
      for (const future of m.weeks.slice(i)) {
        future.closed = false;
        delete future.settled;
      }
      redistribute(m);
      return state;
    }
    check(!w.closed, "Неделя закрыта");
    if (type === "expense") {
      validDate(action.date, key, w);
      check(categories.includes(action.category), "Неизвестная категория");
      const note = String(action.note || "").trim();
      check(note.length <= 200, "Описание слишком длинное");
      m.expenses.push({
        id: crypto.randomUUID().replaceAll("-", ""),
        week: i,
        amount: amount(action.amount, true),
        date: action.date,
        category: action.category,
        note,
      });
      check(
        !m.outgoing || spent(m) <= effective,
        "Средства уже перенесены в следующий месяц",
      );
    } else if (type === "delete") {
      m.expenses = m.expenses.filter(
        (e) => !(e.id === action.id && e.week === i),
      );
    } else if (type === "limit") {
      const value = amount(action.amount);
      rebalance(
        m,
        open().filter((j) => j !== i),
        effective - closedTotal() - value,
      );
      w.limit = value;
    } else if (type === "close") {
      check(
        m.weeks.slice(0, i).every((w) => w.closed),
        "Сначала закройте предыдущие недели",
      );
      check(
        ["next", "remaining", "month"].includes(action.mode),
        "Выберите способ распределения",
      );
      let ids = open().filter((j) => j > i);
      if (action.mode === "next") ids = ids.slice(0, 1);
      if (ids.length) {
        rebalance(
          m,
          ids,
          ids.reduce((s, j) => s + m.weeks[j].limit, 0) + w.limit - spent(m, i),
        );
        w.settled = spent(m, i);
      }
      w.closed = true;
    } else throw Error("Неизвестное действие");
  }
  return state;
}
