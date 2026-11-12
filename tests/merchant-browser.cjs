const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const assert = require("node:assert/strict");

(async () => {
  const dir = `data/merchant-browser-${Date.now()}`;
  fs.mkdirSync(dir, { recursive: true });
  const server = spawn("python", [
    "-c",
    `import server; from pathlib import Path; server.DB=Path('${dir}/test.sqlite3'); server.init(); server.ThreadingHTTPServer(('127.0.0.1',8003),server.Handler).serve_forever()`,
  ]);
  let browser;
  try {
    for (let i = 0; i < 80; i++) {
      try {
        await fetch("http://127.0.0.1:8003/");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
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
    await page.goto("http://127.0.0.1:8003/");
    await page.locator("#toast").waitFor({ state: "visible" });
    await page.locator("[name=login]").fill("merchant-browser");
    await page.locator("[name=password]").fill("browser-password-123");
    await page.locator("#register").click();
    await page.locator("#dashboard").waitFor({ state: "visible" });
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
    await page.locator("#merchantForm button[type=submit]").click();
    await page.locator("#merchantDialog").waitFor({ state: "hidden" });
    const merchantId = await page
      .locator("#quickrows select[data-field=merchantId]")
      .inputValue();
    assert.match(merchantId, /^c-[0-9a-f]{32}$/);
    await page.locator("#quicksubmit").click();
    await page.locator("#quickdialog").waitFor({ state: "hidden" });
    let state = await page.evaluate(() =>
      fetch("/api/state").then((r) => r.json()),
    );
    let expenses = Object.values(state.state.months).flatMap(
      (month) => month.expenses,
    );
    assert.equal(expenses[0].merchantId, merchantId);
    assert.equal(expenses[0].note, "Магнит");
    await page.locator("#tab-history").click();
    await page.locator("#historyMerchant").selectOption(merchantId);
    assert.equal(await page.locator("#history .entry").count(), 1);
    await page.locator("#historyMerchant").selectOption("__none__");
    assert.equal(await page.locator("#history .entry").count(), 0);
    const secondContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const secondPage = await secondContext.newPage();
    await secondPage.goto("http://127.0.0.1:8003/");
    await secondPage.locator("[name=login]").fill("merchant-browser");
    await secondPage.locator("[name=password]").fill("browser-password-123");
    await secondPage.locator("#authform button[type=submit]").click();
    await secondPage.locator("#dashboard").waitFor({ state: "visible" });
    await secondPage.locator('[data-week="0"]').click();
    await secondPage.locator('#expenseform [name="note"]').fill("Магазин Тест");
    assert.equal(
      await secondPage.locator("#weekMerchant").inputValue(),
      merchantId,
    );
    await secondPage.locator('#expenseform [name="note"]').fill("Магни");
    assert.equal(await secondPage.locator("#weekMerchant").inputValue(), "");
    assert.match(
      await secondPage.locator("#weekMerchantHint").textContent(),
      /Магнит/,
    );
    await secondPage.locator("#weekMerchant").selectOption("b-magnit");
    await secondPage.locator('#expenseform [name="amount"]').fill("10");
    await secondPage.locator("#expenseform button.primary").click();
    await secondPage.waitForFunction(
      () => !document.querySelector('#expenseform [name="amount"]').value,
    );
    await secondPage.locator('#expenseform [name="note"]').fill("Магнит");
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
    await page.locator("#merchantName").fill("Обновлённый магазин");
    await page.locator("#merchantHidden").check();
    await page.locator("#merchantForm button[type=submit]").click();
    await page.locator("#merchantError").getByText("Сохранено").waitFor();
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
    await page.locator("#merchantName").fill("Другой магазин");
    await page.locator("#merchantAliases").fill("Магнит");
    await page.locator("#merchantForm button[type=submit]").click();
    await page.locator("#merchantError").getByText("Сохранено").waitFor();
    await page.locator("#merchantClose").click();
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
