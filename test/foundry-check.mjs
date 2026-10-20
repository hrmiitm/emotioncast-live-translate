import puppeteer from "puppeteer-core";
import { readFile, writeFile } from "node:fs/promises";
import { defaults } from "../app/protocol.js";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333" }),
  p = (await b.pages())[0];
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
await p.evaluate(
  (key) => window.desktop.call("key", "foundry", key, false),
  env.LLMFOUNDRY_API_KEY,
);
const c = {
  ...defaults,
  provider: "foundry",
  base: "https://llmfoundry.straivedemo.com/gemini",
};
const result = await p.evaluate(
  (c) =>
    new Promise(async (resolve) => {
      let off;
      const finish = async (data) => {
        off?.();
        await window.desktop.call("stop", "listen");
        resolve(data);
      };
      off = window.desktop.onEvent((e) => {
        if (e.id === "listen" && ["ready", "error", "closed"].includes(e.type))
          finish({ type: e.type, data: e.data });
      });
      await window.desktop.call("connect", "listen", c);
    }),
  c,
);
await writeFile(
  "desktop-app/evidence/foundry-check.json",
  JSON.stringify({ model: c.model, base: c.base, ...result }, null, 2),
);
console.log(result);
await b.disconnect();
