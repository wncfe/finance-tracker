const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const readline = require("readline");
const assert = require("node:assert/strict");

(async () => {
  const dir = `data/merchant-browser-${Date.now()}`;
  const login = `merchant-browser-${Date.now()}`;
  fs.mkdirSync(dir, { recursive: true });
  const server = spawn(
    "python",
    [
      "-c",
      `import server; server.budget.today_at=lambda:'2026-11-13'; from pathlib import Path; server.DB=Path('${dir}/test.sqlite3'); server.init(); httpd=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler); print(httpd.server_port,flush=True); httpd.serve_forever()`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const serverLines = readline.createInterface({ input: server.stdout });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Test server did not report its port")),
      20000,
    );
    serverLines.once("line", (line) => {
      clearTimeout(timeout);
      const value = Number(line);
      value > 0
        ? resolve(value)
        : reject(Error(`Invalid test server port: ${line}`));
    });
    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(Error(`Test server exited before startup with code ${code}`));
    });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let failCatalogOnce = true;
    await page.route("**/merchants.json", (route) => {
      if (failCatalogOnce) {
        failCatalogOnce = false;
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${baseUrl}/`);
    await page.locator("#toast").waitFor({ state: "visible" });
    await page.locator("#sessionRetry").click();
    await page.locator("[name=login]").fill(login);
    await page.locator("[name=password]").fill("browser-password-123");
    await page.locator("#register").click();
    try {
      await page.waitForFunction(
        () => !document.querySelector("#dashboard").hidden,
        { timeout: 10000 },
      );
    } catch {
      throw Error(
        `Registration failed: ${JSON.stringify({ toast: await page.locator("#toast").textContent(), session: await page.locator("#sessionStatus").textContent(), errors })}`,
      );
    }
    await page.locator("#quickopen").click();
    await page.locator("#quicktext").fill("Магнит 100");
    await page.locator("#quickparse button").click();
    await page.locator("#quickrows select[data-field=merchantId]").waitFor();
    assert.equal(
      await page
        .locator("#quickrows select[data-field=merchantId]")
        .inputValue(),
      "b-magnit",
    );
    await page.locator("[data-merchant-new]").click();
    await page.screenshot({
      path: dir + "/merchant-dialog.png",
      fullPage: true,
    });
    for (const width of [320, 360, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page
          .locator("#merchantDialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
        `merchant dialog overflow ${width}`,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#merchantName").fill("Мой тестовый магазин");
    await page.locator("#merchantAliases").fill("Магазин Тест\nMT Test");
    if (!(await page.locator("#merchantCategoryChoose").count()))
      throw Error(
        `Missing category chooser: ${JSON.stringify(await page.evaluate(() => ({ url: location.href, ids: [...document.querySelectorAll("[id]")].map((el) => el.id).filter((id) => /merchant|categor/i.test(id)) })))}`,
      );
    await page.locator("#merchantCategoryChoose").click();
    await page.locator("#categorySearch").fill("Тестовая");
    await page.locator("#categoryAdd").click();
    await page.locator("#categoryName").fill("Тестовая категория");
    await page.locator("#categoryForm button[type=submit]").click();
    await page.locator("#categoryDialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.locator("#merchantCategory").inputValue(),
      "Тестовая категория",
    );
    await page.locator("#merchantForm button[type=submit]").click();
    await page.locator("#merchantFormDialog").waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      /^c-[0-9a-f]{32}$/.test(
        document.querySelector("#quickrows select[data-field=merchantId]")
          .value,
      ),
    );
    const merchantId = await page
      .locator("#quickrows select[data-field=merchantId]")
      .inputValue();
    assert.match(
      merchantId,
      /^c-[0-9a-f]{32}$/,
      JSON.stringify({
        merchantId,
        merchants: (
          await page.evaluate(() => fetch("/api/state").then((r) => r.json()))
        ).state.merchants,
        options: await page
          .locator("#quickrows select[data-field=merchantId] option")
          .evaluateAll((items) => items.map((item) => item.value)),
      }),
    );
    await page.locator("#quicksubmit").click();
    await page.locator("#quickdialog").waitFor({ state: "hidden" });
    let state = await page.evaluate(() =>
      fetch("/api/state").then((r) => r.json()),
    );
    let expenses = Object.values(state.state.months).flatMap(
      (month) => month.expenses,
    );
    assert.equal(expenses[0].merchantId, merchantId);
    assert.equal(expenses[0].category, "Тестовая категория");
    assert.equal(expenses[0].note, "Магнит");
    await page.locator("#tab-history").click();
    const customRow = page
      .locator("#history .entry")
      .filter({ hasText: "Тестовая категория" });
    const customChip = page.locator(
      '#historyCategories [data-history-category="Тестовая категория"]',
    );
    assert.equal(
      await customRow.locator("img").getAttribute("src"),
      await customChip.locator("img").getAttribute("src"),
    );
    const colorOf = (locator) =>
      locator.evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--category-color").trim(),
      );
    const customColor = await colorOf(customRow.locator(".icon"));
    assert.match(customColor, /^#[0-9a-f]{6}$/);
    assert.equal(await colorOf(customChip), customColor);
    assert.notEqual(customColor, "#687776");
    const secondContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const secondPage = await secondContext.newPage();
    await secondPage.goto(`${baseUrl}/`);
    await secondPage.locator("[name=login]").fill(login);
    await secondPage.locator("[name=password]").fill("browser-password-123");
    await secondPage.locator("#authform button[type=submit]").click();
    await secondPage.locator("#dashboard").waitFor({ state: "visible" });
    await secondPage.locator('[data-week="0"]').click();
    const weeklyChoice = secondPage.locator(
      '#categorybuttons [data-category="Тестовая категория"]',
    );
    await weeklyChoice.click();
    assert.equal(await weeklyChoice.getAttribute("aria-pressed"), "true");
    assert.equal(await colorOf(weeklyChoice), customColor);
    await secondPage.locator('#expenseform [name="note"]').fill("Магазин Тест");
    assert.equal(
      await secondPage.locator("#weekMerchant").inputValue(),
      merchantId,
    );
    assert.match(
      await secondPage.locator("#categoryMerchantNote").textContent(),
      /Тестовая категория/,
    );
    await secondPage.locator('#expenseform [name="note"]').fill("Магни");
    assert.equal(await secondPage.locator("#weekMerchant").inputValue(), "");
    assert.match(
      await secondPage.locator("#weekMerchantHint").textContent(),
      /Магнит/,
    );
    await secondPage.locator("#weekMerchant + button").click();
    await secondPage
      .locator('.picker input[aria-label="Поиск магазина"]')
      .fill("Магнит");
    await secondPage
      .locator(".picker [data-option]")
      .filter({ hasText: "Магнит" })
      .click();
    await secondPage.locator('#expenseform [name="amount"]').fill("10");
    await secondPage.locator("#expenseform button.primary").click();
    await secondPage.waitForFunction(
      () => !document.querySelector('#expenseform [name="amount"]').value,
    );
    const regularExpense = await secondPage.evaluate(async () => {
      const response = await fetch("/api/state").then((result) =>
        result.json(),
      );
      return Object.values(response.state.months)
        .flatMap((month) => month.expenses)
        .find((expense) => expense.note === "Магни");
    });
    assert.equal(regularExpense.category, "Супермаркеты");
    await secondPage.locator('#expenseform [name="note"]').fill("Магнит");
    assert.equal(
      await secondPage.locator("#weekMerchant").inputValue(),
      "b-magnit",
    );
    await secondPage.locator("#weekMerchant + button").click();
    await secondPage
      .locator('.picker input[aria-label="Поиск магазина"]')
      .fill("Магни");
    await secondPage
      .locator(".picker [data-option]")
      .filter({ hasText: "Магнит" })
      .click();
    assert.equal(
      await secondPage.locator("#weekMerchant").inputValue(),
      "b-magnit",
    );
    await secondContext.close();
    await page.reload();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    await page.locator("#quickopen").click();
    await page.locator("#quicktext").fill("Магазин Тест 200");
    await page.locator("#quickparse button").click();
    assert.equal(
      await page
        .locator("#quickrows select[data-field=merchantId]")
        .inputValue(),
      merchantId,
    );
    await page.locator("#quickclose").click();
    await page.locator("#tab-budget").click();
    await page.locator("#merchantOpen").click();
    await page.locator("#merchantSearch").fill("Мой тестовый");
    await page.locator(`[data-merchant-edit="${merchantId}"]`).click();
    await page.locator("#merchantFormDialog").waitFor({ state: "visible" });
    await page.locator("#merchantName").fill("Обновлённый магазин");
    await page.locator("#merchantHidden").check();
    await page.locator("#merchantForm button[type=submit]").click();
    await page.locator("#merchantFormDialog").waitFor({ state: "hidden" });
    await page.locator("#merchantClose").click();
    state = await page.evaluate(() =>
      fetch("/api/state").then((r) => r.json()),
    );
    assert.equal(state.state.merchants[0].name, "Обновлённый магазин");
    assert.equal(state.state.merchants[0].hidden, true);
    expenses = Object.values(state.state.months).flatMap(
      (month) => month.expenses,
    );
    assert.equal(expenses[0].merchantId, merchantId);
    await page.locator("#merchantOpen").click();
    await page.locator("#merchantAdd").click();
    await page.locator("#merchantName").fill("Другой магазин");
    await page.locator("#merchantAliases").fill("Магнит");
    await page
      .locator("#merchantCategory")
      .selectOption({ label: "Супермаркеты" });
    await page.locator("#merchantForm button[type=submit]").click();
    await page.locator("#merchantFormDialog").waitFor({ state: "hidden" });
    await page.locator("#merchantClose").click();
    state = await page.evaluate(() =>
      fetch("/api/state").then((r) => r.json()),
    );
    assert.equal(
      state.state.merchants.find(
        (merchant) => merchant.name === "Другой магазин",
      ).category,
      "Супермаркеты",
    );
    await page.locator("#quickopen").click();
    await page.locator("#quicktext").fill("Магнит 150");
    await page.locator("#quickparse button").click();
    assert.equal(
      await page
        .locator("#quickrows select[data-field=merchantId]")
        .inputValue(),
      "",
    );
    assert.match(
      await page.locator("[data-merchant-hint]").textContent(),
      /несколько магазинов/,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Merchant browser checks passed: inference, create, save, reload, alias, rename, hide",
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
