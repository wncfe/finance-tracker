"use strict";
(() => {
  const menu = $("expenseActions");
  let source = null;
  globalThis.openExpenseMenu = (button) => {
    const month = button.dataset.month,
      expense = state.months[month]?.expenses.find(
        (e) => e.id === button.dataset.expenseMenu,
      );
    if (!expense || busy) return;
    if (menu.matches(":popover-open")) menu.hidePopover();
    source = button;
    (button.closest("dialog") || document.body).append(menu);
    $("expenseActionsTitle").textContent = expense.note || expense.category;
    const edit = $("expenseMenuCategory"),
      remove = $("expenseMenuDelete");
    edit.dataset.recategorize = expense.id;
    edit.dataset.month = month;
    remove.dataset.delete = expense.id;
    remove.dataset.month = month;
    remove.dataset.expenseWeek = expense.week;
    remove.disabled = state.months[month].weeks[expense.week].closed;
    $("expenseMenuReason").hidden = !remove.disabled;
    menu.showPopover();
    button.setAttribute("aria-expanded", "true");
    const anchor = button.getBoundingClientRect(),
      rect = menu.getBoundingClientRect();
    menu.style.left =
      Math.max(
        12,
        Math.min(innerWidth - rect.width - 12, anchor.right - rect.width),
      ) + "px";
    menu.style.top =
      Math.max(
        12,
        Math.min(
          innerHeight - rect.height - 12,
          anchor.bottom + rect.height + 8 < innerHeight
            ? anchor.bottom + 6
            : anchor.top - rect.height - 6,
        ),
      ) + "px";
    edit.focus();
  };
  menu.addEventListener("toggle", (e) => {
    if (e.newState === "closed") source?.setAttribute("aria-expanded", "false");
  });
  menu.onclick = (e) => {
    const button = e.target.closest("button");
    if (!button || button.disabled) return;
    menu.hidePopover();
    deleteExpense(e);
  };
  menu.onkeydown = (e) => {
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
    if (e.key === "Escape") {
      e.preventDefault();
      menu.hidePopover();
      source?.focus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const index = buttons.indexOf(document.activeElement);
      buttons[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : (index + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
              buttons.length
      ].focus();
    }
  };
  const previousRender = render;
  render = function () {
    if (menu.matches(":popover-open")) menu.hidePopover();
    previousRender();
  };
})();
