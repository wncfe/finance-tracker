"use strict";
const $ = (id) => document.getElementById(id),
  baseCats = [
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
  ],
  iconNames = [
    "burger",
    "utensils",
    "coffee",
    "bus",
    "bus",
    "car",
    "house",
    "heart-pulse",
    "shopping-bag",
    "shirt",
    "sparkles",
    "dumbbell",
    "baby",
    "gift",
    "book",
    "phone",
    "monitor",
    "plane",
    "clapperboard",
    "ellipsis",
    "shopping-basket",
    "coffee",
  ];
let cats = [...baseCats];
const categoryColors = [
  "#ce7044", "#ae674d", "#a76b39", "#567fa0", "#477694", "#5571a2",
  "#427a64", "#a75666", "#8461a3", "#775798", "#a85b88", "#42766e",
  "#a06658", "#9063a9", "#8a7844", "#526d8b", "#615faa", "#35818a",
  "#b45d86", "#537787", "#56844e", "#895e3f",
];
const customCategoryIcons = [
  "wallet", "sparkles", "shopping-bag", "house", "gift", "coffee",
  "book", "monitor", "shirt", "burger", "car", "plane", "phone",
  "heart-pulse", "dumbbell", "baby", "clapperboard", "utensils",
];
const categoryIndex = (category) => cats.indexOf(category);
function customCategoryIndex(category) {
  let hash = 0;
  for (const char of category)
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash;
}
const categoryIcon = (category) => {
  const index = categoryIndex(category);
  return index >= 0 && index < iconNames.length
    ? iconNames[index]
    : customCategoryIcons[customCategoryIndex(category) % customCategoryIcons.length];
};
const categoryColor = (category) => {
  const index = categoryIndex(category);
  return index >= 0 && index < categoryColors.length
    ? categoryColors[index]
    : categoryColors[customCategoryIndex(category) % categoryColors.length];
};
const icon = (name) =>
  `<img class="svgicon" src="/icons/${name}.svg" alt="" aria-hidden="true">`;
const money = (n) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: n % 100 ? 2 : 0,
  }).format(n / 100);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let serverToday = ExpenseAnalytics.todayAt();
const todayDate = () => serverToday;
let selected = serverToday.slice(0, 7),
  state = { months: {} },
  revision = 0,
  week = 0,
  busy = false,
  accountLogin = "";
function categoryOptions() {
  return CategoryUtils.rank(cats, state);
}
function refreshCategories() {
  cats = [
    ...baseCats,
    ...(state.userCategories || []).map((item) => item.name),
  ];
}
function merchantDetails(id) {
  return id
    ? MerchantDictionary.all(state.merchants || [], true).find(
        (merchant) => merchant.id === id,
      )
    : null;
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").hidden = true), 6000);
}
async function api(path, data) {
  const r = await fetch("/api/" + path, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await r.json();
  if (result.today) serverToday = result.today;
  if (!r.ok) {
    if (r.status === 401) {
      $("sessionLoading").hidden = true;
      $("auth").hidden = false;
      $("dashboard").hidden = true;
      $("logout").hidden = true;
      if ($("weekdialog").open) $("weekdialog").close();
      if ($("quickdialog").open) $("quickdialog").close();
      if ($("categoryEditor").open) $("categoryEditor").close();
      for (const id of [
        "expenseDetails",
        "historyRemainderDialog",
        "analysisDetails",
        "reportDialog",
      ])
        if ($(id).open) $(id).close();
    }
    const error = Error(result.error);
    error.status = r.status;
    throw error;
  }
  return result;
}
function calendar(key) {
  const [y, m] = key.split("-").map(Number),
    end = new Date(y, m, 0).getDate(),
    ws = [];
  for (let start = 1; start <= end;) {
    let stop = Math.min(
      end,
      start + 6 - ((new Date(y, m - 1, start).getDay() + 6) % 7),
    );
    ws.push({
      start,
      end: stop,
      days: stop - start + 1,
      limit: 0,
      closed: false,
    });
    start = stop + 1;
  }
  if (ws[0].days <= 2) {
    const first = ws.shift();
    ws[0].start = first.start;
    ws[0].days += first.days;
  }
  if (ws.at(-1).days <= 2) {
    const last = ws.pop();
    ws.at(-1).end = last.end;
    ws.at(-1).days += last.days;
  }
  return ws;
}
function current() {
  return (
    state.months[selected] || {
      budget: 0,
      weeks: calendar(selected),
      expenses: [],
    }
  );
}
const spent = (m, i) =>
  m.expenses
    .filter((e) => i === undefined || e.week === i)
    .reduce((s, e) => s + e.amount, 0);
function expenseDate(value, today, yesterday) {
  if (value === today) return "Сегодня";
  if (value === yesterday) return "Вчера";
  return ExpenseAnalytics.date(value)
    .toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
      ...(value.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}),
    })
    .replace(" г.", "");
}
function expenseTitle(expense, merchant) {
  return expense.merchantId
    ? merchant || "Магазин"
    : expense.note || expense.category;
}
function sumExpenses(expenses) {
  return expenses.reduce((total, expense) => total + expense.amount, 0);
}
function renderEntries(container, expenses, heading = "") {
  if (!expenses.length) {
    container.innerHTML = heading + '<p class="muted">Пока нет трат</p>';
    return;
  }
  const today = todayDate(),
    yesterday = ExpenseAnalytics.shift(today, -1);
  const merchants = new Map(
    MerchantDictionary.all(state.merchants, true).map((m) => [m.id, m.name]),
  );
  const groups = new Map();
  for (const expense of expenses) {
    if (!groups.has(expense.date)) groups.set(expense.date, []);
    groups.get(expense.date).push(expense);
  }
  const rowsByDay = [...groups.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((day) => {
      const items = groups.get(day),
        total = money(sumExpenses(items));
      const rows = items.map((expense) => {
        const iconName = categoryIcon(expense.category);
        const title = expenseTitle(expense, merchants.get(expense.merchantId));
        return `<button type="button" class="entry" data-expense-id="${esc(expense.id)}" data-month="${esc(day.slice(0, 7))}" aria-haspopup="dialog" aria-controls="expenseDetails">
          <span class="icon" data-icon="${iconName}" data-entry-color="${categoryColor(expense.category)}" aria-hidden="true">${icon(iconName)}</span>
          <span class="description"><span class="expense-title">${esc(title)}</span><small>${esc(expense.category)}</small></span>
          <strong>${money(expense.amount)}</strong>
        </button>`;
      });
      return `<section class="entry-group">
        <h3 class="entry-date"><time datetime="${esc(day)}">${esc(expenseDate(day, today, yesterday))}</time><span class="entry-day-total" aria-label="Траты за день: ${total}">${total}</span></h3>
        ${rows.join("")}
      </section>`;
    })
    .join("");
  container.innerHTML = heading + rowsByDay;
  for (const entryIcon of container.querySelectorAll("[data-entry-color]"))
    entryIcon.style.setProperty("--category-color", entryIcon.dataset.entryColor);
}
function render() {
  refreshCategories();
  const m = current(),
    effective = m.budget,
    total = spent(m);
  $("title").textContent = new Date(selected + "-01T12:00:00")
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
    .replace(" г.", "");
  $("month").value = selected;
  $("balance").textContent = money(effective - total);
  $("total").textContent = money(effective);
  $("spent").textContent = money(total);
  const today = todayDate(),
    currentWeekIndex = selected === today.slice(0, 7)
      ? m.weeks.findIndex((w) => w.start <= Number(today.slice(8)) && w.end >= Number(today.slice(8)))
      : selected < today.slice(0, 7)
        ? m.weeks.length - 1
        : 0,
    safeWeekIndex = Math.max(0, currentWeekIndex),
    currentPeriod = m.weeks[safeWeekIndex],
    weekSpent = spent(m, safeWeekIndex),
    weekLeft = currentPeriod.limit - weekSpent,
    currentWeekStart = `${selected}-${String(currentPeriod.start).padStart(2, "0")}`,
    currentWeekEnd = `${selected}-${String(currentPeriod.end).padStart(2, "0")}`,
    monthDays = new Date(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)), 0).getDate(),
    monthPeriod = { from: `${selected}-01`, to: `${selected}-${String(monthDays).padStart(2, "0")}`, limit: effective, spent: total },
    budgetSource = ExpenseAnalytics.index(state),
    weekSmart = ExpenseAnalytics.smartBudget(budgetSource, { from: currentWeekStart, to: currentWeekEnd, limit: currentPeriod.limit, spent: weekSpent, closed: currentPeriod.closed }, today),
    monthSmart = ExpenseAnalytics.smartBudget(budgetSource, monthPeriod, today);
  $("weekBalance").textContent = money(weekLeft);
  $("weekLimit").textContent = money(currentPeriod.limit);
  $("weekSpent").textContent = money(weekSpent);
  $("weekProgress").style.width = `${currentPeriod.limit ? Math.min(100, Math.max(0, weekSpent / currentPeriod.limit * 100)) : 0}%`;
  $("monthProgress").style.width = `${effective ? Math.min(100, Math.max(0, total / effective * 100)) : 0}%`;
  const setForecast = (id, result) => {
    const el = $(id);
    el.textContent = result.status === "closed" ? "Неделя закрыта — прогноз не рассчитывается" : result.status === "actual" ? "Период завершён" : result.status === "insufficient" ? "Прогноз: недостаточно истории" : `Прогноз остатка: ${money(result.forecast)}`;
    el.classList.toggle("negative", result.status === "forecast" && result.forecast < 0);
  };
  setForecast("weekForecast", weekSmart);
  setForecast("monthForecast", monthSmart);
  $("budget").value = m.budget / 100;
  $("weekcount").textContent =
    `${m.weeks.filter((w) => w.closed).length} из ${m.weeks.length} закрыто` +
    (m.weeks.some((w) => w.days <= 2)
      ? " · Сохранены исторические периоды"
      : "");
  $("weeks").innerHTML = m.weeks
    .map((w, i) => ({ w, i }))
    .map(({ w, i }) => {
      let s = spent(m, i),
        left = w.limit - s;
      const from = `${selected}-${String(w.start).padStart(2, "0")}`,
        to = `${selected}-${String(w.end).padStart(2, "0")}`,
        phase = w.closed ? "Закрыта ✓" : to < today ? "Прошла" : from > today ? "Будущая" : "Текущая";
      const progress = w.limit ? Math.min(100, (s / w.limit) * 100) : s ? 100 : 0;
      return `<button class="week-row ${selected === today.slice(0, 7) && i === safeWeekIndex && !w.closed ? "is-current" : ""} ${w.closed ? "is-closed" : ""}" data-week="${i}"><span class="week-row-date"><strong>Неделя ${i + 1}</strong><small>${w.start}–${w.end} ${new Date(selected + "-01T12:00:00").toLocaleDateString("ru-RU", { month: "short" })} · ${w.days} дн.</small></span><span class="week-row-left"><small>Осталось</small><strong class="${left < 0 ? "negative" : ""}">${money(left)}</strong></span><span class="week-row-spending"><progress max="100" value="${progress}"></progress><small>Потрачено ${money(s)} из ${money(w.limit)}</small></span><span class="badge">${phase}</span></button>`;
    })
    .join("");
  ExpenseHistoryView.render();
}
$("settingsOpen").addEventListener("click", () =>
  window.financeNavigate("budget"),
);
function renderWeek() {
  const m = current(),
    w = m.weeks[week],
    firstOpen = m.weeks.findIndex((item) => !item.closed),
    blocked = !w.closed && week > firstOpen;
  $("weektitle").textContent =
    `Неделя ${week + 1}${w.closed ? " · закрыта" : ""}`;
  $("weekdates").textContent = `${w.start}–${w.end} / ${selected}`;
  $("weekeditable").hidden = w.closed;
  $("limit").value = w.limit / 100;
  $("closeform").hidden = blocked;
  $("weekCloseAction").setAttribute("aria-disabled", String(blocked));
  if (blocked) $("weekCloseSection").open = false;
  $("closenote").hidden = !blocked;
  $("closenote").textContent = blocked
    ? `Сначала закройте неделю ${firstOpen + 1}.`
    : "";
}
async function mutate(action) {
  if (busy) return false;
  busy = true;
  document.dispatchEvent(new CustomEvent("finance-saving", { detail: true }));
  const buttonStates = new Map(
    [...document.querySelectorAll("button")].map((b) => [b, b.disabled]),
  );
  buttonStates.forEach((_, b) => (b.disabled = true));
  $("saveStatus").textContent = "Сохраняем…";
  try {
    const { result, recoveredOther } = await sendPendingOperation(
      api,
      revision,
      {
        month: selected,
        week,
        ...action,
      },
      sessionStorage,
      "pending-operation:" + accountLogin,
    );
    state = result.state;
    revision = result.revision;
    render();
    if ($("weekdialog").open) renderWeek();
    $("saveStatus").textContent = "Все изменения сохранены на сервере";
    if (recoveredOther) {
      toast(
        "Предыдущее изменение подтверждено. Проверьте данные и повторите новое действие.",
      );
      return false;
    }
    return true;
  } catch (e) {
    if (e.uncertain || e.status === 409) {
      try {
        const latest = await api("state");
        state = latest.state;
        revision = latest.revision;
        render();
        if ($("weekdialog").open) renderWeek();
      } catch {}
    }
    const message = e.uncertain
      ? "Не удалось подтвердить результат операции. Проверьте список трат перед повтором."
      : e.message;
    toast(message);
    $("saveStatus").textContent = e.uncertain
      ? "Результат сохранения требует проверки"
      : "Изменение не сохранено";
    return false;
  } finally {
    busy = false;
    document.dispatchEvent(
      new CustomEvent("finance-saving", { detail: false }),
    );
    buttonStates.forEach((disabled, b) => {
      if (b.isConnected) b.disabled = disabled;
    });
  }
}
async function load() {
  const loading = $("dashboard").hidden && $("auth").hidden;
  if (loading) {
    $("sessionLoading").hidden = false;
    $("sessionLoading").setAttribute("aria-busy", "true");
    $("sessionStatus").textContent = "Загружаем ваш бюджет…";
    $("sessionRetry").hidden = true;
  }
  try {
    await MerchantDictionary.loadDefaults();
    const result = await api("state");
    accountLogin = result.login;
    state = result.state;
    revision = result.revision;
    $("sessionLoading").hidden = true;
    $("auth").hidden = true;
    $("dashboard").hidden = false;
    $("logout").hidden = false;
    render();
  } catch (e) {
    if (loading && e.status !== 401) {
      $("sessionStatus").textContent =
        "Не удалось загрузить бюджет. Проверьте подключение и попробуйте снова.";
      $("sessionRetry").hidden = false;
    }
    if (e.message !== "Войдите в аккаунт") toast(e.message);
  } finally {
    $("sessionLoading").setAttribute("aria-busy", "false");
  }
}
$("sessionRetry").onclick = () => load();
async function auth(register) {
  if (busy) return;
  const form = $("authform");
  if (!form.reportValidity()) return;
  busy = true;
  try {
    await api(register ? "register" : "login", {
      login: form.elements.login.value,
      password: form.elements.password.value,
      invite: form.elements.invite.value,
    });
    form.elements.password.value = "";
    await load();
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}
$("authform").onsubmit = (e) => {
  e.preventDefault();
  auth(false);
};
$("register").onclick = () => auth(true);
$("logout").onclick = async () => {
  try {
    await api("logout", {});
    state = { months: {} };
    await load();
  } catch (e) {
    toast(e.message);
  }
};
function select(key) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$|^2100-(0[1-9]|1[0-2])$/.test(key)) return;
  selected = key;
  ExpenseHistoryView.reset();
  render();
}
$("month").onchange = (e) => select(e.target.value);
for (const [id, n] of [
  ["prev", -1],
  ["next", 1],
])
  $(id).onclick = () => {
    const d = new Date(selected + "-01T12:00:00");
    d.setMonth(d.getMonth() + n);
    select(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
$("weeks").onclick = (e) => {
  const b = e.target.closest("[data-week]");
  if (!b) return;
  week = Number(b.dataset.week);
  for (const section of $("weekeditable").querySelectorAll("details"))
    section.open = false;
  renderWeek();
  $("weekdialog").showModal();
};
$("dismiss").onclick = () => $("weekdialog").close();
$("weekCloseAction").onclick = (event) => {
  if ($("closeform").hidden) event.preventDefault();
};
const cents = (v) => Math.round(Number(v) * 100);
for (const [form, type, input] of [
  ["budgetform", "budget", "budget"],
  ["limitform", "limit", "limit"],
])
  $(form).onsubmit = (e) => {
    e.preventDefault();
    mutate({ type, amount: cents($(input).value) });
  };
$("closeform").onsubmit = async (e) => {
  e.preventDefault();
  if (await mutate({ type: "close", mode: $("closemode").value }))
    toast("Неделя закрыта");
};

ExpenseHistoryView.init();
load();

fetch("/api/config")
  .then((r) => (r.ok ? r.json() : {}))
  .then((c) => {
    $("inviteLabel").hidden = !c.invitationRequired;
  })
  .catch(() => {});

// Refresh date on wake and across Yekaterinburg midnight, using the server clock.
async function refreshToday() {
  if (document.hidden || $("dashboard").hidden || busy) return;
  const before = todayDate();
  try {
    await api("config");
    if (before !== todayDate()) {
      render();
      document.dispatchEvent(new Event("finance-date-change"));
    }
  } catch {
    /* Retry on the next wake/tick; writes still validate on the server. */
  }
}
document.addEventListener("visibilitychange", refreshToday);
window.addEventListener("focus", refreshToday);
setInterval(refreshToday, 60000);
