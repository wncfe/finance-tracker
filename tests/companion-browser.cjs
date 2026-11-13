const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const base = process.env.TEST_WORKER_URL || "http://127.0.0.1:8787";
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const response = await page.request.post(base + "/api/register", {
      data: {
        login: "companion-ui-" + Date.now(),
        password: "test-password-123",
        invite: "local-test-invitation",
      },
    });
    assert.equal(response.status(), 200);
    await page.goto(base);
    await page.locator("#dashboard").waitFor({ state: "visible" });
    assert.equal(await page.locator("#companionPanel").isVisible(), false);
    await page.locator("#companionOpen").click();
    await page.waitForFunction(
      () => document.querySelector("#companionLegacy").hidden,
    );
    await page.locator("#companionPair").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#companionCode")
        .textContent.includes("Одноразовый код"),
    );
    const code = (await page.locator("#companionCode").textContent()).match(
      /минут\): ([A-Za-z0-9_-]{43})/,
    )[1];
    const exchange = await fetch(base + "/api/companion/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "Poco UI Test" }),
    });
    assert.equal(exchange.status, 200);
    const { token } = await exchange.json();
    const post = (body) =>
      fetch(base + "/api/companion/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ mode: "draft", ...body }),
      });
    const id = crypto.randomUUID();
    assert.equal(
      (await post({ operationId: id, text: "кофе 250; непонятная штука" }))
        .status,
      200,
    );
    await page.locator("#companionRefresh").click();
    await page.locator("#companionLegacy summary").click();
    await page.locator("#companionInbox fieldset").first().waitFor();
    assert.equal(await page.locator("#companionInbox fieldset").count(), 2);
    await page.locator('#companionInbox [name="include"]').nth(1).uncheck();
    await page.locator('#companionInbox [name="amount"]').first().fill("260");
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      const dialogRect = await page.locator("#companionPanel").boundingBox();
      assert.ok(
        dialogRect.x >= 0 && dialogRect.x + dialogRect.width <= width,
        "Dialog fits at " + width,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "No horizontal overflow at " + width,
      );
    }
    await page.locator('#companionInbox button[type="submit"]').click();
    await page.waitForFunction(
      () => document.querySelector("#companionLegacy").hidden,
    );
    const state = await (await page.request.get(base + "/api/state")).json();
    const expenses = Object.values(state.state.months).flatMap(
      (m) => m.expenses,
    );
    assert.equal(expenses.length, 1);
    assert.equal(expenses[0].amount, 26000);
    const directId = crypto.randomUUID();
    const direct = await post({
      mode: "direct",
      operationId: directId,
      text: "кофе 100",
    });
    assert.equal(direct.status, 200);
    assert.equal((await direct.json()).status, "confirmed");
    await post({ mode: "direct", operationId: directId, text: "кофе 100" });
    const afterDirect = await (
      await page.request.get(base + "/api/state")
    ).json();
    assert.equal(
      Object.values(afterDirect.state.months).flatMap((m) => m.expenses).length,
      2,
    );
    await page.locator("[data-revoke]").click();
    await page.waitForFunction(() => !document.querySelector("[data-revoke]"));
    assert.equal(
      (
        await fetch(base + "/api/companion/summary", {
          headers: { Authorization: "Bearer " + token },
        })
      ).status,
      401,
    );
    fs.mkdirSync("data/companion-ui", { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "data/companion-ui/settings.png",
      fullPage: true,
    });
    await page.locator("#companionClose").click();
    assert.equal(await page.locator("#companionPanel").isVisible(), false);
    await page.screenshot({
      path: "data/companion-ui/pwa.png",
      fullPage: true,
    });
    await page.locator("#logout").click();
    await page.waitForFunction(
      () => document.querySelector("#companionCode").textContent === "",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Companion browser: pairing, editing, exclusion, approval, revocation, widths and logout passed",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
