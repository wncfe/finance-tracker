const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const dir = "data/analytics-browser-" + Date.now();
  fs.mkdirSync(dir, { recursive: true });
  const server = spawn(
    "python",
    [
      "-X",
      "utf8",
      "-c",
      `import server; from pathlib import Path; server.DB=Path('${dir}/test.sqlite3'); server.budget.today_at=lambda:'2026-11-13'; server.init(); server.ThreadingHTTPServer(('127.0.0.1',8003),server.Handler).serve_forever()`,
    ],
    { stdio: "pipe" },
  );
  let browser;
  const logs = [];
  server.stderr.on("data", (b) => logs.push(String(b)));
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await (await fetch("http://127.0.0.1:8003/api/config")).text();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        timezoneId: "America/New_York",
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        window.cspViolations.push(e.violatedDirective),
      );
    });
    await page.goto("http://127.0.0.1:8003/");
    await page.locator("[name=login]").fill("analytics-test");
    await page.locator("[name=password]").fill("analytics-password-123");
    await page.locator("#register").click();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    await page.evaluate(async () => {
      let revision = 0;
      async function action(action) {
        const r = await fetch("/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision,
            operationId: crypto.randomUUID(),
            action,
          }),
        });
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        revision = b.revision;
      }
      for (const month of ["2026-08", "2026-09", "2026-10", "2026-11"])
        await action({ type: "budget", month, amount: 1000000 });
      const items = [];
      for (
        let d = new Date("2026-08-01T12:00:00Z");
        d.toISOString().slice(0, 10) <= "2026-11-13";
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        const date = d.toISOString().slice(0, 10);
        items.push({ date, amount: 10000, category: "Кофейни", note: "кофе" });
        if (d.getUTCDay() === 1)
          items.push({
            date,
            amount: 20000,
            category: "Супермаркеты",
            note: "Продукты <тест>",
          });
      }
      items.push({
        date: "2026-11-13",
        amount: 500000,
        category: "Покупки",
        note: "Ноутбук",
      });
      for (let i = 0; i < items.length; i += 50)
        await action({ type: "expenses", items: items.slice(i, i + 50) });
    });
    await page.reload();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => todayDate()), "2026-11-13");
    await page.locator("#month").evaluate((el) => {
      el.value = "2026-11";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.match(
      await page.locator('[data-week="2"]').textContent(),
      /Ожидаемый остаток/,
    );
    await page.locator('[data-week="2"]').click();
    assert.match(await page.locator("#weekforecast").textContent(), /История/);
    assert.equal(
      await page.locator("#expenseform [name=date]").getAttribute("max"),
      "2026-11-13",
    );
    await page.locator("#dismiss").click();
    await page.locator("#tab-analytics").click();
    assert.equal(await page.locator("#panel-analytics").isVisible(), true);
    assert.equal(await page.locator("#panel-overview").isVisible(), false);
    assert.equal(await page.locator("#trendChart svg").count(), 1);
    assert.ok((await page.locator("#habits [data-habit]").count()) > 0);
    assert.ok((await page.locator("#anomalies [data-anomaly]").count()) > 0);
    const chooseBucket = async (locator) => {
      await page.locator('[data-trend-mode="daily"]').focus();
      await locator.focus();
    };
    assert.equal(await page.locator("#spendingPace").isVisible(), true);
    assert.match(
      await page.locator("#paceHeadline").textContent(),
      /Без исторического сравнения/,
    );
    assert.equal(await page.locator(".pace-reference").count(), 0);
    await page.locator('[data-bucket="12"]').click();
    assert.equal(
      await page.locator("#analysisDetails").isVisible(),
      true,
      "click on a bar opens its operations",
    );
    await page.keyboard.press("Escape");
    const ratios = await page
      .locator(".category-bar-track > span")
      .evaluateAll((bars) =>
        bars.map(
          (b) =>
            b.getBoundingClientRect().width /
            b.parentElement.getBoundingClientRect().width,
        ),
      );
    assert.ok(
      ratios[0] > ratios[1] && ratios[1] > ratios[2],
      "category bars must reflect real shares under CSP",
    );
    assert.ok(Math.abs(ratios[0] - 5000 / 6700) < 0.01);
    await chooseBucket(page.locator('[data-bucket="12"]'));
    await page.locator('[data-bucket="10"]').hover();
    assert.equal(
      await page.locator('[data-bucket="12"]').getAttribute("aria-pressed"),
      "true",
      "hover does not change the chosen day",
    );
    await page.locator("#trendTitle").hover();
    assert.match(await page.locator("#trendSelection").textContent(), /5\s100/);
    await chooseBucket(page.locator('[data-bucket="12"]'));
    assert.equal(await page.locator("#trendTooltip").isVisible(), true);
    await page.keyboard.press("ArrowLeft");
    assert.match(
      await page.locator("#trendSelection").textContent(),
      /12.11.2026/,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#trendTooltip").isVisible(), false);
    await chooseBucket(page.locator('[data-bucket="12"]'));
    await page.locator("#openTrendOperations").click();
    assert.match(
      await page.locator("#analysisDetailsBody").textContent(),
      /Ноутбук/,
    );
    await page.keyboard.press("Escape");
    await page.locator("#habits [data-habit]").first().click();
    assert.match(
      await page.locator("#analysisDetailsBody").textContent(),
      /кофе/,
    );
    await page.keyboard.press("Escape");
    await page.locator("#habits [data-sim-habit]").first().click();
    assert.equal(await page.locator("#simulatorDialog").isVisible(), true);
    await page.keyboard.press("Escape");
    await page.locator("#trendReference").evaluate((el) => {
      el.value = "previous";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#toggleTrendComparison").click();
    assert.equal(await page.locator(".chart-prior").count(), 1);
    await chooseBucket(page.locator('[data-bucket="12"]'));
    assert.match(
      await page.locator(".selected-comparison").textContent(),
      /13.10.2026/,
    );
    assert.match(
      await page.locator(".selected-comparison").textContent(),
      /100/,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.screenshot({
      path: dir + "/analytics-comparison-1440.png",
      fullPage: true,
    });
    await page.locator("#openPriorOperations").click();
    assert.match(
      await page.locator("#analysisDetailsTitle").textContent(),
      /13.10.2026/,
    );
    assert.doesNotMatch(
      await page.locator("#analysisDetailsBody").textContent(),
      /Ноутбук/,
    );
    await page.keyboard.press("Escape");
    await page.locator("#toggleTrendComparison").click();
    const singleHabit = await page
      .locator("#habits .habit-card")
      .first()
      .boundingBox();
    const habitGrid = await page.locator("#habits").boundingBox();
    assert.ok(
      Math.abs(singleHabit.width - habitGrid.width) < 2 &&
        singleHabit.height < 280,
      "one habit uses a compact full-width layout",
    );
    const total = await page.evaluate(() =>
      money(
        ExpenseAnalytics.summarize(state, {
          from: "2026-11-01",
          to: "2026-11-13",
        }).total,
      ),
    );
    assert.match(
      await page.locator("#analysisMetrics").textContent(),
      new RegExp(total.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    await page.locator('#heatmap [data-day="2026-11-13"]').click();
    assert.match(
      await page.locator("#analysisDetailsBody").textContent(),
      /Ноутбук/,
    );
    await page.locator('[data-close="analysisDetails"]').click();
    await page.locator("#analysisCategory").evaluate((el) => {
      el.value = "Кофейни";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(
      await page.locator('.chart-legend[aria-pressed="true"]').count(),
      1,
    );
    await page.locator('#heatmap [data-day="2026-11-13"]').click();
    assert.doesNotMatch(
      await page.locator("#analysisDetailsBody").textContent(),
      /Ноутбук/,
    );
    await page.locator('[data-close="analysisDetails"]').click();
    assert.match(
      await page.locator("#anomalies").textContent(),
      /Заметных отклонений не нашли/,
    );
    await page.locator("#openReport").click();
    assert.match(
      await page.locator("#reportBody").textContent(),
      /ПРОМЕЖУТОЧНЫЕ ИТОГИ/,
    );
    let releaseAction;
    const waitForRelease = new Promise((resolve) => {
      releaseAction = resolve;
    });
    await page.route("**/api/action", async (route) => {
      await waitForRelease;
      await route.continue();
    });
    const changing = page.evaluate(async () => {
      const e = state.months["2026-11"].expenses.find(
        (e) => e.note === "Ноутбук",
      );
      await mutate({
        type: "recategorize",
        month: "2026-11",
        week: e.week,
        id: e.id,
        category: "Кофейни",
      });
      return e.id;
    });
    try {
      await page.locator("#analysisUpdateStatus").waitFor({ state: "visible" });
      assert.equal(
        await page.locator("#analysisContent").getAttribute("aria-busy"),
        "true",
      );
    } finally {
      releaseAction();
    }
    const changed = await changing;
    await page.unroute("**/api/action");
    assert.equal(
      await page.locator("#analysisUpdateStatus").isVisible(),
      false,
    );
    assert.equal(
      await page.locator("#analysisContent").getAttribute("aria-busy"),
      "false",
    );
    assert.doesNotMatch(
      await page.locator("#reportBody").textContent(),
      /Покупки/,
    );
    await page.evaluate(async (id) => {
      const e = state.months["2026-11"].expenses.find((e) => e.id === id);
      await mutate({
        type: "recategorize",
        month: "2026-11",
        week: e.week,
        id,
        category: "Покупки",
      });
    }, changed);
    assert.match(await page.locator("#reportBody").textContent(), /Покупки/);
    await page.locator('[data-close="reportDialog"]').click();
    await page.locator("#openSimulator").click();
    assert.equal(
      await page.locator("#simulationMonth").inputValue(),
      "2026-10",
    );
    await page.locator("#simulationForm button[type=submit]").click();
    assert.match(
      await page.locator("#simulationResult").textContent(),
      /Потенциальная экономия/,
    );
    assert.equal(await page.locator("[data-remove-scenario]").count(), 1);
    await page.locator('[data-close="simulatorDialog"]').click();
    await page.locator("#quickopen").click();
    await page.locator("#quicktext").fill("14 ноября кофе 250");
    await page.locator("#quickparse button").click();
    assert.equal(await page.locator("#quicksubmit").isDisabled(), true);
    assert.match(await page.locator("#quickrows").textContent(), /будущем/);
    await page.locator("#quickclose").click();
    const future = await page.evaluate(async () => {
      const before = await (await fetch("/api/state")).json();
      const r = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          revision: before.revision,
          action: {
            type: "expenses",
            items: [
              { date: "2026-11-13", amount: 100, category: "Кофейни" },
              { date: "2026-11-14", amount: 100, category: "Кофейни" },
            ],
          },
        }),
      });
      const after = await (await fetch("/api/state")).json();
      return {
        status: r.status,
        same: JSON.stringify(before.state) === JSON.stringify(after.state),
        revision: before.revision === after.revision,
      };
    });
    assert.deepEqual(future, { status: 400, same: true, revision: true });
    await page.locator("#analysisCategory").evaluate((el) => {
      el.value = "";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#heatmapMode").evaluate((el) => {
      el.value = "year";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(await page.locator(".heatmap-month").count(), 0);
    assert.equal(await page.locator(".year-grid [data-day]").count(), 365);
    assert.ok(
      await page
        .locator("#calendarPanel")
        .evaluate((el) => el.clientHeight < 400),
      "annual heatmap stays compact",
    );
    await page.locator('.year-grid [data-day="2026-11-13"]').focus();
    await page.keyboard.press("ArrowLeft");
    assert.match(
      await page.locator("#heatmapDayPreview").textContent(),
      /06.11.2026/,
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#analysisDetails").isVisible(), true);
    await page.keyboard.press("Escape");
    const yearWidths = await page.evaluate(() => [
      document.querySelector("#calendarPanel").clientWidth,
      document.querySelector(".observations-panel").clientWidth,
    ]);
    assert.ok(
      Math.abs(yearWidths[0] - yearWidths[1]) < 2,
      "year calendar and observations each use the full row",
    );
    await page.screenshot({
      path: dir + "/analytics-year-1440.png",
      fullPage: true,
    });
    await page
      .locator("#calendarPanel")
      .screenshot({ path: dir + "/annual-heatmap.png" });
    await page.setViewportSize({ width: 320, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.locator("#heatmapMode").evaluate((el) => {
      el.value = "month";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator('#heatmap [data-day="2026-11-13"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#analysisDetails").isVisible(), true);
    await page.keyboard.press("Escape");
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator("#tab-analytics").click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "overflow " + width,
      );
      await page.locator("#toggleTrendComparison").click();
      await chooseBucket(page.locator("[data-bucket]").last());
      assert.equal(await page.locator("#trendTooltip").isVisible(), true);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "tooltip overflow " + width,
      );
      await page.keyboard.press("Escape");
      if (width === 390) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.screenshot({
          path: dir + "/analytics-comparison-390.png",
          fullPage: true,
        });
      }
      await page.locator("#toggleTrendComparison").click();
      await page.locator("#tab-analytics").focus();
      if (width <= 680) {
        assert.equal(
          await page.locator("#analysisFilters").getAttribute("open"),
          null,
        );
        await page.locator("#analysisFilters > summary").click();
        assert.equal(
          await page.locator("#analysisCategory + button").isVisible(),
          true,
        );
        await page.locator("#analysisFilters > summary").click();
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.screenshot({
        path: dir + "/analytics-" + width + ".png",
        fullPage: true,
      });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.locator("#openReport").click();
      assert.equal(
        await page
          .locator("#reportDialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page.locator('[data-close="reportDialog"]').click();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      window.paceFixtureBackup = JSON.stringify(state);
      for (const month of ["2026-08", "2026-09", "2026-10"])
        state.months[month].weeks.forEach((w) => (w.closed = true));
      state = { ...state };
      render();
    });
    assert.equal(await page.locator(".pace-reference").count(), 1);
    assert.match(
      await page.locator("#paceHeadline").textContent(),
      /Исторический ориентир.*3 месяца/,
    );
    const paceExpected = await page.evaluate(() =>
      ExpenseAnalytics.spendingPace(
        state,
        "2026-11",
        "2026-11-13",
        todayDate(),
      ),
    );
    assert.equal(paceExpected.actualTotal, 670000);
    assert.equal(
      paceExpected.expectedTotal,
      Math.round((170000 + 150000 + 170000) / 3),
    );
    assert.equal(
      paceExpected.delta,
      670000 - Math.round((170000 + 150000 + 170000) / 3),
    );
    await page.locator("[data-pace-category]").first().click();
    assert.match(
      await page.locator("#analysisDetailsBody").textContent(),
      /Ноутбук/,
    );
    await page.keyboard.press("Escape");
    await page.locator('[data-pace-day="13"]').focus();
    await page.keyboard.press("ArrowLeft");
    assert.match(
      await page.locator("#paceSelection").textContent(),
      /12.11.2026/,
    );
    await page.locator("#openPaceDay").click();
    assert.match(
      await page.locator("#analysisDetailsTitle").textContent(),
      /12.11.2026/,
    );
    await page.keyboard.press("Escape");
    await page.locator("#trendReference").evaluate((el) => {
      el.value = "historical";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#toggleTrendComparison").click();
    assert.equal(await page.locator(".historical-reference").count(), 1);
    await chooseBucket(page.locator('[data-bucket="12"]'));
    assert.match(
      await page.locator(".historical-selection").textContent(),
      /5\s000/,
    );
    assert.match(
      await page.locator("#trendSelection").textContent(),
      /Больше всего: Покупки/,
    );
    await page.locator('[data-trend-mode="cumulative"]').click();
    assert.equal(await page.locator(".trend-cumulative").count(), 1);
    assert.equal(await page.locator(".trend-bar").count(), 0);
    await chooseBucket(page.locator('[data-bucket="12"]'));
    assert.match(
      await page.locator(".historical-selection").textContent(),
      /5\s066,67/,
    );
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "pace overflow " +
          width +
          " " +
          (await page.evaluate(() =>
            JSON.stringify(
              [...document.querySelectorAll("#panel-analytics *")]
                .filter(
                  (el) => el.getBoundingClientRect().right > innerWidth + 1,
                )
                .map((el) => [
                  el.tagName,
                  el.id,
                  el.className,
                  Math.round(el.getBoundingClientRect().right),
                ])
                .slice(0, 8),
            ),
          )),
      );
      await page
        .locator("#mobileTabs")
        .evaluate((el) => (el.style.position = "static"));
      await page
        .locator("#spendingPace")
        .screenshot({ path: dir + `/pace-${width}.png` });
      await page
        .locator("#mobileTabs")
        .evaluate((el) => el.style.removeProperty("position"));
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++)
        state.months["2026-11"].expenses.push({
          id: `pace-extra-${i}`,
          date: "2026-11-12",
          amount: 100 * (i + 1),
          category: `Дополнительная категория ${i}`,
          note: "Тест плотной расшифровки",
        });
      state = { ...state };
      render();
    });
    assert.equal(
      await page.locator("#paceCategories > .pace-category").count(),
      3,
    );
    assert.equal(await page.locator(".pace-more").count(), 1);
    await page.locator(".pace-more > summary").click();
    assert.equal(
      await page.locator("#paceCategories .pace-category").count(),
      8,
    );
    await page.evaluate(() => {
      state.months["2026-11"].expenses = state.months[
        "2026-11"
      ].expenses.filter((e) => !e.id.startsWith("pace-extra-"));
      state = { ...state };
      render();
    });
    const currentPaceRows = await page.evaluate(() =>
      JSON.stringify(state.months["2026-11"].expenses),
    );
    await page.evaluate(() => {
      state.months["2026-11"].expenses = state.months[
        "2026-11"
      ].expenses.filter((e) => e.category === "Кофейни");
      state = { ...state };
      render();
    });
    assert.match(
      await page.locator("#paceHeadline").textContent(),
      /Тратишь меньше обычного/,
    );
    assert.match(await page.locator("#paceHeadline").textContent(), /333,33/);
    await page
      .locator("#spendingPace")
      .screenshot({ path: dir + "/pace-below-1440.png" });
    await page.evaluate((rows) => {
      state.months["2026-11"].expenses = JSON.parse(rows);
      state = { ...state };
      render();
    }, currentPaceRows);
    await page.evaluate(() => {
      state.months["2026-09"].weeks[0].closed = false;
      state.months["2026-08"].weeks[0].closed = false;
      state = { ...state };
      render();
    });
    assert.match(
      await page.locator("#paceHeadline").textContent(),
      /Предварительно.*1 месяц/,
    );
    await page.locator("#paceWindow").evaluate((el) => {
      el.value = "12";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.match(
      await page.locator("#paceMethod").textContent(),
      /12 предыдущих/,
    );
    await page.evaluate(() => {
      state = JSON.parse(window.paceFixtureBackup);
      render();
    });
    await page.locator('[data-trend-mode="daily"]').click();
    await page.locator("#trendReference").evaluate((el) => {
      el.value = "previous";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Presentation stress cases are local to this isolated test account.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      for (let i = 0; i < 7; i++)
        state.months["2026-11"].expenses.push({
          id: `stress-${i}`,
          date: "2026-11-12",
          amount: 100 * (i + 1),
          category: `Очень длинное название категории ${i}`,
          note: "Проверка компоновки",
        });
      state = { ...state };
      render();
    });
    assert.equal(await page.locator(".category-row").count(), 5);
    await page.locator("#showAllCategories").click();
    assert.equal(await page.locator(".category-row").count(), 10);
    await page.locator(".category-row").last().click();
    assert.equal(
      await page.locator('.category-row[aria-pressed="true"]').count(),
      1,
    );
    assert.equal(
      await page.locator("#clearAnalysisCategory").isVisible(),
      true,
    );
    await page.locator("#showAllCategories").click();
    assert.equal(
      await page.locator('.category-row[aria-pressed="true"]').count(),
      1,
      "selected category stays visible outside top five",
    );
    await page.locator("#clearAnalysisCategory").click();
    assert.equal(await page.locator("#analysisCategory").inputValue(), "");
    await page.evaluate(() => {
      for (let h = 0; h < 5; h++)
        for (const date of ["2026-11-01", "2026-11-05", "2026-11-09"])
          state.months["2026-11"].expenses.push({
            id: `habit-stress-${h}-${date}`,
            date,
            amount: 10000 * (h + 1),
            category: "Покупки",
            note: `Повторяющаяся покупка с длинным названием ${h}`,
          });
      state = { ...state };
      render();
    });
    assert.equal(await page.locator(".habit-card").count(), 6);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "many habits overflow " + width,
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.screenshot({
        path: dir + `/analytics-dense-${width}.png`,
        fullPage: true,
      });
    }
    const setFilter = async (id, value) =>
      page.locator(`#${id}`).evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    await setFilter("analysisMode", "custom");
    await setFilter("analysisFrom", "2026-08-01");
    await setFilter("analysisTo", "2026-11-13");
    assert.ok((await page.locator("[data-bucket]").count()) <= 90);
    await chooseBucket(page.locator("[data-bucket]").first());
    await page.locator("#openTrendOperations").click();
    assert.match(
      await page.locator("#analysisDetailsTitle").textContent(),
      /01.08.2026 — 02.08.2026/,
    );
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 1000 });
    if (!(await page.locator("#analysisFilters").evaluate((el) => el.open)))
      await page.locator("#analysisFilters > summary").click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "custom period overflow",
    );
    await setFilter("analysisFrom", "2026-11-13");
    await setFilter("analysisTo", "2026-11-01");
    assert.equal(await page.locator("#analysisContent").isVisible(), false);
    assert.match(
      await page.locator("#analysisRange").textContent(),
      /начало не позже/,
    );
    await setFilter("analysisMode", "month");
    await setFilter("analysisDate", "2026-12-01");
    assert.match(
      await page.locator("#analysisRange").textContent(),
      /ещё не начался/,
    );
    await setFilter("analysisDate", "2026-07-01");
    assert.equal(await page.locator("#analysisContent").isVisible(), true);
    assert.match(
      await page.locator("#analysisMetrics").textContent(),
      /Ранее расходов не было/,
    );
    assert.match(
      await page.locator("#anomalies").textContent(),
      /Пока мало истории для выводов/,
    );
    assert.match(
      await page.locator("#habits").textContent(),
      /минимум три покупки/,
    );
    await page.screenshot({
      path: dir + "/analytics-empty-320.png",
      fullPage: true,
    });
    assert.equal(
      await page.locator("#toggleTrendComparison").isDisabled(),
      true,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: dir + "/analytics-empty-1440.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 1000 });
    await setFilter("analysisDate", "2026-11-13");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#heatmapMode").evaluate((el) => {
      el.value = "year";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "year heatmap overflow",
    );
    await page.screenshot({
      path: dir + "/analytics-year-320.png",
      fullPage: true,
    });
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    await page.locator("#tab-overview").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#tab-history").getAttribute("aria-selected"),
      "true",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Analytics browser passed: filters, drill-down, forecast, reports, simulator, future dates, keyboard, 320/390/768/1024/1440px, chart geometry/CSP, empty states and long periods. Screenshots: " +
        dir,
    );
  } catch (e) {
    console.error(logs.join(""));
    throw e;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
