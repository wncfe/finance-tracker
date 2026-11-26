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
    await page
      .locator("#editCategoryChoices")
      .getByRole("button", { name: "Супермаркеты", exact: true })
      .click();
    assert.equal(await page.locator("#expenseCategory").inputValue(), "Супермаркеты");
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
    const historyAdd = page.locator("#historyQuickopen");
    assert.equal(await historyAdd.isVisible(), true);
    assert.equal(await page.locator("#quickopen").isVisible(), false);
    assert.equal(await page.locator("#filter").count(), 0);
    assert.equal(await page.locator("#historyMerchant").count(), 0);
    assert.equal(await page.locator(".history-summary").count(), 0);
    await historyAdd.click();
    await page.locator("#quickdialog").waitFor({ state: "visible" });
    await page.locator("#quickclose").click();
    await page.locator(".monthnav .picker-trigger").click();
    await page.locator('.picker[open] [data-value="2026-10"]').click();
    const total = await page.evaluate(() => money(12550));
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
    assert.equal(await page.locator("#history .entry").count(), 0);
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
      const expected = await page.evaluate((n) => money(n), amount);
      await page.waitForFunction(
        (text) =>
          document.querySelector("#historyChartAmount").textContent === text,
        expected,
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
    const track = page.locator("#historyTrack");
    const chart = page.locator("#historyChart");
    const previousPreview = ring.locator('[data-history-preview="-1"]');
    const nextPreview = ring.locator('[data-history-preview="1"]');
    await ring.scrollIntoViewIfNeeded();
    const arc = await chart.boundingBox();
    const frame = await ring.boundingBox();
    const neighbor = await previousPreview.boundingBox();
    assert.ok(neighbor.x < frame.x && neighbor.x + neighbor.width > frame.x);
    assert.equal(await nextPreview.count(), 0);
    assert.equal(await chart.locator(".history-ring-labels text").count(), 2);
    const angle = ((25000 / 36000) * Math.PI * 2) / 2 - Math.PI / 2;
    await page.mouse.click(
      arc.x + (arc.width * (124 + 82 * Math.cos(angle))) / 248,
      arc.y + (arc.height * (124 + 82 * Math.sin(angle))) / 248,
    );
    await assertAmount(25000, 2);
    await page.locator("#historyClearCategory").click();
    const trailingCap = chart.locator(
      '.history-ring-head[data-history-category="Супермаркеты"]',
    );
    assert.equal(
      await trailingCap.evaluate((cap) => {
        const angle = -Math.PI / 2 + (25000 / 36000) * Math.PI * 2 + 0.06;
        const point = new DOMPoint(
          124 + 82 * Math.cos(angle),
          124 + 82 * Math.sin(angle),
        );
        const underlying = cap.ownerSVGElement.querySelector(
          'path[data-history-category="Такси"]',
        );
        return cap.isPointInFill(point) && underlying.isPointInFill(point);
      }),
      true,
    );
    await trailingCap.click();
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
      assert.ok(
        Math.abs(
          await track.evaluate((el) =>
            parseFloat(el.style.getPropertyValue("--history-drag")),
          ),
        ) > 50,
      );
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      assert.equal(await track.evaluate((el) => el.getAnimations().length), 1);
    }
    await swipe(1);
    await assertAmount(0, 0);
    assert.equal(await nextPreview.count(), 1);
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
    const monthTotal = 6184569;
    const breakdown = [
      ["Супермаркеты", 2250000],
      ["Другое", 850000],
      ["Фастфуд", 650000],
      ["Одежда и обувь", 575000],
      ["Развлечения", 500000],
      ["Такси", 450000],
      ["Спорт", 350000],
      ["Дом", 260000],
      ["Красота", 180000],
    ];
    breakdown.push([
      "Подписки и цифровые сервисы",
      monthTotal -
        36000 -
        breakdown.reduce((sum, [, amount]) => sum + amount, 0),
    ]);
    await action({
      type: "expenses",
      items: breakdown.map(([category, amount]) => ({
        category,
        amount,
        date: "2026-11-13",
        note: category,
      })),
    });
    await page.reload();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    await page.locator("#tab-history").click();
    await assertAmount(monthTotal, 13);
    assert.equal(await chart.locator("path.history-ring-segment").count(), 6);
    assert.equal(
      await chart.locator(".history-ring-labels text").evaluateAll(
        (labels) =>
          labels.length === 6 &&
          labels.every((label) => {
            const { x, y, width, height } = label.getBBox();
            const viewBox = label.ownerSVGElement.viewBox.baseVal;
            return (
              x >= 0 &&
              y >= 0 &&
              x + width <= viewBox.width &&
              y + height <= viewBox.height
            );
          }),
      ),
      true,
    );
    assert.ok(
      await chart
        .locator("#historyChartAmount")
        .evaluate((el) => el.getBBox().width < 137),
    );
    const remainder = page.locator("#historyRemainderDialog");
    const remainderChip = page.locator(
      "#historyCategories [data-history-remainder]",
    );
    assert.equal(
      await remainderChip.locator("strong").textContent(),
      await page.evaluate((n) => money(n), 6184569 - 4850000),
    );
    await ring.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const groupedArc = await chart.boundingBox();
    const groupedAngle = (1 + 4850000 / monthTotal) * Math.PI - Math.PI / 2;
    await page.mouse.click(
      groupedArc.x +
        (groupedArc.width * (124 + 82 * Math.cos(groupedAngle))) / 248,
      groupedArc.y +
        (groupedArc.height * (124 + 82 * Math.sin(groupedAngle))) / 248,
    );
    assert.equal(await remainder.isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await remainder.isVisible(), false);
    await remainderChip.click();
    assert.equal(await remainder.locator("[data-history-category]").count(), 5);
    await page.screenshot({ path: folder + "/history-remainder.png" });
    await remainder.locator('[data-history-category="Красота"]').click();
    await assertAmount(180000, 1);
    assert.equal(await remainder.isVisible(), false);
    assert.equal(
      await page
        .locator('#historyCategories [data-history-category="Красота"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#historyClearCategory").click();
    await assertAmount(monthTotal, 13);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: folder + "/history-rounded-ring.png",
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
