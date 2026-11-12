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
    await page.locator("#openReport").click();
    assert.match(
      await page.locator("#reportBody").textContent(),
      /ПРОМЕЖУТОЧНЫЕ ИТОГИ/,
    );
    const changed = await page.evaluate(async () => {
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
    assert.equal(await page.locator(".heatmap-month").count(), 12);
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
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator("#tab-analytics").click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "overflow " + width,
      );
      await page.screenshot({
        path: dir + "/analytics-" + width + ".png",
        fullPage: true,
      });
      await page.locator("#openReport").click();
      assert.equal(
        await page
          .locator("#reportDialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page.locator('[data-close="reportDialog"]').click();
    }
    await page.locator("#tab-overview").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#tab-history").getAttribute("aria-selected"),
      "true",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Analytics browser passed: filters, drill-down, forecast, reports, simulator, future dates, keyboard, 320/390/1440px. Screenshots: " +
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
