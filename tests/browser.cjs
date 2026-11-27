const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const assert = require("node:assert/strict");
(async () => {
  const dir = "data/browser-test-" + Date.now();
  fs.mkdirSync(dir, { recursive: true });
  const server = spawn(
    "python",
    [
      "-c",
      `import server; server.budget.today_at=lambda: "2026-12-31"; from pathlib import Path; server.DB=Path('${dir}/test.sqlite3'); server.init(); server.ThreadingHTTPServer(('127.0.0.1',8001),server.Handler).serve_forever()`,
    ],
    { stdio: "pipe" },
  );
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await (await fetch("http://127.0.0.1:8001/")).text();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date("2026-11-27T12:00:00+05:00"));
    await page.goto("http://127.0.0.1:8001/");
    await page.locator("[name=login]").fill("browser-test");
    await page.locator("[name=password]").fill("browser-password-123");
    await page.locator("#register").click();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    await page.locator(".monthnav .picker-trigger").click();
    await page.locator('.picker[open] [data-value="2026-12"]').click();
    assert.equal(await page.locator('#weeks [aria-current="date"]').count(), 1);
    await page.locator(".monthnav .picker-trigger").click();
    await page.locator('.picker[open] [data-value="2026-11"]').click();
    assert.equal(
      await page.locator("#weeksTitle").textContent(),
      "Недели ноября",
    );
    await page.locator("#settingsOpen").click();
    await page.locator("#budget").fill("30000");
    await page.locator("#budgetform button").click();
    await page.waitForFunction(() =>
      document.querySelector("#total").textContent.includes("30"),
    );
    await page.locator("#tab-overview").click();
    const prepareExpense = async (date, amount, note) => {
      await page.locator("#quickopen").click();
      await page.locator("#quicktext").fill(`${date} продукты ${amount}`);
      await page.locator("#quickparse button").click();
      await page.locator("#quickrows [data-field=note]").fill(note);
      assert.equal(await page.locator("#quicksubmit").isEnabled(), true);
    };
    const saveExpense = async () => {
      await page.locator("#quicksubmit").click();
      await page.locator("#quickdialog").waitFor({ state: "hidden" });
    };
    await prepareExpense("2026-11-09", "459,90", "Супермаркеты <тест>");
    await saveExpense();
    assert.match(
      await page.locator("#history").textContent(),
      /Супермаркеты <тест>/,
    );
    let releaseSession;
    const sessionGate = new Promise((resolve) => (releaseSession = resolve));
    let sessionRequested;
    const sessionRequest = new Promise(
      (resolve) => (sessionRequested = resolve),
    );
    await page.route("**/api/state", async (route) => {
      sessionRequested();
      await sessionGate;
      await route.continue();
    });
    await page.reload();
    await sessionRequest;
    assert.equal(await page.locator("#auth").isVisible(), false);
    assert.equal(await page.locator("#dashboard").isVisible(), false);
    assert.equal(await page.locator("#sessionLoading").isVisible(), true);
    releaseSession();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    assert.equal(await page.locator("#sessionLoading").isVisible(), false);
    await page.unroute("**/api/state");
    assert.equal(await page.locator("#history .entry").count(), 1);
    assert.equal(
      await page
        .locator("img")
        .evaluateAll((els) =>
          els.every((i) => i.complete && i.naturalWidth > 0),
        ),
      true,
    );
    await page.screenshot({ path: dir + "/desktop.png", fullPage: true });
    for (const width of [390, 360, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "dashboard overflow " + width,
      );
      await page.locator('[data-week="1"]').click();
      assert.equal(
        await page
          .locator("#weekdialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
        "dialog overflow " + width,
      );
      const weekDialog = page.locator("#weekdialog");
      assert.equal(await weekDialog.locator("form").count(), 2);
      assert.deepEqual(await weekDialog.locator("summary").allTextContents(), [
        "Изменить лимит недели",
        "Закрыть неделю",
      ]);
      assert.equal(await weekDialog.locator("details[open]").count(), 0);
      assert.match(
        await weekDialog.locator("#closenote").textContent(),
        /Сначала закройте неделю 1/,
      );
      assert.equal(await weekDialog.locator("#closenote").isVisible(), true);
      await weekDialog.getByText("Изменить лимит недели").click();
      assert.equal(await weekDialog.locator("#limit").isVisible(), true);
      await page.screenshot({
        path: dir + "/mobile-" + width + ".png",
        fullPage: true,
      });
      await page.locator("#dismiss").click();
    }
    await page.locator("#tab-history").click();
    await page.locator('[data-history-scale="week"]').click();
    const historyPeriod = page.locator("#historyPeriod");
    for (let i = 0; i < 2; i++) {
      const previousPeriod = await historyPeriod.textContent();
      await page.locator("#historyNext").click();
      await page.waitForFunction(
        (text) => document.querySelector("#historyPeriod").textContent !== text,
        previousPeriod,
      );
    }
    await page.locator("#history .entry").first().waitFor();
    assert.equal(await page.locator("#history .entry").count(), 1);
    const filteredAmount = await page
      .locator("#history .entry strong")
      .textContent();
    assert.equal(
      await page.locator(".entry-day-total:visible").textContent(),
      filteredAmount,
    );
    await page.locator('[data-history-scale="month"]').click();
    await page.locator("#tab-overview").click();
    await page.locator('[data-week="1"]').click();
    assert.equal(
      await page.locator("#weekCloseAction").getAttribute("aria-disabled"),
      "true",
    );
    assert.equal(await page.locator("#closeform").isVisible(), false);
    assert.equal(await page.locator("#closenote").isVisible(), true);
    const blocked = await page.evaluate(async () => {
      const before = await fetch("/api/state").then((r) => r.json());
      const r = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          revision: before.revision,
          action: {
            type: "close",
            month: "2026-11",
            week: 1,
            mode: "remaining",
          },
        }),
      });
      const after = await fetch("/api/state").then((r) => r.json());
      return {
        status: r.status,
        unchanged: JSON.stringify(before) === JSON.stringify(after),
      };
    });
    assert.deepEqual(blocked, { status: 400, unchanged: true });
    await page.locator("#dismiss").click();
    await prepareExpense("2026-11-01", "8500", "Продукты");
    await saveExpense();
    await page.locator('[data-week="0"]').click();
    assert.equal(await page.locator("#weekdialog details[open]").count(), 0);
    await page.getByText("Изменить лимит недели", { exact: true }).click();
    assert.equal(await page.locator("#limit").inputValue(), "8000");
    await page.locator("#limit").fill("8100");
    await page.locator("#limitform button").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#weekDetailLimit").textContent === money(810000),
    );
    assert.equal(
      await page
        .locator('[data-week="0"].is-over-budget progress')
        .getAttribute("value"),
      "100",
    );
    await page.getByText("Закрыть неделю", { exact: true }).click();
    await page.locator("#closeform .picker-trigger").click();
    await page.locator('.picker[open] [data-option="1"]').click();
    await page.locator("#closeform>button").click();
    await page.waitForFunction(
      () => document.querySelector("#weekeditable").hidden,
    );
    assert.match(await page.locator("#weektitle").textContent(), /закрыта/);
    const overspent = (
      await page.evaluate(() => fetch("/api/state").then((r) => r.json()))
    ).state.months["2026-11"];
    assert.equal(overspent.weeks[0].limit, 810000);
    assert.equal(overspent.weeks[0].settled, 850000);
    assert.equal(
      overspent.weeks.slice(1).reduce((s, w) => s + w.limit, 0),
      3000000 - 850000,
    );
    await page.locator("#dismiss").click();
    const before = (
      await page.evaluate(() => fetch("/api/state").then((r) => r.json()))
    ).state.months["2026-11"];
    await page.locator('[data-week="1"]').click();
    await page.getByText("Закрыть неделю", { exact: true }).click();
    await page.locator("#closeform .picker-trigger").click();
    assert.equal(await page.locator(".picker[open] [data-option]").count(), 2);
    await page.locator('.picker[open] [data-option="0"]').click();
    await page.locator("#closeform>button").click();
    await page.waitForFunction(
      () => document.querySelector("#weekeditable").hidden,
    );
    const after = (
      await page.evaluate(() => fetch("/api/state").then((r) => r.json()))
    ).state.months["2026-11"];
    assert.equal(
      after.weeks[2].limit,
      before.weeks[2].limit + before.weeks[1].limit - 45990,
    );
    assert.deepEqual(after.weeks.slice(3), before.weeks.slice(3));
    // Closed weeks allow only category corrections, without reopening.
    assert.equal(await page.locator("#reopen").count(), 0);
    const historical = after.expenses.find((expense) => expense.week === 1);
    await page.locator("#dismiss").click();
    await page.locator("#tab-history").click();
    await page.locator(`#history [data-expense-id="${historical.id}"]`).click();
    assert.equal(
      await page.locator("#expenseDetailsDelete").isDisabled(),
      true,
    );
    await page.locator("#expenseDetailsEdit").click();
    assert.equal(
      await page.locator("#expenseCategory").inputValue(),
      historical.category,
    );
    await page.locator("#expenseCategory").selectOption("Кофейни");
    await page.locator("#categoryEditorForm > button").click();
    await page.locator("#categoryEditor").waitFor({ state: "hidden" });
    const corrected = (
      await page.evaluate(() => fetch("/api/state").then((r) => r.json()))
    ).state.months["2026-11"];
    assert.deepEqual(corrected.weeks, after.weeks);
    assert.deepEqual(
      corrected.expenses.find((expense) => expense.id === historical.id),
      {
        ...historical,
        category: "Кофейни",
      },
    );
    await page.locator("#tab-overview").click();
    // Lost response in a still-open week must not duplicate the expense.
    await prepareExpense("2026-11-16", "123,45", "Проверка повтора");
    let lost = false;
    await page.route("**/api/action", async (route) => {
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await saveExpense();
    assert.equal(
      await page
        .locator("#history .entry")
        .filter({ hasText: "Проверка повтора" })
        .count(),
      1,
    );
    await page.unroute("**/api/action");
    // Global add ignores the month currently on screen; batch spans months.
    await page.locator("#quickopen").click();
    await page.locator("#quicktext").fill("2026-11-01 кофе 250");
    await page.locator("#quickparse button").click();
    assert.equal(await page.locator("#quicksubmit").isDisabled(), true);
    assert.match(
      await page.locator("#quickrows").textContent(),
      /Неделя закрыта/,
    );
    await page
      .locator("#quicktext")
      .fill("2026-11-16 кофе 250; 2026-12-01 продукты 850,50");
    await page.locator("#quickparse button").click();
    assert.equal(await page.locator(".quick-row").count(), 2);
    const firstRow = page.locator(".quick-row").first();
    await firstRow
      .locator("label")
      .filter({ has: page.locator("[data-field=date]") })
      .locator(".picker-trigger")
      .click();
    await page.locator('.picker[open] [data-month-move="1"]').click();
    assert.match(
      await page.locator(".picker[open] .picker-head").textContent(),
      /Декабрь 2026/,
    );
    await page.locator('.picker[open] [data-month-move="-1"]').click();
    await page.locator('.picker[open] [data-value="2026-11-17"]').click();
    assert.equal(
      await firstRow.locator("[data-field=date]").inputValue(),
      "2026-11-17",
    );
    await firstRow.locator(".select-trigger").click();
    await page
      .locator(".picker[open] [data-option]")
      .filter({ hasText: "Рестораны" })
      .click();
    assert.equal(
      await firstRow.locator("[data-field=category]").inputValue(),
      "Рестораны",
    );
    await firstRow.locator(".select-trigger").click();
    await page
      .locator(".picker[open] [data-option]")
      .filter({ hasText: "Кофейни" })
      .click();
    for (const width of [320, 360, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page
          .locator("#quickdialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
        "quick dialog overflow " + width,
      );
      for (const picker of [
        firstRow.locator(".select-trigger"),
        firstRow
          .locator("label")
          .filter({ has: page.locator("[data-field=date]") })
          .locator(".picker-trigger"),
      ]) {
        await picker.click();
        assert.equal(
          await page
            .locator(".picker[open]")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
          true,
          "quick picker overflow " + width,
        );
        await page.locator(".picker[open] .picker-cancel").click();
      }
    }
    await page
      .locator(".quick-row")
      .first()
      .locator("[data-field=remember]")
      .check();
    let batchLost = false;
    await page.route("**/api/action", async (route) => {
      if (!batchLost) {
        batchLost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page.locator("#quicksubmit").click();
    await page.locator("#quickdialog").waitFor({ state: "hidden" });
    await page.unroute("**/api/action");
    const result = await page.evaluate(() =>
      fetch("/api/state").then((r) => r.json()),
    );
    assert.equal(
      result.state.months["2026-11"].expenses.filter((e) => e.note === "Кофе")
        .length,
      1,
    );
    assert.equal(result.state.months["2026-12"].expenses[0].amount, 85050);
    await page.locator("#quickopen").click();
    await page.locator("#quickrules").evaluate((el) => (el.open = true));
    assert.match(await page.locator("#rulelist").textContent(), /кофе/);
    await page.locator("#rulelist .select-trigger").click();
    await page
      .locator(".picker[open] [data-option]")
      .filter({ hasText: "Рестораны" })
      .click();
    assert.equal(
      await page.locator("#rulelist select").inputValue(),
      "Рестораны",
    );
    await page.locator("#rulelist [data-rule]").click();
    assert.match(
      await page.locator("#rulelist").textContent(),
      /Нет сохранённых правил/,
    );
    await page.locator("#quickclose").click();
    // Both replies lost: resume the same pending batch after a reload.
    await page.locator("#quickopen").click();
    await page.locator("#quicktext").fill("2026-12-02 кофе 123");
    await page.locator("#quickparse button").click();
    await page.route("**/api/action", async (route) => {
      await route.fetch();
      await route.abort("failed");
    });
    await page.locator("#quicksubmit").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#quickerror")
        .textContent.includes("Результат пока неизвестен"),
    );
    await page.unroute("**/api/action");
    await page.reload();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    await page.locator("#quickopen").click();
    await page.locator("#quicksubmit").click();
    await page.locator("#quickdialog").waitFor({ state: "hidden" });
    const recovered = await page.evaluate(() =>
      fetch("/api/state").then((r) => r.json()),
    );
    assert.equal(
      recovered.state.months["2026-12"].expenses.filter(
        (e) => e.amount === 12300,
      ).length,
      1,
    );
    // Stale preview cannot save an older interpretation after text edits.
    await page.locator("#quickopen").click();
    await page.locator("#quicktext").fill("2026-12-03 кофе 250");
    await page.locator("#quickparse button").click();
    await page.locator("#quicktext").fill("2026-12-03 кофе 350");
    assert.equal(await page.locator("#quicksubmit").isDisabled(), true);
    assert.match(
      await page.locator("#quickerror").textContent(),
      /Текст изменился/,
    );
    await page.locator("#quickparse button").click();
    assert.equal(await page.locator("#quicksubmit").isEnabled(), true);
    const dialogCount = await page.locator(".picker").count();
    for (let i = 0; i < 3; i++)
      await page.locator("#quickparse button").click();
    assert.equal(
      await page.locator(".picker").count(),
      dialogCount,
      "dynamic pickers must be disposed",
    );
    // Another tab changes the budget between preview and commit.
    const conflictBefore = await page.evaluate(async () => {
      const v = await fetch("/api/state").then((r) => r.json());
      const r = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: v.revision,
          operationId: crypto.randomUUID(),
          action: { type: "budget", month: "2026-12", amount: 100000 },
        }),
      });
      return r.json();
    });
    await page.locator("#quicksubmit").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#saveStatus").textContent ===
        "Изменение не сохранено",
    );
    assert.equal(
      (await page.evaluate(() => fetch("/api/state").then((r) => r.json())))
        .revision,
      conflictBefore.revision,
    );
    assert.equal(await page.locator("#quicksubmit").isEnabled(), true);
    // Conflicting personal rules for the same description need resolution.
    await page
      .locator("#quicktext")
      .fill("2026-12-03 кофе 250; 2026-12-03 кофе 300");
    await page.locator("#quickparse button").click();
    await page.locator(".quick-row [data-field=remember]").first().check();
    await page.locator(".quick-row [data-field=remember]").last().check();
    await page.locator(".quick-row .select-trigger").last().click();
    await page
      .locator(".picker[open] [data-option]")
      .filter({ hasText: "Рестораны" })
      .click();
    assert.equal(await page.locator("#quicksubmit").isDisabled(), true);
    assert.match(
      await page.locator("#quickerror").textContent(),
      /разные правила/,
    );
    await page.locator(".quick-row [data-field=remember]").last().uncheck();
    assert.equal(await page.locator("#quicksubmit").isEnabled(), true);
    // Unparsed fragments stay visible and block the complete batch.
    await page.locator("#quicktext").fill("2026-11-16 кофе 250, без суммы");
    await page.locator("#quickparse button").click();
    assert.equal(await page.locator(".quick-row").count(), 2);
    assert.equal(await page.locator("#quicksubmit").isDisabled(), true);
    await page.locator('[data-remove="1"]').click();
    assert.equal(await page.locator("#quicksubmit").isEnabled(), true);
    // Malformed browser rules are ignored; user descriptions stay text.
    await page.evaluate(() =>
      localStorage.setItem("expense-rules:browser-test", "null"),
    );
    await page.locator("#quickclose").click();
    await page.locator("#quickopen").click();
    await page
      .locator("#quicktext")
      .fill("<img src=x onerror=alert(1)> кофе 250");
    await page.locator("#quickparse button").click();
    assert.equal(await page.locator("#quickrows img[src=x]").count(), 0);
    assert.match(await page.locator(".quick-row .raw").textContent(), /<img/);
    // Over-limit batches and blank text cannot accidentally submit.
    await page.locator("#quicktext").fill(Array(51).fill("кофе 250").join(";"));
    await page.locator("#quickparse button").click();
    assert.equal(await page.locator("#quicksubmit").isDisabled(), true);
    await page.locator("#quicktext").fill("   ");
    await page.locator("#quickparse button").click();
    assert.equal(await page.locator(".quick-row").count(), 0);
    assert.equal(await page.locator("#quicksave").isVisible(), false);
    await page.locator("#quickclose").click();
    // Custom interactive calendar controls category bars across months.
    await page.locator("#tab-analytics").click();
    if (!(await page.locator("#analysisFilters").evaluate((el) => el.open)))
      await page.locator("#analysisFilters > summary").click();
    await page.locator("#analyticsControls .select-trigger").click();
    await page.locator('.picker[open] [data-option="3"]').click();
    await page.locator("#analysisFrom + .picker-trigger").click();
    await page.locator('.picker[open] [data-value="2026-11-01"]').click();
    await page.locator("#analysisTo + .picker-trigger").click();
    await page.locator('.picker[open] [data-month-move="1"]').click();
    await page.locator('.picker[open] [data-value="2026-12-31"]').click();
    assert.ok((await page.locator(".category-row").count()) > 0);
    const categoryAmounts = page.locator(".category-row-title strong");
    const amountsBeforeFiltering = await categoryAmounts.allTextContents();
    await page.locator(".chart-legend").first().click();
    assert.equal(
      await page.locator('.chart-legend[aria-pressed="true"]').count(),
      1,
    );
    const category = await page
      .locator(".category-row")
      .last()
      .getAttribute("data-chart-category");
    await page.locator(".category-row").last().click();
    assert.equal(
      await page
        .locator('.category-row[aria-pressed="true"]')
        .getAttribute("data-chart-category"),
      category,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.chartCategory),
      category,
      "category filtering preserves keyboard focus",
    );
    assert.deepEqual(
      await categoryAmounts.allTextContents(),
      amountsBeforeFiltering,
      "category structure retains full-period context",
    );
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "analytics overflow " + width,
      );
    }
    // The same three sections are available at both viewport sizes.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#mobileTabs").waitFor({ state: "visible" });
    assert.equal(await page.locator("#mobileTabs").isVisible(), true);
    assert.equal(await page.locator("#quickopen").isVisible(), true);
    assert.equal(
      await page.locator("#mobileTabs").evaluate((nav) => {
        const tab = nav.querySelector("#tab-analytics"),
          r = tab.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("#tab-analytics") === tab;
      }),
      true,
    );
    for (const section of ["overview", "history", "analytics"]) {
      await page.locator("#tab-" + section).click();
      assert.equal(await page.locator("#panel-" + section).isVisible(), true);
      assert.equal(await page.locator("[data-nav-panel]:not([hidden])").count(), 1);
      if (section === "analytics") continue;
      const launcher = page.locator(
        section === "history" ? "#historyQuickopen" : "#quickopen",
      );
      await launcher.click();
      await page.locator("#quickdialog").waitFor({ state: "visible" });
      await page.locator("#quickclose").click();
    }
    await page.locator("#settingsOpen").click();
    assert.equal(await page.locator("#panel-budget").isVisible(), true);
    assert.equal(await page.locator("#merchantOpen").isVisible(), true);
    await page.locator("#settingsOpen").focus();
    const tabStops = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      tabStops.push(await page.evaluate(() => document.activeElement.id));
      if (tabStops.at(-1) === "tab-overview") break;
    }
    assert.ok(tabStops.includes("tab-overview"), "Overview remains keyboard reachable from settings");
    await page.locator("#tab-history").click();
    assert.equal(await page.locator("#history .entry button").count(), 0);
    assert.equal(await page.locator("#historyQuickopen").isVisible(), true);
    assert.match(
      await page.locator("#history time").first().textContent(),
      /ноября/,
    );
    const firstExpense = page.locator("#history [data-expense-id]").first();
    await firstExpense.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#expenseDetailsDate").getAttribute("datetime"),
      await firstExpense.locator("..").locator("time").getAttribute("datetime"),
    );
    assert.equal(
      await page.locator("#expenseDetails").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.left >= 0 &&
          r.right <= innerWidth &&
          r.top >= 0 &&
          r.bottom <= innerHeight
        );
      }),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#expenseDetails").isVisible(), false);
    assert.equal(
      await firstExpense.evaluate((el) => el === document.activeElement),
      true,
    );
    await page.screenshot({
      path: dir + "/mobile-history-compact.png",
      fullPage: true,
    });
    assert.match(
      await page.evaluate(() => expenseDate("2025-11-07", todayDate())),
      /2025/,
    );
    // Deletion from the details dialog remains available for an open week.
    await page.locator('[data-history-scale="month"]').click();
    const removable = await page.evaluate(
      () =>
        state.months["2026-11"].expenses.find((e) => e.date === "2026-11-17")
          .id,
    );
    await page.locator(`#history [data-expense-id="${removable}"]`).click();
    assert.equal(await page.locator("#expenseDetailsDelete").isEnabled(), true);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#expenseDetailsDelete").click();
    await page.waitForFunction(
      (id) => !state.months["2026-11"].expenses.some((e) => e.id === id),
      removable,
    );
    await page.locator("#tab-overview").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#tab-history").getAttribute("aria-selected"),
      "true",
    );
    await page.locator("#tab-analytics").click();
    assert.ok((await page.locator(".category-row").count()) > 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".trend-plot")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    assert.equal(
      await page
        .locator(".trend-bar")
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
    await page.screenshot({
      path: dir + "/mobile-analytics-tabs.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await page.locator("#panel-analytics").isVisible(), true);
    assert.equal(await page.locator("#mobileTabs").isVisible(), true);
    await page.locator("#tab-overview").click();
    assert.equal(await page.locator("#panel-overview").isVisible(), true);
    assert.equal(await page.locator("#panel-history").isVisible(), false);
    assert.equal(await page.locator("#panel-budget").isVisible(), false);
    assert.equal(await page.locator("#panel-analytics").isVisible(), false);
    assert.equal(await page.locator("#quickopen").isVisible(), true);
    await page.evaluate(() =>
      localStorage.setItem(
        "expense-rules:browser-test",
        JSON.stringify({ магнит: "Продукты" }),
      ),
    );
    await page.locator("#quickopen").click();
    await page.locator("#quicktext").fill("Магнит 123");
    await page.locator("#quickparse button").click();
    const ordering = await page
      .locator(".quick-row select")
      .first()
      .evaluate((el) =>
        Array.from(el.options)
          .map((o) => o.value)
          .filter(Boolean),
      );
    const expectedOrdering = await page.evaluate(() =>
      CategoryUtils.rank(cats, state),
    );
    assert.deepEqual(ordering, expectedOrdering);
    assert.equal(ordering.includes("Продукты"), false);
    assert.equal(
      await page.locator(".quick-row select").first().inputValue(),
      "Супермаркеты",
    );
    assert.equal(
      await page.locator("#rulelist select").first().inputValue(),
      "Супермаркеты",
    );
    await page.locator("#quickclose").click();
    assert.deepEqual(errors, []);
    console.log(
      "Browser checks passed: auth, expense, reload, icons, desktop, mobile 390/360/320, next-week closure. Screenshots: " +
        dir,
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
