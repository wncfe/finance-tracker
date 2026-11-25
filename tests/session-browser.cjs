const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const dir = "data/session-test-" + Date.now();
  fs.mkdirSync(dir, { recursive: true });
  const server = spawn("python", [
    "-c",
    `import server; from pathlib import Path; server.DB=Path('${dir}/test.sqlite3'); server.init(); server.ThreadingHTTPServer(('127.0.0.1',8002),server.Handler).serve_forever()`,
  ]);
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await (await fetch("http://127.0.0.1:8002/")).text();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:8002/");
    await page.locator("#auth").waitFor({ state: "visible" });
    await page.locator("[name=login]").fill("session-test");
    await page.locator("[name=password]").fill("session-password-123");
    await page.locator("#register").click();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    let release, requested;
    const gate = new Promise((r) => (release = r));
    const request = new Promise((r) => (requested = r));
    await page.route("**/api/state", async (route) => {
      requested();
      await gate;
      await route.continue();
    });
    await page.reload();
    await request;
    assert.equal(await page.locator("#auth").isVisible(), false);
    assert.equal(await page.locator("#sessionLoading").isVisible(), true);
    release();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    await page.unroute("**/api/state");
    await page.route("**/api/state", (route) => route.abort());
    await page.reload();
    await page.locator("#sessionRetry").waitFor({ state: "visible" });
    assert.equal(await page.locator("#auth").isVisible(), false);
    await page.unroute("**/api/state");
    await page.locator("#sessionRetry").click();
    await page.locator("#dashboard").waitFor({ state: "visible" });
    await page.locator("#logout").click();
    await page.locator("#auth").waitFor({ state: "visible" });
    assert.equal(await page.locator("#sessionLoading").isVisible(), false);
    console.log(
      "Session checks passed: guest, delayed restore, network failure, retry, logout",
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
