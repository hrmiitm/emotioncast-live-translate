import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333" }),
  p = (await b.pages())[0],
  wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
try {
  await p.evaluate(() => window.desktop.call("routes", "create"));
  for (const direction of ["send", "receive"]) {
    const chunks = [];
    const rec = spawn("parec", [
      `--device=emotioncast_desktop_${direction}_mic`,
      "--format=s16le",
      "--rate=16000",
      "--channels=1",
    ]);
    rec.stdout.on("data", (d) => chunks.push(d));
    await wait(500);
    const play = spawn("pacat", [
      "--playback",
      `--device=emotioncast_desktop_${direction}`,
      "--format=s16le",
      "--rate=16000",
      "--channels=1",
    ]);
    const pcm = Buffer.alloc(32000);
    for (let i = 0; i < 16000; i++)
      pcm.writeInt16LE(
        Math.round(5000 * Math.sin((2 * Math.PI * 440 * i) / 16000)),
        i * 2,
      );
    play.stdin.end(pcm);
    await new Promise((resolve, reject) => {
      play.on("exit", (code) =>
        code === 0 ? resolve() : reject(Error("Playback failed")),
      );
      play.on("error", reject);
    });
    await wait(800);
    rec.kill("SIGTERM");
    await new Promise((r) => rec.on("exit", r));
    const data = Buffer.concat(chunks);
    let peak = 0;
    for (let i = 0; i + 1 < data.length; i += 2)
      peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
    assert.ok(peak > 1000, "Virtual route carries signal");
    results.push({ direction, capturedBytes: data.length, peak, passed: true });
  }
} finally {
  await p.evaluate(() => window.desktop.call("routes", "remove"));
  await b.disconnect();
}
import { existsSync, mkdirSync } from "node:fs";
const outDir = existsSync("evidence") ? "evidence" : "desktop-app/evidence";
mkdirSync(outDir, { recursive: true });
await writeFile(
  `${outDir}/routing-signal-check.json`,
  JSON.stringify(results, null, 2),
);
console.log("Both virtual routes carry audio.");
