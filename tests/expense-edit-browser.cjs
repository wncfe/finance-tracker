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
      hasTouch: true,
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
          date: "2026-11-09",
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
    const expenseRow = page.locator(
      `#history [data-expense-id="${expense.id}"]`,
    );
    await expenseRow.press("Enter");
    const details = page.locator("#expenseDetails");
    assert.equal(await details.isVisible(), true);
    assert.equal(await details.locator("h2").textContent(), "Кофе");
    assert.equal(
      await details.locator("time").getAttribute("datetime"),
      "2026-11-09",
    );
    assert.equal(
      await details.locator("#expenseDetailsAmount").textContent(),
      await expenseRow.locator("strong").textContent(),
    );
    await page.keyboard.press("Escape");
    assert.equal(await details.isVisible(), false);
    assert.equal(
      await expenseRow.evaluate((el) => el === document.activeElement),
      true,
    );
    const open = async (id) => {
      await page.locator(`[data-expense-id="${id}"]:visible`).click();
      await page.locator("#expenseDetailsEdit").click();
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
    await page.locator("#editExpenseDate").fill("2026-11-10");
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
    assert.equal(edited.week, expense.week);
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
    await page
      .locator(`#history [data-expense-id="${closedExpense.id}"]`)
      .click();
    assert.equal(
      await page.locator("#expenseDetailsDelete").isDisabled(),
      true,
    );
    assert.equal(await page.locator("#expenseDetailsClosed").isVisible(), true);
    await page.locator("#expenseDetailsEdit").click();
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
    await page.locator("#tab-history").click();
    await page.locator(".monthnav .picker-trigger").click();
    await page.locator('.picker[open] [data-value="2026-10"]').click();
    await page.getByRole("button", { name: "Фильтр магазина" }).click();
    await page
      .locator(".picker[open]")
      .getByRole("button", { name: "Магнит" })
      .click();
    const total = await page.evaluate(() => money(12550));
    assert.equal(await page.locator("#historyTotal").textContent(), total);
    assert.equal(
      await page.locator(".entry-day-total:visible").textContent(),
      total,
    );
    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(
      await page
        .locator("#panel-history")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    await page.screenshot({ path: folder + "/history.png", fullPage: true });
    await expenseRow.click();
    await page.screenshot({ path: folder + "/details.png" });
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator("#expenseDetailsDelete").click();
    assert.equal(await details.isVisible(), true);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#expenseDetailsDelete").click();
    await expenseRow.waitFor({ state: "detached" });
    assert.equal(
      await page.locator("#historyMerchant").inputValue(),
      "b-magnit",
    );
    assert.equal(
      await page.locator("#historyTotal").textContent(),
      await page.evaluate(() => money(0)),
    );
    await action({
      type: "expenses",
      items: [
        { date: "2026-10-31", amount: 2500, category: "Кофейни", note: "Кофе" },
        {
          date: "2026-11-09",
          amount: 11000,
          category: "Такси",
          note: "Поездка",
        },
        {
          date: "2026-11-13",
          amount: 20000,
          category: "Супермаркеты",
          note: "Продукты",
        },
      ],
    });
    await page.reload();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    await page.locator("#tab-history").click();
    const history = page.locator("#panel-history");
    const assertAmount = async (amount, count) => {
      assert.equal(
        await page.locator("#historyChartAmount").textContent(),
        await page.evaluate((n) => money(n), amount),
      );
      assert.equal(
        await page.locator("#historyTotal").textContent(),
        await page.evaluate((n) => money(n), amount),
      );
      assert.equal(await page.locator("#history .entry").count(), count);
    };
    await assertAmount(36000, 3);
    const taxiChip = page.locator(
      '#historyCategories [data-history-category="Такси"]',
    );
    await taxiChip.click();
    await assertAmount(11000, 1);
    assert.equal(await taxiChip.getAttribute("aria-pressed"), "true");
    assert.equal(
      await taxiChip.evaluate((el) => document.activeElement === el),
      true,
    );
    await taxiChip.click();
    await assertAmount(36000, 3);

    const ring = page.locator("#historyRing");
    await ring.scrollIntoViewIfNeeded();
    const arc = await ring.boundingBox();
    const angle = ((25000 / 36000) * Math.PI * 2) / 2 - Math.PI / 2;
    await page.mouse.click(
      arc.x + (arc.width * (116 + 94 * Math.cos(angle))) / 232,
      arc.y + (arc.height * (116 + 94 * Math.sin(angle))) / 232,
    );
    await assertAmount(25000, 2);
    await page.locator("#historyClearCategory").click();
    await history.getByRole("button", { name: "Год", exact: true }).click();
    await assertAmount(38500, 4);
    assert.equal(await page.locator("#historyPeriod").textContent(), "2026");
    await history.getByRole("button", { name: "Неделя", exact: true }).click();
    await assertAmount(31000, 2);

    const cdp = await page.context().newCDPSession(page);
    async function swipe(direction) {
      await ring.scrollIntoViewIfNeeded();
      const box = await ring.boundingBox();
      const y = Math.round(box.y + box.height / 2);
      const x = Math.round(box.x + box.width / 2 - 55 * direction);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (const distance of [25, 65, 110])
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + distance * direction, y }],
        });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
    await swipe(1);
    await assertAmount(0, 0);
    await swipe(-1);
    await assertAmount(31000, 2);
    await page.setViewportSize({ width: 320, height: 844 });
    await history.getByRole("button", { name: "Месяц", exact: true }).click();
    assert.equal(
      await history.evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    await page.screenshot({
      path: folder + "/history-categories.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Expense history and editor browser: totals, filters, modal, deletion, editing, retry, closed weeks, reload and mobile widths passed",
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
