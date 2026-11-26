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
    const historyDays = page.locator("#history .entry-group");
    const assertColoredEntryIcons = async (entries) => {
      const icons = await entries.locator(".entry .icon").evaluateAll((items) =>
        items.map((item) => {
          const expected = document.createElement("span");
          expected.style.backgroundColor = item.dataset.entryColor;
          return [
            getComputedStyle(item).backgroundColor,
            expected.style.backgroundColor,
            getComputedStyle(item.querySelector("img")).filter,
          ];
        }),
      );
      assert.ok(icons.length > 0);
      for (const [background, expected, filter] of icons) {
        assert.equal(background, expected);
        assert.equal(filter, "brightness(0) invert(1)");
      }
    };
    await assertColoredEntryIcons(page.locator("#history"));
    assert.deepEqual(
      await historyDays
        .locator(".entry-date time")
        .allTextContents()
        .then((labels) => labels.slice(0, 3)),
      ["Сегодня", "Вчера", "11 ноября"],
    );
    assert.equal(await historyDays.first().locator(".entry").count(), 2);
    assert.equal(
      await historyDays.first().locator(".entry-day-total").textContent(),
      await page.evaluate(() => money(510000)),
    );
    assert.match(await page.locator("#weekForecast").textContent(), /Прогноз остатка/);
    assert.equal(
      await page.locator("#mobileTabs").isVisible(),
      true,
      "desktop navigation must provide access to analytics",
    );
    assert.equal(await page.locator("#tab-analytics").isVisible(), true);
    await page.locator("#tab-analytics").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#tab-overview").getAttribute("aria-selected"),
      "true",
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.locator("#settingsOpen").click();
    assert.equal(await page.locator("#panel-budget").isVisible(), true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(
      await page.locator("#tab-overview").getAttribute("aria-selected"),
      "false",
    );
    assert.equal(await page.locator("#panel-budget").isVisible(), true);
    await page.locator("#tab-analytics").click();
    assert.equal(await page.locator("#panel-analytics").isVisible(), true);
    assert.equal(await page.locator("#panel-overview").isVisible(), false);
    assert.equal(await page.locator("#trendChart svg").count(), 1);
    assert.equal(await page.locator("#dashboard .monthnav").isVisible(), false);
    await page.locator("#analysisFilters > summary").click();
    await page.locator("#analysisMonth + button").click();
    await page.locator('dialog.picker[open] [data-value="2026-10"]').click();
    assert.match(
      await page.locator("#analysisFilterSummary").textContent(),
      /Октябрь 2026/,
    );
    assert.equal(
      await page.locator("#analysisFilters").getAttribute("open"),
      null,
    );
    await page.locator("#openReport").click();
    assert.equal(await page.locator("#reportMonth").inputValue(), "2026-10");
    await page.locator('[data-close="reportDialog"]').click();
    await page.locator("#analysisFilters > summary").click();
    await page.locator("#analysisMonth + button").click();
    await page.locator('dialog.picker[open] [data-value="2026-11"]').click();
    assert.ok((await page.locator("#habits [data-habit]").count()) > 0);
    assert.ok((await page.locator("#anomalies [data-anomaly]").count()) > 0);
    const chooseBucket = async (locator) => {
      await page.locator("#openReport").focus();
      await locator.focus();
    };
    assert.equal(await page.locator("#spendingPace").isVisible(), true);
    assert.match(
      await page.locator("#paceHeadline").textContent(),
      /Сравнение появится, когда накопится история/,
    );
    assert.equal(await page.locator("#paceChart").isVisible(), false);
    assert.equal(
      await page.locator("#trendDailyDetails").getAttribute("open"),
      null,
    );
    await page.locator('[data-bucket="12"]').click();
    assert.equal(await page.locator("#analysisDetails").isVisible(), false);
    await page.locator("#openTrendOperations").click();
    assert.equal(
      await page.locator("#analysisDetails").isVisible(),
      true,
      "the selected bar opens its operations via the detail action",
    );
    await assertColoredEntryIcons(page.locator("#analysisDetailsBody"));
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
    await page.keyboard.press("ArrowLeft");
    assert.match(
      await page.locator("#trendSelection").textContent(),
      /12 ноября/,
    );
    await chooseBucket(page.locator('[data-bucket="12"]'));
    await page.locator("#openTrendOperations").click();
    assert.match(
      await page.locator("#analysisDetailsBody").textContent(),
      /Ноутбук/,
    );
    await page.keyboard.press("Escape");
    const habit = page.locator("#habits .habit-card").first();
    assert.equal(await habit.locator("[data-habit]").isVisible(), false);
    await habit.locator("summary").click();
    assert.equal(await habit.locator(".habit-weekdays li").count(), 7);
    await habit.locator("[data-habit]").click();
    assert.match(
      await page.locator("#analysisDetailsBody").textContent(),
      /кофе/,
    );
    await page.keyboard.press("Escape");
    await habit.locator("summary").click();
    assert.equal(await page.locator("#trendChart path").count(), 0);
    const metrics = page.locator("#analysisMetrics > div");
    assert.deepEqual(
      await metrics.locator(".kpi-label > span").allTextContents(),
      ["За период", "Среднее", "Медиана"],
    );
    assert.deepEqual(
      (await metrics.locator("strong").allTextContents()).map((value) =>
        value.replace(/\s/g, ""),
      ),
      ["6700₽", "515,38₽", "100₽"],
    );
    const tooltip = page.locator("#analyticsHelp");
    const totalHelp = metrics.first().getByRole("button");
    const averageHelp = metrics.nth(1).getByRole("button");
    const medianHelp = metrics.nth(2).getByRole("button");
    await totalHelp.hover();
    await tooltip.waitFor();
    assert.match(await tooltip.textContent(), /За прошлый сопоставимый период/);
    await averageHelp.focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await medianHelp.evaluate((button) => document.activeElement === button),
      true,
    );
    assert.match(await tooltip.textContent(), /В половине дней/);
    await page.keyboard.press("Escape");
    await tooltip.waitFor({ state: "hidden" });
    await averageHelp.click();
    await tooltip.waitFor();
    assert.match(await tooltip.textContent(), /Средний расход за день/);
    await page.locator("#trendTitle").click();
    await tooltip.waitFor({ state: "hidden" });
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
      const saved = await mutate({
        type: "recategorize",
        month: "2026-11",
        week: e.week,
        id: e.id,
        category: "Кофейни",
      });
      if (!saved) throw new Error($("saveStatus").textContent);
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
      await chooseBucket(page.locator("[data-bucket]").last());
      assert.equal(await page.locator("#trendSelection").isVisible(), true);
      await page.locator("#tab-analytics").focus();
      assert.equal(
        await page.locator("#analysisFilters").getAttribute("open"),
        null,
      );
      assert.equal(
        await page.locator("#analysisCategory + button").isVisible(),
        true,
      );
      await page.locator("#analysisFilters > summary").click();
      assert.equal(
        await page.locator("#analysisMonth + button").isVisible(),
        true,
      );
      await page.locator("#analysisFilters > summary").click();
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
      /5\s066,67.*больше обычного/,
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
      /12 ноября.*Факт.*Обычно/,
    );
    await page.locator("#openPaceDay").click();
    assert.match(
      await page.locator("#analysisDetailsTitle").textContent(),
      /12.11.2026/,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#trendChart path").count(), 0);
    assert.equal(await page.locator(".pace-actual").count(), 1);
    assert.equal(await page.locator(".pace-reference").count(), 1);
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
      7,
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
      /меньше обычного/,
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
      /предварительно/,
    );
    await page.locator("#paceWindow").evaluate((el) => {
      el.value = "12";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.match(
      await page.locator("#paceHelp").getAttribute("data-analytics-help"),
      /последних 12 мес/,
    );
    await page.evaluate(() => {
      state = JSON.parse(window.paceFixtureBackup);
      render();
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
      /1–2 августа/,
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
      await page.locator("#analysisError").textContent(),
      /начало не позже/,
    );
    await setFilter("analysisMode", "month");
    await setFilter("analysisDate", "2026-12-01");
    assert.match(
      await page.locator("#analysisError").textContent(),
      /ещё не начался/,
    );
    await setFilter("analysisDate", "2026-07-01");
    assert.equal(await page.locator("#analysisContent").isVisible(), true);
    assert.equal(await metrics.first().getByRole("button").count(), 0);
    assert.match(
      await page.locator("#anomalies").textContent(),
      /Пока мало истории для выводов/,
    );
    assert.match(await page.locator("#habits").textContent(), /три разных дня/);
    await page.screenshot({
      path: dir + "/analytics-empty-320.png",
      fullPage: true,
    });
    assert.equal(await page.locator("#trendChart").isVisible(), false);
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
    const touchContext = await browser.newContext({
      storageState: await page.context().storageState(),
      viewport: { width: 320, height: 740 },
      isMobile: true,
      hasTouch: true,
    });
    const touchPage = await touchContext.newPage();
    await touchPage.goto("http://127.0.0.1:8003/");
    await touchPage.locator("#tab-analytics").tap();
    await touchPage
      .getByRole("button", { name: "О показателе «Медиана»" })
      .tap();
    const touchHelp = touchPage.getByRole("tooltip");
    await touchHelp.waitFor();
    assert.match(await touchHelp.textContent(), /В половине дней/);
    const helpBounds = await touchHelp.boundingBox();
    assert.ok(helpBounds.x >= 0 && helpBounds.x + helpBounds.width <= 320);
    await touchPage.locator("#trendTitle").tap();
    await touchHelp.waitFor({ state: "hidden" });
    await touchContext.close();
    console.log(
      "Analytics browser passed: filters, drill-down, forecast, reports, help, future dates, keyboard, 320/390/768/1024/1440px, chart geometry/CSP, empty states and long periods. Screenshots: " +
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
