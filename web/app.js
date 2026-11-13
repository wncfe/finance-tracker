"use strict";
const $ = (id) => document.getElementById(id),
  cats = [
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
const icon = (name) =>
    `<img class="svgicon" src="/icons/${name}.svg" alt="" aria-hidden="true">`,
  icons = iconNames.map(icon);
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
  category = cats[0],
  busy = false,
  accountLogin = "";
function categoryOptions() {
  return CategoryUtils.rank(cats, state);
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
      $("auth").hidden = false;
      $("dashboard").hidden = true;
      $("logout").hidden = true;
      if ($("weekdialog").open) $("weekdialog").close();
      if ($("quickdialog").open) $("quickdialog").close();
      if ($("categoryEditor").open) $("categoryEditor").close();
      for (const id of ["analysisDetails", "reportDialog", "simulatorDialog"])
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
function expenseDate(value) {
  const date = new Date(value + "T12:00:00");
  return date
    .toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      ...(date.getFullYear() !== new Date().getFullYear()
        ? { year: "numeric" }
        : {}),
    })
    .replace(" г.", "");
}
function entries(m, i, merchantId = "") {
  const list = m.expenses
    .filter((e) => i === undefined || e.week === i)
    .filter(
      (e) =>
        !merchantId ||
        (merchantId === "__none__"
          ? !e.merchantId
          : e.merchantId === merchantId),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return list.length
    ? list
        .map(
          (e) =>
            `<div class="entry"><span class="icon" aria-hidden="true">${icons[cats.indexOf(e.category)] || "•"}</span><div class="description"><span class="expense-title">${esc(e.merchantId ? MerchantDictionary.all(state.merchants, true).find((m) => m.id === e.merchantId)?.name || "Магазин" : e.note || e.category)}</span><small>${esc(e.category)}${e.note && e.merchantId ? ` · ${esc(e.note)}` : ""}<time datetime="${esc(e.date)}">${esc(expenseDate(e.date))}</time></small></div><strong>${money(e.amount)}</strong><button class="expense-more" data-expense-menu="${esc(e.id)}" data-month="${esc(e.date.slice(0, 7))}" aria-label="Действия с расходом ${esc(e.merchantId ? MerchantDictionary.all(state.merchants, true).find((m) => m.id === e.merchantId)?.name || "Магазин" : e.note || e.category)}" aria-haspopup="menu" aria-expanded="false" aria-controls="expenseActions"><span aria-hidden="true">⋯</span></button></div>`,
        )
        .join("")
    : '<p class="muted">Пока нет трат</p>';
}
function render() {
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
  $("budget").value = m.budget / 100;
  $("weekcount").textContent =
    `${m.weeks.filter((w) => w.closed).length} из ${m.weeks.length} закрыто` +
    (m.weeks.some((w) => w.days <= 2) ? " · Сохранены исторические периоды" : "");
  $("weeks").innerHTML = m.weeks
    .map((w, i) => {
      let s = spent(m, i),
        left = w.limit - s;
      return `<button class="week ${w.closed ? "closed" : ""}" data-week="${i}"><div class="weekhead"><div><strong>Неделя ${i + 1}</strong><span class="weekdate">${w.start}–${w.end} · ${w.days} дн.</span></div><span class="badge">${w.closed ? "Закрыта ✓" : "Посмотреть ↗"}</span></div><div class="weeknumbers"><div>Лимит<strong>${money(w.limit)}</strong></div><div>Остаток<strong class="${left < 0 ? "negative" : ""}">${money(left)}</strong></div></div><div class="progress"><progress max="100" value="${w.limit ? Math.min(100, (s / w.limit) * 100) : s ? 100 : 0}"></progress></div><span class="muted">Потрачено ${money(s)}</span>${forecastMarkup(i)}</button>`;
    })
    .join("");
  const filter = $("filter").value;
  $("filter").innerHTML =
    '<option value="">Весь месяц</option>' +
    m.weeks
      .map((w, i) => `<option value="${i}">Неделя ${i + 1}</option>`)
      .join("");
  $("filter").value = filter;
  const merchantFilter = $("historyMerchant").value;
  const usedMerchants = new Set(
    m.expenses.map((e) => e.merchantId).filter(Boolean),
  );
  $("historyMerchant").innerHTML =
    '<option value="">Все магазины</option><option value="__none__">Без магазина</option>' +
    MerchantDictionary.all(state.merchants, true)
      .filter((item) => usedMerchants.has(item.id))
      .map(
        (item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`,
      )
      .join("");
  $("historyMerchant").value = [...$("historyMerchant").options].some(
    (option) => option.value === merchantFilter,
  )
    ? merchantFilter
    : "";
  $("history").innerHTML = entries(
    m,
    filter === "" ? undefined : Number(filter),
    $("historyMerchant").value,
  );
  $("categories").innerHTML =
    cats
      .map((c, i) => {
        let sum = m.expenses
          .filter((e) => e.category === c)
          .reduce((a, e) => a + e.amount, 0);
        return sum
          ? `<div class="categoryrow"><div><span>${icons[i]} ${c}</span><strong>${money(sum)}</strong></div><progress max="${total || 1}" value="${sum}"></progress></div>`
          : "";
      })
      .join("") || '<p class="muted">Категории появятся после первой траты</p>';
}
function forecastMarkup(i, detailed = false) {
  const f = ExpenseAnalytics.forecast(state, selected, i, todayDate());
  if (!f || f.status === "actual") return "";
  if (f.status === "insufficient")
    return '<span class="forecast muted">Прогноз: недостаточно данных</span>';
  return `<span class="forecast ${f.left < 0 ? "negative" : ""}">Ожидаемый остаток: ${money(f.left)}${f.left < 0 ? " · ожидается превышение лимита" : ""}${detailed ? `<small>Прогноз расходов: ${money(f.total)}. ${esc(f.method)}. История: ${f.observations} дней; завершено в неделе: ${f.completedDays}.</small>` : ""}</span>`;
}
function renderWeek() {
  const m = current(),
    w = m.weeks[week];
  $("weektitle").textContent =
    `Неделя ${week + 1}${w.closed ? " · закрыта" : ""}`;
  $("weekdates").textContent = `${w.start}–${w.end} / ${selected}`;
  $("weeksummary").innerHTML =
    `<div>Лимит<strong>${money(w.limit)}</strong></div><div>Потрачено<strong>${money(spent(m, week))}</strong></div><div>Остаток<strong>${money(w.limit - spent(m, week))}</strong></div>`;
  $("weekforecast").innerHTML = forecastMarkup(week, true);
  $("weekeditable").hidden = w.closed;
  $("limit").value = w.limit / 100;
  $("weekexpenses").innerHTML = entries(m, week);
  const date = $("expenseform").elements.date,
    min = `${selected}-${String(w.start).padStart(2, "0")}`,
    max = `${selected}-${String(w.end).padStart(2, "0")}`;
  date.min = min;
  date.max = max < todayDate() ? max : todayDate();
  date.disabled = min > todayDate();
  $("expenseform").querySelector("button.primary").disabled = min > todayDate();
  const today = todayDate();
  if (!date.value || date.value < min || date.value > max)
    date.value = today >= min && today <= max ? today : min > today ? "" : min;
  $("categorybuttons").innerHTML = categoryOptions()
    .map(
      (c, i) =>
        `<button type="button" data-category="${cats.indexOf(c)}" aria-pressed="${c === category}">${icons[cats.indexOf(c)]} ${c}</button>`,
    )
    .join("");
}
function updateCloseAvailability() {
  const m = current(),
    first = m.weeks.findIndex((w) => !w.closed),
    blocked = m.weeks.slice(0, week).some((w) => !w.closed);
  $("closeform").hidden = blocked;
  $("closenote").hidden = !blocked;
  $("closenote").textContent = blocked
    ? `Сначала закройте неделю ${first + 1}. Недели закрываются по порядку.`
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
  try {
    await MerchantDictionary.loadDefaults();
    const result = await api("state");
    accountLogin = result.login;
    state = result.state;
    revision = result.revision;
    $("auth").hidden = true;
    $("dashboard").hidden = false;
    $("logout").hidden = false;
    render();
  } catch (e) {
    if (e.message !== "Войдите в аккаунт") toast(e.message);
  }
}
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
  $("filter").value = "";
  $("historyMerchant").value = "";
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
  $("expenseform").reset();
  category = categoryOptions()[0];
  renderWeek();
  $("weekdialog").showModal();
};
$("dismiss").onclick = () => $("weekdialog").close();
$("filter").onchange = () => render();
$("historyMerchant").onchange = () => render();
$("categorybuttons").onclick = (e) => {
  const b = e.target.closest("[data-category]");
  if (b) {
    category = cats[Number(b.dataset.category)];
    renderWeek();
  }
};
const cents = (v) => Math.round(Number(v) * 100);
$("expenseform").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  if (
    await mutate({
      type: "expense",
      amount: cents(f.elements.amount.value),
      date: f.elements.date.value,
      category,
      note: f.elements.note.value,
      merchantId: f.elements.merchantId.value,
    })
  ) {
    f.elements.amount.value = "";
    f.elements.note.value = "";
    f.elements.merchantId.value = "";
    MerchantUI.resetWeek();
    f.elements.amount.focus();
  }
};
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
async function deleteExpense(event) {
  const more = event.target.closest("[data-expense-menu]");
  if (more) {
    openExpenseMenu(more);
    return;
  }
  if (event.target.closest("[data-recategorize]")) {
    openCategoryEditor(event.target.closest("[data-recategorize]"));
    return;
  }
  const button = event.target.closest("[data-delete]");
  if (button && confirm("Удалить эту трату?"))
    await mutate({
      type: "delete",
      month: button.dataset.month,
      id: button.dataset.delete,
      week: Number(button.dataset.expenseWeek),
    });
}
$("weekexpenses").onclick = deleteExpense;
$("history").onclick = deleteExpense;

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
      if ($("weekdialog").open) renderWeek();
      document.dispatchEvent(new Event("finance-date-change"));
    }
  } catch {
    /* Retry on the next wake/tick; writes still validate on the server. */
  }
}
document.addEventListener("visibilitychange", refreshToday);
window.addEventListener("focus", refreshToday);
setInterval(refreshToday, 60000);
