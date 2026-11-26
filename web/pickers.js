"use strict";
// Each picker is a modal dialog: native focus trapping, Escape and focus return.
const months = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
function pickerDialog(title) {
  const dialog = document.createElement("dialog");
  dialog.className = "picker";
  dialog.setAttribute("aria-label", title);
  document.body.append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        dialog.close();
    }
  });
  return dialog;
}
function attachPicker(input, kind, { navigate = false } = {}) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "picker-trigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute(
    "aria-label",
    input.getAttribute("aria-label") ||
      (kind === "date" ? "Выбрать дату" : "Выбрать месяц"),
  );
  input.after(trigger);
  input.hidden = true;
  const dialog = pickerDialog(
    kind === "date" ? "Выбрать дату" : "Выбрать месяц",
  );
  let year = 2026;
  let viewedMonth = "";
  const sync = () => {
    trigger.disabled = input.disabled;
    if (kind === "month") {
      const [y, m] = input.value.split("-").map(Number);
      trigger.innerHTML =
        icon("calendar-days") +
        `<span>${months[m - 1] || "Выбрать месяц"} ${y || ""}</span>`;
    } else {
      trigger.innerHTML =
        icon("calendar-days") +
        `<span>${input.value ? input.value.split("-").reverse().join(".") : "Выбрать дату"}</span>`;
    }
  };
  function choose(value) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    sync();
    dialog.close();
    trigger.focus();
  }
  function draw() {
    if (kind === "month") {
      dialog.innerHTML = `<div class="picker-head"><button type="button" data-move="-1" aria-label="Предыдущий год">${icon("chevron-left")}</button><strong>${year}</strong><button type="button" data-move="1" aria-label="Следующий год">${icon("chevron-right")}</button></div><div class="month-grid">${months
        .map((m, i) => {
          const value = `${year}-${String(i + 1).padStart(2, "0")}`;
          return `<button type="button" data-value="${value}" ${(input.min && value < input.min) || (input.max && value > input.max) ? "disabled" : ""} aria-pressed="${value === input.value}">${m.slice(0, 3)}</button>`;
        })
        .join(
          "",
        )}</div><button type="button" class="picker-cancel">Закрыть</button>`;
    } else {
      const value = viewedMonth,
        [y, m] = value.split("-").map(Number),
        start = (new Date(y, m - 1, 1).getDay() + 6) % 7,
        count = new Date(y, m, 0).getDate();
      const moveButton = (n, label, name) => {
        const d = new Date(y, m - 1 + n, 1, 12);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const disabled =
          (input.min && key < input.min.slice(0, 7)) ||
          (input.max && key > input.max.slice(0, 7));
        return `<button type="button" data-month-move="${n}" aria-label="${label}" ${disabled ? "disabled" : ""}>${icon(name)}</button>`;
      };
      dialog.innerHTML = `<div class="picker-head">${navigate ? moveButton(-1, "Предыдущий месяц", "chevron-left") : ""}<strong>${months[m - 1]} ${y}</strong>${navigate ? moveButton(1, "Следующий месяц", "chevron-right") : ""}<button type="button" class="picker-cancel" aria-label="Закрыть">${icon("x")}</button></div><div class="day-grid">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => `<span>${d}</span>`).join("")}${"<span></span>".repeat(start)}${Array.from(
        { length: count },
        (_, i) => {
          const v = `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
          return `<button type="button" data-value="${v}" ${(input.min && v < input.min) || (input.max && v > input.max) ? "disabled" : ""} aria-pressed="${v === input.value}">${i + 1}</button>`;
        },
      ).join(
        "",
      )}</div><p class="muted">${navigate ? "Выберите дату расхода" : "Даты выбранной недели"}</p>`;
    }
  }
  dialog.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.value) choose(b.dataset.value);
    else if (b.dataset.move) {
      year = Math.min(2100, Math.max(2000, year + Number(b.dataset.move)));
      draw();
    } else if (b.dataset.monthMove) {
      const [y, m] = viewedMonth.split("-").map(Number);
      const d = new Date(y, m - 1 + Number(b.dataset.monthMove), 1, 12);
      viewedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      draw();
      dialog
        .querySelector(`[data-month-move="${b.dataset.monthMove}"]`)
        ?.focus();
    } else if (b.classList.contains("picker-cancel")) dialog.close();
  };
  trigger.onclick = () => {
    if (input.disabled) return;
    let value = input.value || ExpenseParser.iso(new Date());
    if (input.min && value < input.min) value = input.min;
    if (input.max && value > input.max) value = input.max;
    viewedMonth = value.slice(0, 7);
    year = Number((input.value || input.min).slice(0, 4));
    draw();
    const ownerDialog = input.closest("dialog");
    if (ownerDialog && !ownerDialog.contains(dialog))
      ownerDialog.append(dialog);
    dialog.showModal();
  };
  input.addEventListener("change", sync);
  sync.destroy = () => {
    dialog.remove();
    trigger.remove();
    input.removeEventListener("change", sync);
  };
  sync();
  return sync;
}
function attachSelect(select) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "picker-trigger select-trigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute(
    "aria-label",
    select.getAttribute("aria-label") || "Выбрать распределение",
  );
  select.after(trigger);
  select.hidden = true;
  const dialog = pickerDialog(trigger.getAttribute("aria-label"));
  const isMerchant = ["weekMerchant", "editExpenseMerchant"].includes(
    select.id,
  );
  const recentKey = "finance.recentMerchants";
  const readRecent = () => {
    if (!isMerchant) return [];
    try {
      const ids = JSON.parse(localStorage.getItem(recentKey) || "[]");
      return Array.isArray(ids)
        ? ids.filter((id) => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  };
  const remember = (value) => {
    if (!isMerchant || !value) return;
    try {
      localStorage.setItem(
        recentKey,
        JSON.stringify(
          [value, ...readRecent().filter((id) => id !== value)].slice(0, 5),
        ),
      );
    } catch {
      // The picker remains usable when browser storage is unavailable.
    }
  };
  const drawOptions = (query = "") => {
    const normalized = isMerchant ? MerchantDictionary.normalize(query) : "";
    const options = Array.from(select.options);
    const namesById = new Map(
      isMerchant
        ? MerchantDictionary.all(state.merchants || [], true).map((m) => [
            m.id,
            [m.name, ...(m.aliases || [])].map(MerchantDictionary.normalize),
          ])
        : [],
    );
    const matches = options.filter(
      (o) =>
        !normalized ||
        (
          namesById.get(o.value) || [
            MerchantDictionary.normalize(o.textContent),
          ]
        ).some((name) => name.includes(normalized)),
    );
    const recent =
      isMerchant && !normalized
        ? readRecent()
            .map((id) => options.find((o) => o.value === id))
            .filter(Boolean)
        : [];
    const recentSet = new Set(recent.map((o) => o.value));
    const button = (o, i) =>
      `<button type="button" data-option="${i}" ${o.disabled ? "disabled" : ""} aria-pressed="${o.selected}">${esc(o.textContent)}<span>${o.selected ? "✓" : ""}</span></button>`;
    const group = (title, items) =>
      items.length
        ? `<h3 class="merchant-picker-section">${title}</h3>${items.map((o) => button(o, options.indexOf(o))).join("")}`
        : "";
    const remaining = normalized
      ? matches
      : matches.filter((o) => !recentSet.has(o.value));
    const list = `${group("Недавние", recent)}${group(normalized ? "Результаты" : "Все магазины", remaining)}`;
    const body = list || '<p class="muted">Ничего не найдено</p>';
    dialog.querySelector(".option-list").innerHTML = body;
  };
  const sync = () => {
    trigger.textContent = select.selectedOptions[0]?.textContent || "Выбрать";
    trigger.disabled = select.disabled;
  };
  trigger.onclick = () => {
    if (select.disabled) return;
    dialog.innerHTML = isMerchant
      ? `<h2>${esc(trigger.getAttribute("aria-label"))}</h2><label class="merchant-picker-search">Поиск<input type="search" autocomplete="off" placeholder="Название магазина" aria-label="Поиск магазина"></label><button type="button" class="merchant-picker-create" data-merchant-create>Добавить магазин</button><div class="option-list"></div><button type="button" class="picker-cancel">Закрыть</button>`
      : "<h2>" +
        esc(trigger.getAttribute("aria-label")) +
        '</h2><div class="option-list">' +
        Array.from(select.options)
          .map(
            (o, i) =>
              `<button type="button" data-option="${i}" ${o.disabled ? "disabled" : ""} aria-pressed="${o.selected}">${esc(o.textContent)}<span>${o.selected ? "✓" : ""}</span></button>`,
          )
          .join("") +
        '</div><button type="button" class="picker-cancel">Закрыть</button>';
    if (isMerchant) {
      drawOptions();
      const search = dialog.querySelector("input[type=search]");
      search.addEventListener("input", () => drawOptions(search.value));
      dialog.addEventListener("shown", () => search.focus(), { once: true });
    }
    dialog.showModal();
    if (isMerchant) dialog.querySelector("input[type=search]").focus();
  };
  dialog.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.hasAttribute("data-merchant-create")) {
      const suggested = dialog.querySelector("input[type=search]").value.trim();
      dialog.close();
      MerchantUI.open((id) => {
        const merchant = MerchantDictionary.all(state.merchants || []).find(
          (item) => item.id === id,
        );
        if (!merchant) return;
        if (!Array.from(select.options).some((option) => option.value === id))
          select.add(new Option(merchant.name, id));
        select.value = id;
        remember(id);
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
      }, suggested);
      return;
    }
    if (b.dataset.option !== undefined) {
      select.selectedIndex = Number(b.dataset.option);
      remember(select.value);
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
      dialog.close();
      trigger.focus();
    } else dialog.close();
  };
  select.addEventListener("change", sync);
  const optionsObserver = new MutationObserver(sync);
  optionsObserver.observe(select, { childList: true, subtree: true });
  sync.destroy = () => {
    dialog.remove();
    trigger.remove();
    select.removeEventListener("change", sync);
    optionsObserver.disconnect();
  };
  sync();
  return sync;
}
const syncMonth = attachPicker($("month"), "month"),
  syncDate = attachPicker($("expenseform").elements.date, "date"),
  syncClose = attachSelect($("closemode"));
const syncWeekMerchant = attachSelect($("weekMerchant"));
const originalRender = render,
  originalRenderWeek = renderWeek;
render = function () {
  originalRender();
  syncMonth();
  syncClose();
  syncWeekMerchant();
};
renderWeek = function () {
  originalRenderWeek();
  syncDate();
  updateCloseAvailability();
};
syncMonth();
syncDate();
syncClose();
syncWeekMerchant();
