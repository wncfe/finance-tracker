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
    const merchantId = $("editExpenseMerchant").value,
      merchant = merchantDetails(merchantId),
      category = $("expenseCategory"),
      linked = $("editMerchantCategory");
    $("editManualCategory").hidden = !!merchantId;
    $("editLinkedCategory").hidden = !merchantId;
    category.disabled = !!merchantId;
    if (!merchantId) return;
    if (!categoryOptions().includes(merchant?.category)) {
      linked.textContent = "Сначала задайте категорию этому магазину.";
      return;
    }
    category.value = merchant.category;
    linked.innerHTML = `<span class="merchant-category-icon">${icon(categoryIcon(merchant.category))}</span><span>${esc(merchant.category)}</span>`;
    linked.firstElementChild.style.setProperty(
      "--category-color",
      categoryColor(merchant.category),
    );
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
      ? "Неделя закрыта. Сумма и дата зафиксированы."
      : "При изменении суммы или даты остатки бюджета пересчитаются. Перенос в закрытую неделю недоступен.";
    $("categoryEditor").showModal();
  };
  $("editExpenseMerchant").addEventListener("change", syncLinkedCategory);
  $("categoryEditorClose").onclick = () => {
    if (!busy) $("categoryEditor").close();
  };
  $("categoryEditor").addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  $("categoryEditorForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!editing || busy) return;
    const merchantId = $("editExpenseMerchant").value;
    const merchant = merchantDetails(merchantId);
    if (merchantId && !categoryOptions().includes(merchant?.category)) {
      toast("Сначала задайте категорию этому магазину.");
      return;
    }
    if (
      await mutate({
        type: "expense_update",
        ...editing,
        category: merchant?.category || $("expenseCategory").value,
        merchantId,
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
