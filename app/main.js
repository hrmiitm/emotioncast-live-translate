import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  safeStorage,
  dialog,
} from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { connection, setup } from "./protocol.js";
const here = path.dirname(fileURLToPath(import.meta.url)),
  run = promisify(execFile),
  sockets = new Map(),
  keys = {},
  cooldowns = new Map();
let win;
const file = (n) => path.join(app.getPath("userData"), n);
const read = async (n) => {
  try {
    return JSON.parse(await readFile(file(n), "utf8"));
  } catch {
    return {};
  }
};
const save = async (n, v) => {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(file(n), JSON.stringify(v, null, 2), { mode: 0o600 });
};
const emit = (id, type, data) => {
  if (win && !win.isDestroyed())
    win.webContents.send("live-event", { id, type, data });
};
function close(id) {
  const ws = sockets.get(id);
  sockets.delete(id);
  if (ws) {
    clearTimeout(ws.setupTimer);
    clearTimeout(ws.lifeTimer);
    ws.close();
    setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    }, 1000).unref();
  }
}
const pactl = async (...args) =>
  (await run("pactl", args, { timeout: 7000 })).stdout.trim();
async function routes(action) {
  if (process.platform !== "linux")
    throw Error(
      "Automatic virtual devices require Linux PulseAudio/PipeWire. On macOS install BlackHole; on Windows install VB-CABLE, then refresh devices.",
    );
  const saved = await read("routes.json");
  if (action === "create" || action === "recreate") {
    // Clean up any pre-existing emotioncast modules first to prevent collision
    const existingModules = (await pactl("list", "short", "modules")).split("\n");
    for (const line of existingModules) {
      if (line.includes("emotioncast_desktop_")) {
        const id = line.split("\t")[0];
        if (id) await pactl("unload-module", id).catch(() => {});
      }
    }
    // Save current real default sink/source BEFORE loading modules.
    // PulseAudio/PipeWire auto-switches the system default output to any newly
    // created null-sink. That makes every app's audio unexpectedly flow through
    // the virtual cable, and the monitor mic "listens" to everything — even
    // when EmotionCast is idle/stopped. Restoring the originals immediately
    // after module creation prevents this.
    let prevDefaultSink, prevDefaultSource;
    try {
      const info = await pactl("info");
      prevDefaultSink = info.match(/Default Sink:\s*(.+)/)?.[1]?.trim();
      prevDefaultSource = info.match(/Default Source:\s*(.+)/)?.[1]?.trim();
    } catch {}

    const ids = [];
    try {
      // 1. Send pipe: EmotionCast Speak output -> Google Meet Microphone
      ids.push(
        await pactl(
          "load-module",
          "module-null-sink",
          "sink_name=emotioncast_desktop_send",
          'sink_properties="device.description=\'EmotionCast - To Meet Microphone (App Output)\'"',
        ),
      );
      ids.push(
        await pactl(
          "load-module",
          "module-remap-source",
          "master=emotioncast_desktop_send.monitor",
          "source_name=emotioncast_desktop_send_mic",
          'source_properties="device.description=\'EmotionCast (Google Meet Microphone)\'"',
        ),
      );

      // 2. Receive pipe: Google Meet Speaker -> EmotionCast Listen input
      ids.push(
        await pactl(
          "load-module",
          "module-null-sink",
          "sink_name=emotioncast_desktop_receive",
          'sink_properties="device.description=\'EmotionCast (Google Meet Speaker)\'"',
        ),
      );
      ids.push(
        await pactl(
          "load-module",
          "module-remap-source",
          "master=emotioncast_desktop_receive.monitor",
          "source_name=emotioncast_desktop_receive_mic",
          'source_properties="device.description=\'EmotionCast - From Meet Speaker (App Input)\'"',
        ),
      );
      await save("routes.json", { ids, prevDefaultSink, prevDefaultSource });
    } catch (e) {
      for (const id of ids.reverse())
        await pactl("unload-module", id).catch(() => {});
      throw e;
    }

    // Restore the real system defaults so no other app is unexpectedly
    // re-routed through the virtual cables while EmotionCast is idle.
    if (prevDefaultSink && !prevDefaultSink.startsWith("emotioncast_desktop_"))
      await pactl("set-default-sink", prevDefaultSink).catch(() => {});
    if (prevDefaultSource && !prevDefaultSource.startsWith("emotioncast_desktop_"))
      await pactl("set-default-source", prevDefaultSource).catch(() => {});
  }
  if (action === "remove") {
    const lines = (await pactl("list", "short", "modules")).split("\n");
    for (const line of lines) {
      if (line.includes("emotioncast_desktop_")) {
        const id = line.split("\t")[0];
        if (id) await pactl("unload-module", id).catch(() => {});
      }
    }
    for (const id of [...(saved.ids || [])].reverse()) {
      await pactl("unload-module", id).catch(() => {});
    }
    // Also restore real defaults that were saved at creation time
    const restoredSink = saved.prevDefaultSink;
    const restoredSource = saved.prevDefaultSource;
    if (restoredSink && !restoredSink.startsWith("emotioncast_desktop_"))
      await pactl("set-default-sink", restoredSink).catch(() => {});
    if (restoredSource && !restoredSource.startsWith("emotioncast_desktop_"))
      await pactl("set-default-source", restoredSource).catch(() => {});
    await save("routes.json", {});
  }
  return {
    sinks: await pactl("list", "short", "sinks"),
    sources: await pactl("list", "short", "sources"),
  };
}
app
  .whenReady()
  .then(async () => {
    const stored = await read("keys.json");
    if (safeStorage.isEncryptionAvailable())
      for (const [k, v] of Object.entries(stored))
        try {
          keys[k] = safeStorage.decryptString(Buffer.from(v, "base64"));
        } catch {}
    win = new BrowserWindow({
      width: 1440,
      height: 980,
      minWidth: 1050,
      minHeight: 720,
      backgroundColor: "#10141d",
      title: "EmotionCast",
      icon: path.join(here, "icon.png"),
      webPreferences: {
        preload: path.join(here, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.webContents.on("render-process-gone", () => {
      for (const id of sockets.keys()) close(id);
    });
    win.webContents.on(
      "did-start-navigation",
      (_event, _url, _inPlace, isMainFrame) => {
        if (isMainFrame) for (const id of sockets.keys()) close(id);
      },
    );
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    session.defaultSession.setPermissionRequestHandler((wc, p, cb) =>
      cb(wc === win.webContents && p === "media"),
    );
    session.defaultSession.setPermissionCheckHandler(
      (wc, p) => wc === win.webContents && p === "media",
    );
    function handle(name, fn) {
      ipcMain.handle(name, async (e, ...args) => {
        if (
          e.sender !== win.webContents ||
          e.senderFrame !== win.webContents.mainFrame
        )
          throw Error("Invalid caller");
        return fn(...args);
      });
    }
    handle("load", async () => ({
      settings: await read("settings.json"),
      keys: Object.keys(keys),
      platform: process.platform,
      secure:
        safeStorage.isEncryptionAvailable() &&
        safeStorage.getSelectedStorageBackend?.() !== "basic_text",
    }));
    handle("save", async (s) => save("settings.json", s));
    handle("key", async (provider, key, remember) => {
      if (!["gemini", "foundry"].includes(provider))
        throw Error("Invalid provider");
      if (key) keys[provider] = key;
      else delete keys[provider];
      const st = await read("keys.json");
      delete st[provider];
      if (remember && key) {
        if (
          !safeStorage.isEncryptionAvailable() ||
          safeStorage.getSelectedStorageBackend?.() === "basic_text"
        )
          throw Error(
            "Secure OS key storage unavailable. Key remains in memory for this launch only.",
          );
        st[provider] = safeStorage.encryptString(key).toString("base64");
      }
      await save("keys.json", st);
      return true;
    });
    handle("routes", routes);
    handle("stop", (id) => close(id));
    handle("connect", async (id, c) => {
      if (!["speak", "listen", "check"].includes(id))
        throw Error("Invalid channel");
      close(id);
      const key = keys[c.provider];
      if (!key) throw Error("Set an API key for this provider first.");
      const until = cooldowns.get(c.provider) || 0;
      if (Date.now() < until)
        throw Error(
          `Rate limited: wait ${Math.ceil((until - Date.now()) / 1000)} seconds.`,
        );
      const params = connection(c, key),
        body = setup(c);
      const ws = new WebSocket(params.url, {
        headers: params.headers,
        handshakeTimeout: 12000,
        maxPayload: 8 * 1024 * 1024,
        perMessageDeflate: false,
      });
      sockets.set(id, ws);
      ws.lifeTimer = setTimeout(
        () => {
          emit(id, "error", "Session time limit reached.");
          close(id);
        },
        Math.max(10, Math.min(7200, Number(c.maxSeconds) || 600)) * 1000,
      );
      const clean = (v) =>
        String(v)
          .replaceAll(key, "[redacted]")
          .replace(/key=[^\s&]+/g, "key=[redacted]");
      ws.setupTimer = setTimeout(() => {
        emit(id, "error", "Timed out waiting for model setup.");
        close(id);
      }, 20000);
      ws.on("open", () => {
        try {
          ws._socket?.setNoDelay(true);
        } catch {}
        emit(id, "status", "WebSocket open · fast transfer active");
        ws.send(JSON.stringify(body));
      });
      ws.on("unexpected-response", (_, r) => {
        if (sockets.get(id) !== ws) {
          r.resume();
          return;
        }
        if (r.statusCode === 429)
          cooldowns.set(
            c.provider,
            Date.now() +
              Math.max(60, Number(r.headers["retry-after"]) || 60) * 1000,
          );
        emit(
          id,
          "error",
          `HTTP ${r.statusCode}: WebSocket handshake rejected before model setup. ${c.provider === "foundry" ? "Foundry Live routing may be unavailable." : ""}`,
        );
        r.resume();
        close(id);
      });
      ws.on("message", (data) => {
        if (sockets.get(id) !== ws) return;
        try {
          const m = JSON.parse(data);
          if (m.setupComplete) {
            clearTimeout(ws.setupTimer);
            emit(id, "ready", {});
          } else if (m.error) emit(id, "error", clean(JSON.stringify(m.error)));
          else emit(id, "message", m);
        } catch {
          emit(id, "error", "Invalid JSON received from server.");
        }
      });
      ws.on("error", (e) => {
        if (sockets.get(id) === ws) emit(id, "error", clean(e.message));
      });
      ws.on("close", (code, reason) => {
        clearTimeout(ws.setupTimer);
        if (sockets.get(id) === ws) {
          sockets.delete(id);
          if (code === 1008 && /quota|rate/i.test(String(reason)))
            cooldowns.set(c.provider, Date.now() + 60000);
          emit(id, "closed", { code, reason: clean(reason) });
        }
      });
      return true;
    });
    handle("send", (id, msg) => {
      const ws = sockets.get(id);
      if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 128000)
        return false;
      const text = JSON.stringify(msg);
      if (text.length > 100000) throw Error("Frame too large");
      ws.send(text);
      return true;
    });
    handle("export", async (data) => {
      const result = await dialog.showSaveDialog(win, {
        defaultPath: "emotioncast-session.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!result.canceled)
        await writeFile(result.filePath, JSON.stringify(data, null, 2));
      return !result.canceled;
    });
    win.on("closed", () => {
      for (const id of sockets.keys()) close(id);
      app.quit();
    });
    await win.loadFile(path.join(here, "index.html"));
  })
  .catch((error) => {
    console.error(error.message);
    app.quit();
  });
