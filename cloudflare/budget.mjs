import merchantDefaults from "../web/merchants.json" with { type: "json" };

export const categories = [
  "Фастфуд",
  "Рестораны",
  "Кофейни",
  "Транспорт",
  "Общественный транспорт",
  "Такси",
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
  if (result[0].days <= 2) {
    const first = result.shift();
    result[0].start = first.start;
    result[0].days += first.days;
  }
  if (result.at(-1).days <= 2) {
    const last = result.pop();
    result.at(-1).end = last.end;
    result.at(-1).days += last.days;
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
    weeks: weeks(key).map((w) => ({ ...w, limit: 0, closed: false })),
    expenses: [],
  });
}
export const spent = (m, i) =>
  m.expenses
    .filter((e) => i === undefined || e.week === i)
    .reduce((s, e) => s + e.amount, 0);
const accounted = (w) => w.settled ?? w.limit;
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
  const available = m.budget;
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

export function todayAt(instant = new Date()) {
  return new Date(instant.getTime() + 5 * 3600000).toISOString().slice(0, 10);
}
export function apply(original, action, today = todayAt()) {
  if (action.type === "transfer")
    throw Error("Переносы между месяцами больше не поддерживаются");
  if (action.type === "merchant_save") {
    const item = action.merchant;
    check(
      item && typeof item === "object" && !Array.isArray(item),
      "Некорректный магазин",
    );
    check(
      Object.keys(item).every((key) =>
        ["id", "name", "aliases", "category", "hidden"].includes(key),
      ),
      "Некорректный магазин",
    );
    check(
      typeof item.id === "string" &&
        (merchantDefaults.some((m) => m.id === item.id) ||
          /^c-[0-9a-f]{32}$/.test(item.id)),
      "Некорректный идентификатор магазина",
    );
    check(
      typeof item.name === "string" &&
        item.name.trim().length > 0 &&
        item.name.trim().length <= 100,
      "Название: от 1 до 100 символов",
    );
    check(
      Array.isArray(item.aliases) &&
        item.aliases.length <= 30 &&
        item.aliases.every(
          (alias) =>
            typeof alias === "string" &&
            alias.trim().length > 0 &&
            alias.trim().length <= 100,
        ),
      "Некорректные варианты названия",
    );
    check(
      item.category == null ||
        item.category === "" ||
        categories.includes(item.category),
      "Неизвестная категория магазина",
    );
    check(typeof item.hidden === "boolean", "Некорректный статус магазина");
    const state = structuredClone(original);
    const merchants = (state.merchants || []).filter((m) => m.id !== item.id);
    merchants.push({
      id: item.id,
      name: item.name.trim(),
      aliases: item.aliases.map((s) => s.trim()),
      ...(item.category ? { category: item.category } : {}),
      hidden: item.hidden,
    });
    merchants.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    state.merchants = merchants;
    return state;
  }
  if (action.category === "Продукты")
    action = { ...action, category: "Супермаркеты" };
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
      const week = ensure(result, month).weeks.findIndex(
        (w) => w.start <= day && day <= w.end,
      );
      result = apply(result, { ...item, type: "expense", month, week }, today);
    }
    return result;
  }
  if (action.type === "expense_update") {
    check(Number.isInteger(action.week), "Некорректная неделя");
    check(
      Object.keys(action).every((k) =>
        [
          "type",
          "month",
          "week",
          "id",
          "amount",
          "date",
          "category",
          "merchantId",
        ].includes(k),
      ),
      "Неизвестные поля изменения расхода",
    );
    const state = structuredClone(original),
      source = state.months[action.month];
    const expense = source?.expenses.find(
      (e) => e.id === action.id && e.week === action.week,
    );
    check(expense, "Расход не найден");
    const updated = { ...expense };
    for (const field of ["amount", "date", "category", "merchantId"])
      if (Object.hasOwn(action, field)) updated[field] = action[field];
    amount(updated.amount, true);
    check(categories.includes(updated.category), "Неизвестная категория");
    check(
      typeof updated.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(updated.date),
      "Некорректная дата",
    );
    const key = updated.date.slice(0, 7),
      day = Number(updated.date.slice(8));
    const target = ensure(state, key),
      index = target.weeks.findIndex((w) => w.start <= day && day <= w.end);
    check(index >= 0, "Некорректная дата");
    validDate(updated.date, key, target.weeks[index]);
    check(updated.date <= today, "Расход не может быть в будущем");
    const financial =
      updated.amount !== expense.amount || updated.date !== expense.date;
    if (financial) {
      check(
        !source.weeks[expense.week].closed,
        "В закрытой неделе нельзя менять сумму и дату",
      );
      check(
        !target.weeks[index].closed,
        "Нельзя перенести расход в закрытую неделю",
      );
    }
    const merchantId = updated.merchantId;
    check(
      merchantId == null || typeof merchantId === "string",
      "Неизвестный магазин",
    );
    if (merchantId && merchantId !== expense.merchantId) {
      const merchant =
        (state.merchants || []).find((m) => m.id === merchantId) ||
        merchantDefaults.find((m) => m.id === merchantId);
      check(merchant && !merchant.hidden, "Неизвестный или скрытый магазин");
    }
    if (!merchantId) delete updated.merchantId;
    updated.week = index;
    if (source === target)
      source.expenses[source.expenses.indexOf(expense)] = updated;
    else {
      source.expenses.splice(source.expenses.indexOf(expense), 1);
      target.expenses.push(updated);
    }
    return state;
  }
  const state = structuredClone(original),
    key = action.month,
    m = ensure(state, key),
    effective = m.budget,
    type = action.type;
  const open = () => m.weeks.flatMap((w, i) => (w.closed ? [] : [i])),
    closedTotal = () =>
      m.weeks.filter((w) => w.closed).reduce((s, w) => s + accounted(w), 0);
  if (type === "budget") {
    m.budget = amount(action.amount);
    redistribute(m);
  } else {
    const i = action.week;
    check(
      Number.isInteger(i) && i >= 0 && i < m.weeks.length,
      "Некорректная неделя",
    );
    const w = m.weeks[i];
    if (type === "recategorize") {
      check(
        Object.keys(action).every((k) =>
          ["type", "month", "week", "id", "category"].includes(k),
        ),
        "Можно изменить только категорию",
      );
      check(categories.includes(action.category), "Неизвестная категория");
      const expense = m.expenses.find(
        (e) => e.id === action.id && e.week === i,
      );
      check(expense, "Расход не найден");
      expense.category = action.category;
      return state;
    }
    check(!w.closed, "Неделя закрыта");
    if (type === "expense") {
      validDate(action.date, key, w);
      check(action.date <= today, "Расход не может быть в будущем");
      check(categories.includes(action.category), "Неизвестная категория");
      const note = String(action.note || "").trim();
      check(note.length <= 200, "Описание слишком длинное");
      const merchantId = action.merchantId;
      if (
        merchantId !== undefined &&
        merchantId !== null &&
        merchantId !== ""
      ) {
        check(typeof merchantId === "string", "Неизвестный магазин");
        const merchant =
          (state.merchants || []).find((m) => m.id === merchantId) ||
          merchantDefaults.find((m) => m.id === merchantId);
        check(merchant && !merchant.hidden, "Неизвестный или скрытый магазин");
      }
      m.expenses.push({
        id: crypto.randomUUID().replaceAll("-", ""),
        week: i,
        amount: amount(action.amount, true),
        date: action.date,
        category: action.category,
        note,
        ...(merchantId ? { merchantId } : {}),
      });
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
