"use strict";
(() => {
  let rows = [],
    owner = "",
    saving = false,
    frozen = false,
    dirty = false;
  const P = ExpenseParser;
  let rowPickers = [],
    rulePickers = [];
  const ruleKey = () => "expense-rules:" + accountLogin;
  function rules() {
    try {
      const value = JSON.parse(localStorage.getItem(ruleKey()) || "{}");
      const normalized =
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value)
                .map(([key, category]) => [
                  key,
                  CategoryUtils.canonical(category),
                ])
                .filter(([, category]) => cats.includes(category)),
            )
          : {};
      if (value && Object.values(value).includes("Продукты")) {
        try {
          localStorage.setItem(ruleKey(), JSON.stringify(normalized));
        } catch {}
      }
      return normalized;
    } catch {
      return {};
    }
  }
  function storeRules(value) {
    try {
      localStorage.setItem(ruleKey(), JSON.stringify(value));
      return true;
    } catch {
      toast("Не удалось сохранить правило в браузере");
      return false;
    }
  }
  function renderRules() {
    rulePickers.forEach((sync) => sync.destroy());
    $("rulelist").innerHTML =
      Object.entries(rules())
        .map(
          ([key, cat]) =>
            `<div class="rule-row"><span>${esc(key)}</span><select data-edit-rule="${esc(key)}" aria-label="Категория для ${esc(key)}">${categoryOptions()
              .map(
                (c) =>
                  `<option${c === cat ? " selected" : ""}>${esc(c)}</option>`,
              )
              .join(
                "",
              )}</select><button type="button" data-rule="${esc(key)}" aria-label="Удалить правило ${esc(key)}">Удалить</button></div>`,
        )
        .join("") || '<p class="muted">Нет сохранённых правил</p>';
    rulePickers = [...$("rulelist").querySelectorAll("select")].map(
      attachSelect,
    );
  }
  function location(row) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
    const d = new Date(row.date + "T12:00:00");
    if (
      isNaN(d) ||
      P.iso(d) !== row.date ||
      +row.date.slice(0, 4) < 2000 ||
      +row.date.slice(0, 4) > 2100
    )
      return null;
    const key = row.date.slice(0, 7),
      ws = state.months[key]?.weeks || calendar(key);
    const index = ws.findIndex(
      (w) => w.start <= d.getDate() && d.getDate() <= w.end,
    );
    return { key, index, closed: ws[index].closed };
  }
  function errors(row) {
    const result = [];
    if (
      !Number.isSafeInteger(row.amount) ||
      row.amount <= 0 ||
      row.amount > 1e10
    )
      result.push("Укажите положительную сумму до 100 000 000 ₽");
    if (!cats.includes(row.category)) result.push("Выберите категорию");
    if (!row.note.trim() || row.note.length > 200)
      result.push("Описание: от 1 до 200 символов");
    const place = location(row);
    if (!place) result.push("Укажите корректную дату");
    else if (row.date > todayDate())
      result.push("Расход не может быть в будущем");
    else if (place.closed)
      result.push(
        "Неделя закрыта. Добавление запрещено — исправьте дату или удалите строку.",
      );
    if (row.issues.length && !row.ack)
      result.push("Проверьте неоднозначный фрагмент и отметьте уточнение");
    return result;
  }
  function status() {
    const remembered = new Map();
    let conflict = false;
    for (const row of rows)
      if (row.remember) {
        const key = P.normalize(row.note);
        if (remembered.has(key) && remembered.get(key) !== row.category)
          conflict = true;
        remembered.set(key, row.category);
      }
    rows.forEach((row, i) => {
      const place = location(row),
        target = $("quickrows").querySelector(`[data-status="${i}"]`);
      if (target)
        target.textContent = [
          ...(place ? [`${place.key} · неделя ${place.index + 1}`] : []),
          ...errors(row),
        ].join(" · ");
    });
    $("quicktotal").textContent =
      `${rows.length} расходов · Итого ${money(rows.reduce((s, r) => s + (r.amount || 0), 0))}`;
    $("quicksubmit").disabled =
      saving ||
      dirty ||
      conflict ||
      !rows.length ||
      rows.length > 50 ||
      rows.some((r) => errors(r).length > 0);
    if (dirty)
      $("quickerror").textContent =
        "Текст изменился. Нажмите «Разобрать», чтобы обновить предпросмотр.";
    else if (conflict)
      $("quickerror").textContent =
        "Для одинакового описания выбраны разные правила. Оставьте только одно или уточните описания.";
    else if (rows.length > 50)
      $("quickerror").textContent =
        "За один раз можно сохранить не больше 50 расходов.";
    else if (!saving && !frozen) $("quickerror").textContent = "";
  }
  function renderRows() {
    rowPickers.forEach((sync) => sync.destroy());
    $("quicksave").hidden = !rows.length;
    $("quickrows").innerHTML = rows
      .map(
        (row, i) =>
          `<article class="quick-row" data-row="${i}"><div class="quick-row-head"><strong>Расход ${i + 1}</strong><button type="button" data-remove="${i}" aria-label="Удалить расход ${i + 1}">×</button></div><p class="muted raw">${esc(row.raw)}</p><div class="formgrid"><label>Сумма, ₽<input data-field="amount" type="number" inputmode="decimal" min="0.01" max="100000000" step="0.01" value="${row.amount ? row.amount / 100 : ""}" required></label><label>Дата<input data-field="date" type="date" min="2000-01-01" max="${todayDate()}" value="${esc(row.date)}" required></label></div><label>Категория<select data-field="category" required><option value="">Выберите категорию</option>${categoryOptions()
            .map(
              (c) =>
                `<option${c === row.category ? " selected" : ""}>${esc(c)}</option>`,
            )
            .join(
              "",
            )}</select></label><label>Описание<input data-field="note" maxlength="200" value="${esc(row.note)}" required></label><p class="muted">${esc(row.source)}</p>${row.issues.length ? `<p class="quick-warning">${row.issues.map(esc).join(" · ")}</p><label class="checkline"><input type="checkbox" data-field="ack"${row.ack ? " checked" : ""}>Я уточнил сумму, дату и назначение расхода</label>` : ""}<label class="checkline"><input type="checkbox" data-field="remember"${row.remember ? " checked" : ""}>Запомнить категорию для этого описания</label><p class="quick-warning" data-status="${i}" role="status"></p></article>`,
      )
      .join("");
    status();
    rowPickers = [
      ...$("quickrows").querySelectorAll("[data-field=date],select"),
    ].map((el) => {
      el.setAttribute(
        "aria-label",
        el.tagName === "SELECT" ? "Категория расхода" : "Дата расхода",
      );
      return el.tagName === "SELECT"
        ? attachSelect(el)
        : attachPicker(el, "date", { navigate: true });
    });
    $("quicksave")
      .querySelectorAll("input,select,button")
      .forEach((el) => {
        if (frozen) el.disabled = true;
      });
  }
  $("quickopen").onclick = () => {
    if (owner !== accountLogin) {
      rows = [];
      owner = accountLogin;
      $("quicktext").value = "";
      frozen = false;
      dirty = false;
      renderRows();
    }
    renderRules();
    let pending;
    try {
      pending = readPendingOperation(
        sessionStorage,
        "pending-operation:" + accountLogin,
      );
    } catch (error) {
      toast(error.message);
      return;
    }
    if (pending?.action.type === "expenses") {
      rows = pending.action.items.map((item) => ({
        ...item,
        raw: item.note,
        source: "Неподтверждённое сохранение",
        issues: [],
      }));
      frozen = true;
      dirty = false;
      renderRows();
      $("quickerror").textContent =
        "Подтвердите результат предыдущего запроса. Повтор безопасен и не создаст дубли.";
    }
    status();
    if (frozen) {
      $("quickdialog")
        .querySelectorAll("input,textarea,select,button")
        .forEach((el) => (el.disabled = true));
      $("quicksubmit").disabled = false;
    }
    $("quickdialog").showModal();
    $("quicktext").focus();
  };
  $("quickclose").onclick = () => {
    if (!saving) $("quickdialog").close();
  };
  $("quickdialog").addEventListener("cancel", (e) => {
    if (saving || frozen) e.preventDefault();
  });
  $("quickparse").onsubmit = (e) => {
    e.preventDefault();
    if (saving || frozen) return;
    dirty = false;
    rows = P.parse($("quicktext").value, {
      today: new Date(todayDate() + "T12:00:00"),
      rules: rules(),
      history: Object.values(state.months).flatMap((m) => m.expenses),
    });
    $("quickerror").textContent = "";
    renderRows();
  };
  $("quicktext").addEventListener("input", () => {
    dirty = rows.length > 0;
    status();
  });
  $("quickrows").addEventListener("input", (e) => {
    const el = e.target,
      field = el.dataset.field,
      index = el.closest("[data-row]")?.dataset.row;
    if (!field || index === undefined || saving || frozen) return;
    rows[index][field] =
      el.type === "checkbox"
        ? el.checked
        : field === "amount"
          ? el.value
            ? cents(el.value)
            : null
          : el.value;
    status();
  });
  $("quickrows").onclick = (e) => {
    const button = e.target.closest("[data-remove]");
    if (button && !saving && !frozen) {
      rows.splice(+button.dataset.remove, 1);
      renderRows();
    }
  };
  $("rulelist").onclick = (e) => {
    const key = e.target.closest("[data-rule]")?.dataset.rule;
    if (key !== undefined) {
      const value = rules();
      delete value[key];
      storeRules(value);
      renderRules();
    }
  };
  $("rulelist").onchange = (e) => {
    const key = e.target.dataset.editRule;
    if (key !== undefined) {
      const value = rules();
      value[key] = e.target.value;
      storeRules(value);
    }
  };
  $("quicksave").onsubmit = async (e) => {
    e.preventDefault();
    if (saving || (!frozen && rows.some((r) => errors(r).length))) return;
    status();
    if (!frozen && $("quicksubmit").disabled) return;
    saving = true;
    let action = {
      type: "expenses",
      items: rows.map((r) => ({
        amount: r.amount,
        date: r.date,
        category: r.category,
        note: r.note.trim(),
      })),
    };
    if (frozen)
      action = JSON.parse(
        sessionStorage.getItem("pending-operation:" + accountLogin),
      ).action;
    $("quickdialog")
      .querySelectorAll("input,textarea,select,button")
      .forEach((el) => (el.disabled = true));
    const ok = await mutate(action);
    saving = false;
    frozen = !!sessionStorage.getItem("pending-operation:" + accountLogin);
    if (ok) {
      const value = rules();
      for (const row of rows)
        if (row.remember) value[P.normalize(row.note)] = row.category;
      if (rows.some((r) => r.remember)) storeRules(value);
      rows = [];
      $("quicktext").value = "";
      renderRows();
      $("quickdialog").close();
      toast("Расходы сохранены");
    } else {
      $("quickerror").textContent = frozen
        ? "Результат пока неизвестен. Повторите сохранение тем же запросом: дубли не создадутся."
        : "Проверьте данные и историю расходов. Если восстановлено предыдущее изменение, повторите новое действие.";
      renderRows();
    }
    $("quickdialog")
      .querySelectorAll("input,textarea,select,button")
      .forEach((el) => (el.disabled = frozen));
    $("quicksubmit").disabled = false;
    if (!frozen) status();
  };
})();

document.addEventListener("finance-date-change", () => {
  document
    .querySelectorAll("#quickrows [data-field=date]")
    .forEach((el) => (el.max = todayDate()));
});
