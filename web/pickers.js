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
function attachPicker(input, kind) {
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
  const sync = () => {
    if (kind === "month") {
      const [y, m] = input.value.split("-").map(Number);
      trigger.innerHTML =
        icon("calendar-days") +
        `<span>${months[m - 1] || "Выбрать месяц"} ${y || ""}</span><span aria-hidden="true">⌄</span>`;
    } else {
      trigger.innerHTML =
        icon("calendar-days") +
        `<span>${input.value ? input.value.split("-").reverse().join(".") : "Выбрать дату"}</span><span aria-hidden="true">⌄</span>`;
    }
  };
  function choose(value) {
    input.value = value;
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
          return `<button type="button" data-value="${value}" aria-pressed="${value === input.value}">${m.slice(0, 3)}</button>`;
        })
        .join(
          "",
        )}</div><button type="button" class="picker-cancel">Закрыть</button>`;
    } else {
      const value = input.value || input.min,
        [y, m] = value.split("-").map(Number),
        start = (new Date(y, m - 1, 1).getDay() + 6) % 7,
        count = new Date(y, m, 0).getDate();
      dialog.innerHTML = `<div class="picker-head"><strong>${months[m - 1]} ${y}</strong><button type="button" class="picker-cancel" aria-label="Закрыть">${icon("x")}</button></div><div class="day-grid">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => `<span>${d}</span>`).join("")}${"<span></span>".repeat(start)}${Array.from(
        { length: count },
        (_, i) => {
          const v = `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
          return `<button type="button" data-value="${v}" ${v < input.min || v > input.max ? "disabled" : ""} aria-pressed="${v === input.value}">${i + 1}</button>`;
        },
      ).join("")}</div><p class="muted">Даты выбранной недели</p>`;
    }
  }
  dialog.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.value) choose(b.dataset.value);
    else if (b.dataset.move) {
      year = Math.min(2100, Math.max(2000, year + Number(b.dataset.move)));
      draw();
    } else if (b.classList.contains("picker-cancel")) dialog.close();
  };
  trigger.onclick = () => {
    year = Number((input.value || input.min).slice(0, 4));
    draw();
    dialog.showModal();
  };
  input.addEventListener("change", sync);
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
  const sync = () => {
    trigger.textContent =
      (select.selectedOptions[0]?.textContent || "Выбрать") + " ⌄";
  };
  trigger.onclick = () => {
    dialog.innerHTML =
      "<h2>" +
      trigger.getAttribute("aria-label") +
      '</h2><div class="option-list">' +
      Array.from(select.options)
        .map(
          (o, i) =>
            `<button type="button" data-option="${i}" aria-pressed="${o.selected}">${o.textContent}<span>${o.selected ? "✓" : ""}</span></button>`,
        )
        .join("") +
      '</div><button type="button" class="picker-cancel">Закрыть</button>';
    dialog.showModal();
  };
  dialog.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.option !== undefined) {
      select.selectedIndex = Number(b.dataset.option);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
      dialog.close();
      trigger.focus();
    } else dialog.close();
  };
  select.addEventListener("change", sync);
  return sync;
}
const syncMonth = attachPicker($("month"), "month"),
  syncDate = attachPicker($("expenseform").elements.date, "date"),
  syncFilter = attachSelect($("filter")),
  syncClose = attachSelect($("closemode"));
const originalRender = render,
  originalRenderWeek = renderWeek;
render = function () {
  originalRender();
  syncMonth();
  syncFilter();
  syncClose();
};
renderWeek = function () {
  originalRenderWeek();
  syncDate();
  updateCloseAvailability();
};
syncMonth();
syncDate();
syncFilter();
syncClose();
