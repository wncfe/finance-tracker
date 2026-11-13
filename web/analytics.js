(function (root) {
  "use strict";
  if (typeof module !== "undefined") {
    module.exports = require("./analytics-core.js");
    return;
  }
  if (typeof document === "undefined") return;
  const syncCategory = attachSelect($("expenseCategory"));
  const syncMerchant = attachSelect($("editExpenseMerchant"));
  let editing = null;
  root.openCategoryEditor = (button) => {
    const month = button.dataset.month,
      identifier = button.dataset.recategorize;
    const expense = state.months[month]?.expenses.find(
      (e) => e.id === identifier,
    );
    if (!expense) return;
    editing = { month, id: expense.id, week: expense.week };
    $("categoryEditorNote").textContent = expense.note || expense.category;
    $("expenseCategory").innerHTML = categoryOptions()
      .map((c) => `<option>${esc(c)}</option>`)
      .join("");
    $("expenseCategory").value = expense.category;
    syncCategory();
    const closed = state.months[month].weeks[expense.week].closed;
    $("editExpenseAmount").value = (expense.amount / 100).toFixed(2);
    $("editExpenseDate").value = expense.date;
    $("editExpenseDate").max = todayDate();
    $("editExpenseAmount").disabled = closed;
    $("editExpenseDate").disabled = closed;
    const merchants = MerchantDictionary.all(
      state.merchants || [],
      true,
    ).filter((m) => !m.hidden || m.id === expense.merchantId);
    $("editExpenseMerchant").innerHTML =
      '<option value="">Не указан</option>' +
      merchants
        .map(
          (m) =>
            `<option value="${esc(m.id)}">${esc(m.name)}${m.hidden ? " (скрыт)" : ""}</option>`,
        )
        .join("");
    $("editExpenseMerchant").value = expense.merchantId || "";
    syncMerchant();
    $("expenseEditorHint").textContent = closed
      ? "Неделя закрыта: можно изменить магазин и категорию. Сумма и дата зафиксированы."
      : "Сумма и дата изменят остатки бюджета. Перенос в закрытую неделю недоступен.";
    $("categoryEditor").showModal();
  };
  $("categoryEditorClose").onclick = () => {
    if (!busy) $("categoryEditor").close();
  };
  $("categoryEditor").addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  $("categoryEditorForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!editing || busy) return;
    if (
      await mutate({
        type: "expense_update",
        ...editing,
        category: $("expenseCategory").value,
        merchantId: $("editExpenseMerchant").value,
        ...(!$("editExpenseAmount").disabled
          ? {
              amount: cents($("editExpenseAmount").value),
              date: $("editExpenseDate").value,
            }
          : {}),
      })
    ) {
      $("categoryEditor").close();
      toast("Операция изменена");
    }
  };
})(globalThis);
