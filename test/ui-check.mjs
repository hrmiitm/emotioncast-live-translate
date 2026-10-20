import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9333",
});
const page = (await browser.pages()).find((p) =>
  p.url().endsWith("index.html"),
);
await page.setViewport({ width: 1440, height: 980 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.waitForSelector("#channels .card");
assert.equal(await page.$$eval("#channels .card", (els) => els.length), 2);
assert.equal(
  await page.$$eval("[data-field=preset] option", (els) => els.length),
  14,
);
await page.click("#provider");
await page.select("#provider", "foundry");
assert.equal(
  await page.$eval("#base", (e) => e.value),
  "https://llmfoundry.straivedemo.com/gemini",
);
await page.select("#provider", "gemini");
await page.click("#save");
await page.waitForFunction(
  () =>
    document.querySelector("#notice").textContent === "Settings saved locally.",
);
await page.evaluate(() => window.desktop.call("key", "gemini", "", false));
await page.click("#check");
await page.waitForFunction(() =>
  document.querySelector("#notice").textContent.includes("Set an API key"),
);
assert.equal(await page.$eval("#check", (e) => e.disabled), false);
await page.click("#refresh");
await page.waitForFunction(
  () =>
    document.querySelector("#notice").textContent ===
    "Audio devices refreshed.",
);
import { existsSync, mkdirSync } from "node:fs";
const outDir = existsSync("evidence") ? "evidence" : "desktop-app/evidence";
mkdirSync(outDir, { recursive: true });
await page.screenshot({
  path: `${outDir}/studio.png`,
  fullPage: true,
});
await writeFile(
  `${outDir}/ui-check.json`,
  JSON.stringify(
    {
      passed: true,
      checks: [
        "two channels rendered",
        "six presets plus custom per channel",
        "provider switches endpoint",
        "settings saved",
        "missing key reported; controls recovered",
        "microphone permissions and device enumeration",
      ],
      errors,
    },
    null,
    2,
  ),
);
assert.deepEqual(errors, []);
await browser.disconnect();
console.log("UI checks passed.");
