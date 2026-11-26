"use strict";
(() => {
  const dialog = $("expenseDetails"),
    edit = $("expenseDetailsEdit"),
    remove = $("expenseDetailsDelete"),
    date = $("expenseDetailsDate");
  let active = null,
    editing = null;

  function restoreFocus({ list, id }) {
    const row = list.querySelector(`[data-expense-id="${CSS.escape(id)}"]`);
    (row || list).focus({ preventScroll: true });
  }

  for (const list of [$("history"), $("analysisDetailsBody")]) {
    list.addEventListener("click", (event) => {
      const row = event.target.closest("[data-expense-id]");
      if (!row || busy) return;
      const { month, expenseId: id } = row.dataset;
      const record = state.months[month];
      const expense = record?.expenses.find((item) => item.id === id);
      if (!expense) return;

      const closed = record.weeks[expense.week].closed;
      const merchant = expense.merchantId
        ? MerchantDictionary.all(state.merchants, true).find(
            (item) => item.id === expense.merchantId,
          )?.name
        : "";
      active = { list, month, id, week: expense.week };
      $("expenseDetailsTitle").textContent = expenseTitle(expense, merchant);
      $("expenseDetailsAmount").textContent = money(expense.amount);
      date.dateTime = expense.date;
      date.textContent = ExpenseAnalytics.date(expense.date).toLocaleDateString(
        "ru-RU",
        { dateStyle: "long", timeZone: "UTC" },
      );
      $("expenseDetailsCategory").textContent = expense.category;
      $("expenseDetailsMerchant").textContent = merchant || "Магазин";
      $("expenseDetailsMerchantField").hidden = !expense.merchantId;
      $("expenseDetailsNote").textContent = expense.note || "";
      $("expenseDetailsNoteField").hidden =
        !expense.note || !expense.merchantId;
      $("expenseDetailsClosed").hidden = !closed;
      remove.disabled = closed;
      dialog.showModal();
    });
  }

  $("expenseDetailsClose").onclick = () => dialog.close();
  edit.onclick = () => {
    if (!active || busy) return;
    editing = active;
    dialog.close();
    openCategoryEditor({
      dataset: { month: editing.month, recategorize: editing.id },
    });
  };
  $("categoryEditor").addEventListener("close", () => {
    if (editing && !$("dashboard").hidden) restoreFocus(editing);
    editing = null;
  });
  remove.onclick = async () => {
    if (!active || busy || remove.disabled || !confirm("Удалить эту трату?"))
      return;
    const { list, month, id, week } = active;
    dialog.close();
    await mutate({ type: "delete", month, id, week });
    if (!$("dashboard").hidden && document.activeElement === document.body)
      restoreFocus({ list, id });
  };
})();
