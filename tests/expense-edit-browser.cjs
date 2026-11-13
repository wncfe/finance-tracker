const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const folder = "data/expense-edit-ui-" + Date.now();
  fs.mkdirSync(folder, { recursive: true });
  const server = spawn(
    "python",
    [
      "-c",
      `import server;server.budget.today_at=lambda:'2026-11-13';from pathlib import Path;server.DB=Path('${folder}/test.sqlite3');server.init();server.ThreadingHTTPServer(('127.0.0.1',8006),server.Handler).serve_forever()`,
    ],
    { stdio: "pipe" },
  );
  let browser;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        await fetch("http://127.0.0.1:8006/api/config");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const base = "http://127.0.0.1:8006/api/";
    assert.equal(
      (
        await page.request.post(base + "register", {
          data: { login: "expense-editor", password: "test-password-123" },
        })
      ).status(),
      200,
    );
    const state = async () => (await page.request.get(base + "state")).json();
    const action = async (a) => {
      const current = await state();
      const r = await page.request.post(base + "action", {
        data: {
          revision: current.revision,
          operationId: crypto.randomUUID(),
          action: a,
        },
      });
      assert.equal(r.status(), 200);
      return r.json();
    };
    await action({ type: "budget", month: "2026-10", amount: 300000 });
    await action({ type: "budget", month: "2026-11", amount: 300000 });
    const seeded = await action({
      type: "expenses",
      items: [
        {
          date: "2026-11-01",
          amount: 5000,
          category: "Кофейни",
          note: "Закрытый",
        },
        {
          date: "2026-11-08",
          amount: 10000,
          category: "Кофейни",
          note: "Кофе",
        },
      ],
    });
    const [closedExpense, expense] = seeded.state.months["2026-11"].expenses;
    const closed = await action({
      type: "close",
      month: "2026-11",
      week: 0,
      mode: "next",
    });
    const limits = closed.state.months["2026-11"].weeks;
    await page.goto("http://127.0.0.1:8006/");
    await page.locator("#dashboard").waitFor({ state: "visible" });
    await page.locator("#tab-history").click();
    const open = async (id) => {
      await page.locator(`[data-expense-menu="${id}"]:visible`).click();
      await page.locator("#expenseMenuCategory").click();
      await page.locator("#categoryEditor").waitFor({ state: "visible" });
    };
    const choose = async (label, name) => {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page
        .locator(".picker[open]")
        .getByRole("button", { name, exact: true })
        .click();
    };
    await open(expense.id);
    await page.locator("#editExpenseAmount").fill("125.50");
    await page.locator("#editExpenseDate").fill("2026-11-09");
    await choose("Магазин операции", "Магнит");
    await choose("Новая категория", "Супермаркеты");
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const box = await page.locator("#categoryEditor").boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: folder + "/editor.png", fullPage: true });
    let dropped = false;
    const operationIds = [];
    await page.route("**/api/action", async (route) => {
      const body = route.request().postDataJSON();
      if (body.action.type === "expense_update") {
        operationIds.push(body.operationId);
        if (!dropped) {
          dropped = true;
          await route.fetch();
          return route.abort();
        }
      }
      return route.continue();
    });
    await page.locator("#categoryEditorForm button.primary").click();
    await page.locator("#categoryEditor").waitFor({ state: "hidden" });
    assert.ok(operationIds.length >= 2);
    assert.equal(new Set(operationIds).size, 1);
    let current = await state();
    let edited = current.state.months["2026-11"].expenses.find(
      (e) => e.id === expense.id,
    );
    assert.equal(edited.amount, 12550);
    assert.equal(edited.week, 2);
    assert.equal(edited.merchantId, "b-magnit");
    assert.equal(edited.category, "Супермаркеты");
    assert.deepEqual(current.state.months["2026-11"].weeks, limits);
    await open(expense.id);
    await page.locator("#editExpenseDate").fill("2026-11-01");
    await page.locator("#categoryEditorForm button.primary").click();
    await page.waitForFunction(() =>
      document.querySelector("#toast").textContent.includes("закрытую"),
    );
    assert.equal(await page.locator("#categoryEditor").isVisible(), true);
    assert.equal(
      await page.locator("#editExpenseDate").inputValue(),
      "2026-11-01",
    );
    await page.locator("#editExpenseDate").fill("2026-10-31");
    await page.locator("#categoryEditorForm button.primary").click();
    await page.locator("#categoryEditor").waitFor({ state: "hidden" });
    current = await state();
    assert.equal(current.state.months["2026-10"].expenses[0].id, expense.id);
    assert.equal(current.state.months["2026-11"].expenses.length, 1);
    await open(closedExpense.id);
    assert.equal(await page.locator("#editExpenseAmount").isDisabled(), true);
    assert.equal(await page.locator("#editExpenseDate").isDisabled(), true);
    await choose("Магазин операции", "Магнит");
    await choose("Новая категория", "Супермаркеты");
    await page.locator("#categoryEditorForm button.primary").click();
    await page.locator("#categoryEditor").waitFor({ state: "hidden" });
    current = await state();
    assert.equal(
      current.state.months["2026-11"].expenses[0].merchantId,
      "b-magnit",
    );
    assert.deepEqual(current.state.months["2026-11"].weeks, limits);
    await page.reload();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
    console.log(
      "Expense editor browser: all fields, budget state, retry, rejection, month move, closed metadata, reload and mobile widths passed",
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
