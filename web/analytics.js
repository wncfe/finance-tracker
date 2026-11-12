(function (root) {
  "use strict";
  if (typeof module !== "undefined") {
    module.exports = require("./analytics-core.js");
    return;
  }
  if (typeof document === "undefined") return;
  const syncCategory = attachSelect($("expenseCategory"));
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
        type: "recategorize",
        ...editing,
        category: $("expenseCategory").value,
      })
    ) {
      $("categoryEditor").close();
      toast("Категория изменена");
    }
  };
})(globalThis);
