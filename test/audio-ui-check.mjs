import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9333",
});
const page = (await browser.pages()).find((p) =>
  p.url().endsWith("index.html"),
);
await page.setViewport({ width: 1440, height: 980 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const env = Object.fromEntries(
  (await readFile(".env", "utf8"))
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ""),
      ];
    }),
);
await page.evaluate(
  (key) => window.desktop.call("key", "gemini", key, false),
  env.GEMINI_API_KEY,
);
await page.click("#clear");
await page.select("#provider", "gemini");
await page.select(
  "#channels .card:first-child [data-field=preset]",
  "gemini-3.1-flash-live-preview",
);
await page.click("#channels .card:first-child [data-action=start]");
await page.waitForFunction(
  () =>
    document
      .querySelector("#channels .card .status")
      .textContent.includes("Live"),
  { timeout: 25000 },
);
// The Chromium fixture loops without silence; explicitly end the input turn.
await new Promise((resolve) => setTimeout(resolve, 12000));
await page.click("#channels .card:first-child [data-action=pause]");
await page.waitForFunction(
  () =>
    document.querySelector("#channels .card .transcript").textContent.length >
    40,
  { timeout: 45000 },
);
await page.waitForFunction(
  () =>
    /Received [1-9]/.test(
      document.querySelector("#channels .card [data-stats]").textContent,
    ),
  { timeout: 45000 },
);
await page.waitForFunction(
  () =>
    document.querySelector("#channels .card .status").textContent === "Paused",
);
const stats = await page.$eval(
  "#channels .card [data-stats]",
  (e) => e.textContent,
);
assert.match(stats, /Sent [1-9]/);
const transcript = await page.$eval(
  "#channels .card .transcript",
  (e) => e.textContent,
);
await page.screenshot({
  path: "desktop-app/evidence/live-studio.png",
  fullPage: true,
});
await page.click("#stopAll");
await page.waitForFunction(() =>
  [...document.querySelectorAll("#channels .status")].every(
    (e) => e.textContent === "Stopped",
  ),
);
assert.equal(
  await page.$eval("#channels .card fieldset", (e) => e.disabled),
  false,
);
await writeFile(
  "desktop-app/evidence/audio-ui-check.json",
  JSON.stringify(
    {
      passed: true,
      stats,
      transcript,
      errors,
      checks: [
        "real AudioWorklet captures fixture via fake Chromium microphone",
        "PCM reaches official Live model",
        "server transcript renders",
        "pause ends activity",
        "stop all closes sessions and restores settings controls",
      ],
    },
    null,
    2,
  ),
);
assert.deepEqual(errors, []);
await browser.disconnect();
console.log("Audio UI checks passed.");
