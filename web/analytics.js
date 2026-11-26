(function (root) {
  "use strict";
  if (typeof module !== "undefined") {
    module.exports = require("./analytics-core.js");
    return;
  }
  if (typeof document === "undefined") return;
  const syncMerchant = attachSelect($("editExpenseMerchant"));
  let editing = null;
  function syncLinkedCategory() {
    const merchant = MerchantDictionary.all(state.merchants || [], true).find(
        (item) => item.id === $("editExpenseMerchant").value,
      ),
      category = $("expenseCategory");
    if (merchant?.category) {
      if (
        !Array.from(category.options).some((o) => o.value === merchant.category)
      )
        category.add(new Option(merchant.category, merchant.category));
      category.value = merchant.category;
    }
    category.disabled = !!merchant;
    syncCategory();
  }
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
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join("");
    $("expenseCategory").value = expense.category;
    $("editCategoryChoices").innerHTML = categoryOptions()
      .map((c) => categoryChoice(c, expense.category))
      .join("");
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
    syncLinkedCategory();
    $("expenseEditorHint").textContent = closed
      ? "Неделя закрыта: можно изменить магазин; категория связанного расхода берётся из магазина. Сумма и дата зафиксированы."
      : "Категория связанного расхода берётся из магазина. Сумма и дата изменят остатки бюджета; перенос в закрытую неделю недоступен.";
    $("categoryEditor").showModal();
  };
  $("editExpenseMerchant").addEventListener("change", syncLinkedCategory);
  $("categoryEditorClose").onclick = () => {
    if (!busy) $("categoryEditor").close();
  };
  $("editCategoryChoices").onclick = (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const value = cats[Number(button.dataset.category)];
    if (!value) return;
    $("expenseCategory").value = value;
    for (const choice of $("editCategoryChoices").children)
      choice.setAttribute("aria-pressed", String(choice === button));
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
