import puppeteer from "puppeteer-core";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { defaults, models, setup, manual } from "../app/protocol.js";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9333",
});
const page = (await browser.pages()).find((p) =>
  p.url().endsWith("index.html"),
);
await page.setViewport({ width: 1440, height: 980 });
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
  async (key) => window.desktop.call("key", "gemini", key, false),
  env.GEMINI_API_KEY,
);
const pcm = await readFile("audio-model-tests/audio-16khz-mono.pcm");
const results = [];
for (const model of models) {
  const c = { ...defaults, model };
  await page.evaluate(() => {
    window.probe = {
      ready: false,
      error: null,
      input: "",
      output: "",
      audioBytes: 0,
    };
    window.removeProbe = window.desktop.onEvent((e) => {
      if (e.id !== "check") return;
      if (e.type === "ready") window.probe.ready = true;
      if (e.type === "error" || e.type === "closed")
        window.probe.error = e.data;
      if (e.type === "message") {
        const s = e.data.serverContent;
        window.probe.input += s?.inputTranscription?.text || "";
        window.probe.output += s?.outputTranscription?.text || "";
        for (const p of s?.modelTurn?.parts || []) {
          window.probe.output += p.text || "";
          if (p.inlineData?.data)
            window.probe.audioBytes += atob(p.inlineData.data).length;
        }
      }
    });
  });
  // Use speak transport ID because UI check deliberately closes its connection on readiness.
  await page.evaluate(() => {
    window.removeProbe();
    window.removeProbe = window.desktop.onEvent((e) => {
      if (e.id !== "speak") return;
      if (e.type === "ready") window.probe.ready = true;
      if (e.type === "error" || e.type === "closed")
        window.probe.error = e.data;
      if (e.type === "message") {
        const s = e.data.serverContent;
        window.probe.input += s?.inputTranscription?.text || "";
        window.probe.output += s?.outputTranscription?.text || "";
        for (const p of s?.modelTurn?.parts || []) {
          window.probe.output += p.text || "";
          if (p.inlineData?.data)
            window.probe.audioBytes += atob(p.inlineData.data).length;
        }
      }
    });
  });
  await page.evaluate((c) => window.desktop.call("connect", "speak", c), c);
  await page.waitForFunction(() => window.probe.ready || window.probe.error, {
    timeout: 25000,
  });
  let state = await page.evaluate(() => window.probe);
  if (state.ready) {
    if (manual(c))
      await page.evaluate(() =>
        window.desktop.call("send", "speak", {
          realtimeInput: { activityStart: {} },
        }),
      );
    for (let i = 0; i < pcm.length; i += 3200) {
      await page.evaluate(
        (data) =>
          window.desktop.call("send", "speak", {
            realtimeInput: {
              audio: { data, mimeType: "audio/pcm;rate=16000" },
            },
          }),
        pcm.subarray(i, i + 3200).toString("base64"),
      );
      await wait(100);
    }
    await page.evaluate(
      (m) =>
        window.desktop.call("send", "speak", {
          realtimeInput: m ? { activityEnd: {} } : { audioStreamEnd: true },
        }),
      manual(c),
    );
    await wait(10000);
    state = await page.evaluate(() => window.probe);
  }
  await page.evaluate(async () => {
    window.removeProbe();
    await window.desktop.call("stop", "speak");
  });
  results.push({
    model,
    ...state,
    working: !!(state.input || state.output || state.audioBytes),
  });
  await writeFile(
    "desktop-app/evidence/live-check.json",
    JSON.stringify(results, null, 2),
  );
  console.log(
    model,
    results.at(-1).working
      ? "audio response verified"
      : JSON.stringify(state.error),
  );
  await wait(15000);
}
// Exercise real OS module creation and removal through desktop IPC.
const routing = await page.evaluate(async () => {
  const created = await window.desktop.call("routes", "create");
  const removed = await window.desktop.call("routes", "remove");
  return { created, removed };
});
assert.match(routing.created.sources, /emotioncast_desktop_send_mic/);
assert.ok(!routing.removed.sources.includes("emotioncast_desktop_"));
await writeFile(
  "desktop-app/evidence/routing-check.json",
  JSON.stringify({ passed: true, ...routing }, null, 2),
);
await browser.disconnect();
