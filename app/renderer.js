import { catalog, profile, normalizeLanguage, deliveryStyles } from "./capabilities.js";
import { models, defaults, manual } from "./protocol.js";
const $ = (s) => document.querySelector(s),
  api = window.desktop,
  channels = {},
  logs = [];
let saved = {},
  checking = false,
  currentTheme = "system",
  currentZoom = 1.05;
const zoomSteps = [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4];

function updateSystemThemeAttr() {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.systemTheme = isDark ? "dark" : "light";
}

function applyTheme(theme) {
  currentTheme = ["system", "light", "dark"].includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = currentTheme;
  updateSystemThemeAttr();
  document.querySelectorAll(".theme-chip").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeVal === currentTheme);
  });
}

function applyZoom(factor) {
  currentZoom = Math.round(Number(factor || 1.05) * 100) / 100;
  if (api?.setZoom) {
    api.setZoom(currentZoom);
  }
  document.documentElement.style.zoom = currentZoom;
  const zoomDisplay = $("#zoomLevel");
  if (zoomDisplay) {
    zoomDisplay.textContent = Math.round(currentZoom * 100) + "%";
  }
}

function changeZoom(delta) {
  let idx = zoomSteps.findIndex((s) => Math.abs(s - currentZoom) < 0.02);
  if (idx === -1) idx = zoomSteps.indexOf(1.05);
  let nextIdx = idx + delta;
  if (nextIdx < 0) nextIdx = 0;
  if (nextIdx >= zoomSteps.length) nextIdx = zoomSteps.length - 1;
  applyZoom(zoomSteps[nextIdx]);
  api.call("save", allSettings()).catch(() => {});
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (currentTheme === "system") {
    updateSystemThemeAttr();
  }
});

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunkSize, len)),
    );
  }
  return btoa(binary);
}

const tuningPresets = {
  "ultra-low": { chunk: 20, buffer: 40, maxBuffer: 1000, stopAfterSilence: 0 },
  "low": { chunk: 40, buffer: 60, maxBuffer: 1500, stopAfterSilence: 0 },
  "balanced": { chunk: 40, buffer: 100, maxBuffer: 3000, stopAfterSilence: 0 },
  "high-stability": { chunk: 80, buffer: 150, maxBuffer: 6000, stopAfterSilence: 0 },
};

let tuning = {
  preset: "low",
  chunk: 40,
  buffer: 60,
  maxBuffer: 1500,
  stopAfterSilence: 0,
};

let usage = {
  audioInSeconds: 0,
  audioOutSeconds: 0,
  sessionsCount: 0,
};

function updateSpendDisplay() {
  const spend =
    usage.audioInSeconds * 0.0000175 + usage.audioOutSeconds * 0.0001;
  const spendStr = `$${spend.toFixed(4)} + unpriced`;
  const el = $("#spendAmount");
  if (el) el.textContent = spendStr;
  const inEl = $("#usageAudioIn");
  if (inEl) inEl.textContent = usage.audioInSeconds.toFixed(1) + "s";
  const outEl = $("#usageAudioOut");
  if (outEl) outEl.textContent = usage.audioOutSeconds.toFixed(1) + "s";
  const sessEl = $("#usageSessionsCount");
  if (sessEl) sessEl.textContent = String(usage.sessionsCount);
  const costEl = $("#usageTotalCost");
  if (costEl) costEl.textContent = `$${spend.toFixed(4)}`;
}

function recordUsage(inSec = 0, outSec = 0) {
  usage.audioInSeconds += inSec;
  usage.audioOutSeconds += outSec;
  updateSpendDisplay();
}

function applyTuningValues(t) {
  tuning = { ...tuning, ...t };
  if ($("#tuningPreset")) $("#tuningPreset").value = tuning.preset || "custom";
  if ($("#tuningChunk")) $("#tuningChunk").value = tuning.chunk;
  if ($("#tuningBuffer")) $("#tuningBuffer").value = tuning.buffer;
  if ($("#tuningMaxBuffer")) $("#tuningMaxBuffer").value = tuning.maxBuffer;
  if ($("#tuningStopAfterSilence"))
    $("#tuningStopAfterSilence").value = tuning.stopAfterSilence;
  for (const c of Object.values(channels)) {
    if (c.c) {
      c.c.chunk = tuning.chunk;
      c.c.buffer = tuning.buffer;
      c.c.maxBuffer = tuning.maxBuffer;
      c.c.stopAfterSilence = tuning.stopAfterSilence;
    }
  }
}

function notice(s) {
  $("#notice").textContent = s;
}
function log(s) {
  logs.push({ time: new Date().toISOString(), message: s });
  if (logs.length > 500) logs.shift();
  $("#log").textContent = logs
    .map((x) => `${x.time.slice(11, 19)}  ${x.message}`)
    .join("\n");
  $("#log").scrollTop = 1e8;
}
function guard(fn) {
  return async () => {
    try {
      await fn();
    } catch (e) {
      notice(e.message);
      log(e.message);
    }
  };
}
function field(name, label, type = "text", extra = "") {
  return `<label>${label}<input data-field="${name}" type="${type}" ${extra}></label>`;
}
function select(name, label, opts, extra = "") {
  return `<label>${label}<select data-field="${name}">${opts.map((x) => (Array.isArray(x) ? `<option value="${x[0]}">${x[1]}</option>` : `<option>${x}</option>`)).join("")}</select>${extra}</label>`;
}
for (const [id, title, sub] of [
  ["speak", "Speak · You → Google Meet (Translate your voice for others)", "02"],
  ["listen", "Listen · Google Meet → You (Translate others for your ears)", "03"],
]) {
  const card = document.createElement("section");
  card.className = "card";
  const inLabel =
    id === "speak"
      ? "Audio input · Your Real Microphone (In)"
      : "Audio input · From Google Meet Speaker (In)";
  const outLabel =
    id === "speak"
      ? "Translated audio output · To Google Meet Microphone (Target)"
      : "Translated audio output · Your Real Headphones (Target)";
  card.innerHTML = `<div class="sectionhead"><h2><span class="number">${sub}</span>${title}</h2><span class="status">Idle</span></div><fieldset><div class="grid two">${select("preset", "Model", [...models, ["custom", "Custom model…"]])}${field("model", "Model ID")}${select("source", "Input language (In)", [])}${select("target", "Translation language (Target)", [])}${field("sourceCustom", "Custom input language code (BCP-47)")}${field("targetCustom", "Custom translation language code (BCP-47)")}${select("voice", "Voice · vocal character (Google AI Studio)", [])}${field("voiceCustom", "Custom voice name")}${select("delivery", "Audio tone & delivery style", deliveryStyles)}${field("deliveryCustom", "Custom tone prompt (e.g. laid-back radio DJ, urgent whisper)")}<div class="span2 voice-info" data-voice-info hidden></div><label class="check span2" data-affective-wrap><input type="checkbox" data-field="affectiveDialog" checked>Affective dialog · Mirror speaker tone & emotion (Gemini 3.8 Live)</label><p class="muted span2" data-capabilities></p>${select("input", inLabel, [["default", "System default"]], `<div class="route-chip-container"><div class="route-chip muted" data-chip="${id}-input">Detecting input…</div></div>`)}${select("output", outLabel, [["default", "System default"]], `<div class="route-chip-container"><div class="route-chip muted" data-chip="${id}-output">Detecting output…</div></div>`)}</div><details><summary>Audio, latency & advanced settings</summary><div class="grid two">${select(
    "modality",
    "Response type",
    [
      ["auto", "Model default"],
      ["AUDIO", "Speech + transcript"],
      ["TEXT", "Text only"],
    ],
  )}${select(
    "vad",
    "Speech detection",
    [
      ["auto", "Model recommended"],
      ["server", "Server automatic"],
      ["manual", "Local voice activity"],
    ],
  )}${field("silence", "End-of-speech silence (ms)", "number", 'min="100" max="5000"')}${field("threshold", "Local speech threshold", "number", 'min="0.001" max="1" step="0.001"')}${select("chunk", "Input frame length (ms)", ["20", "40", "80", "100"])}${field("buffer", "Playback buffer (ms)", "number", 'min="0" max="2000"')}${field("maxBuffer", "Maximum queued audio (ms)", "number", 'min="500" max="15000"')}${field("maxSeconds", "Session limit (seconds)", "number", 'min="10" max="7200"')}${field("gain", "Playback volume", "number", 'min="0" max="2" step="0.1"')}${select("thinking", "Extended model thinking", ["LOW", "MEDIUM", "HIGH"])}<label>Wire format<input value="PCM signed 16-bit · mono · 16 kHz" disabled></label>${["echo", "noise", "agc"].map((n, i) => `<label class="check"><input type="checkbox" data-field="${n}">${["Echo cancellation", "Noise suppression", "Automatic gain"][i]}</label>`).join("")}<label class="span2">Interpreter instruction (general Live models)<textarea data-field="prompt" placeholder="Default: translate only, preserving meaning and tone"></textarea></label><label class="span2">Advanced setup override · JSON<textarea data-field="advanced" spellcheck="false"></textarea></label></div><label class="check"><input type="checkbox" data-field="echoTarget">Speak input already in the target language (Live Translate)</label><p class="muted">Language and voice options are bundled from Google documentation. Custom model support depends on its provider. Advanced JSON overrides replace matching setup fields.</p></details></fieldset><div class="metrics"><div><small>FIRST RESPONSE</small><b data-stat="latency">—</b></div><div><small>PLAYBACK QUEUE</small><b data-stat="queue">0 ms</b></div><div><small>SESSION TIME</small><b data-stat="time">0:00</b></div></div><div class="meter"><progress max="1" value="0"></progress></div><div class="toolbar"><button class="primary" data-action="start">▶ Start</button><button data-action="pause" disabled>Pause input</button><button data-action="stop" disabled>Stop</button><button data-action="flush">Clear audio queue</button></div><p class="muted" data-stats>16 kHz input · Output sample rate read from server</p><div class="transcript" aria-live="polite"></div>`;
  $("#channels").append(card);
  channels[id] = new Channel(id, card);
}
function common() {
  return Object.fromEntries(
    ["provider", "base", "version", "project"].map((n) => [
      n,
      $("#" + n).value,
    ]),
  );
}
function allSettings() {
  return {
    ...common(),
    theme: currentTheme,
    zoom: currentZoom,
    tuning,
    usage,
    channels: Object.fromEntries(
      Object.entries(channels).map(([id, c]) => [id, c.config()]),
    ),
  };
}
function fill(c, v) {
  for (const el of c.el.querySelectorAll("[data-field]")) {
    const n = el.dataset.field;
    if (n === "preset")
      el.value = models.includes(v.model) ? v.model : "custom";
    else if (el.type === "checkbox") el.checked = !!v[n];
    else if (v[n] !== undefined) el.value = v[n];
  }
  c.refreshCapabilities(v);
}
function lockCommon() {
  const active = Object.values(channels).some((c) => c.active) || checking;
  for (const n of ["provider", "base", "version", "project", "check", "reset"])
    $("#" + n).disabled = active;
}
function Channel(id, el) {
  this.id = id;
  this.el = el;
  this.sources = new Set();
  this.next = 0;
  this.active = false;
  this.epoch = 0;
  this.transcript = [];
  this.stats = {};
  this.preferredSource = "auto";
  this.preferredTarget = id === "listen" ? "en" : "hi";
  const q = (s) => el.querySelector(s);
  this.q = q;
  this.config = () => {
    const c = { ...defaults, ...common(), ...tuning };
    for (const input of el.querySelectorAll("[data-field]")) {
      const n = input.dataset.field;
      if (n !== "preset")
        c[n] =
          input.type === "checkbox"
            ? input.checked
            : input.type === "number"
              ? Number(input.value)
              : input.value;
    }
    for (const key of ["source", "target", "voice"]) {
      if (c[key] === "__custom") c[key] = (c[key + "Custom"] || "").trim();
      delete c[key + "Custom"];
    }
    return c;
  };
  this.refreshCapabilities = (values = {}) => {
    const model = q("[data-field=model]").value;
    const p = profile(model);
    const set = (name, options, value, fallback) => {
      const select = q(`[data-field=${name}]`);
      select.replaceChildren();
      for (const [code, label] of options) select.add(new Option(label, code));
      select.value = options.some((x) => x[0] === value) ? value : fallback;
      return select.value;
    };
    const langs = p.languages.map((x) => [x.code, `${x.name} · ${x.code}`]);

    // Handle source language
    let sourceVal = values.source ?? (q("[data-field=source]").value || this.preferredSource);
    if (sourceVal === "__custom") sourceVal = q("[data-field=sourceCustom]").value;
    const sourceOptions = [
      ["auto", "Auto-detect input language"],
      ...langs,
      ["__custom", "Custom language code…"],
    ];
    let normalizedSource = sourceVal;
    if (sourceVal && sourceVal !== "auto" && sourceVal !== "__custom") {
      if (!langs.some((x) => x[0] === sourceVal)) {
        normalizedSource = normalizeLanguage(sourceVal, p, "auto");
      }
    }
    const isSourceCustom =
      sourceVal === "__custom" ||
      (sourceVal &&
        sourceVal !== "auto" &&
        !sourceOptions.some((x) => x[0] === sourceVal));
    if (isSourceCustom && sourceVal !== "__custom") {
      q("[data-field=sourceCustom]").value = sourceVal;
      normalizedSource = "__custom";
    }
    set("source", sourceOptions, normalizedSource, "auto");
    q("[data-field=sourceCustom]").parentElement.hidden =
      q("[data-field=source]").value !== "__custom";
    this.preferredSource =
      q("[data-field=source]").value === "__custom"
        ? q("[data-field=sourceCustom]").value
        : q("[data-field=source]").value;

    // Handle target language
    const defaultTargetFallback = this.id === "listen" ? "en" : "hi";
    const targetFallback = normalizeLanguage(
      defaultTargetFallback,
      p,
      p.languages[0]?.code || "en",
    );
    let targetVal =
      values.target ?? (q("[data-field=target]").value || this.preferredTarget);
    if (targetVal === "__custom") targetVal = q("[data-field=targetCustom]").value;

    if (!p.target) {
      set("target", [["", "Original language · transcription only"]], "", "");
      q("[data-field=target]").disabled = true;
      q("[data-field=targetCustom]").parentElement.hidden = true;
    } else {
      q("[data-field=target]").disabled = false;
      const targetOptions = [
        ...langs,
        ["__custom", "Custom language code…"],
      ];
      let normalizedTarget = targetVal;
      if (targetVal && targetVal !== "__custom") {
        if (!langs.some((x) => x[0] === targetVal)) {
          normalizedTarget = normalizeLanguage(targetVal, p, targetFallback);
        }
      }
      const isTargetCustom =
        targetVal === "__custom" ||
        (targetVal && !targetOptions.some((x) => x[0] === targetVal));
      if (isTargetCustom && targetVal !== "__custom") {
        q("[data-field=targetCustom]").value = targetVal;
        normalizedTarget = "__custom";
      }
      set("target", targetOptions, normalizedTarget, targetFallback);
      q("[data-field=targetCustom]").parentElement.hidden =
        q("[data-field=target]").value !== "__custom";
      this.preferredTarget =
        q("[data-field=target]").value === "__custom"
          ? q("[data-field=targetCustom]").value
          : q("[data-field=target]").value;
    }

    // Handle voice
    let voiceVal = values.voice ?? q("[data-field=voice]").value;
    let voiceOptions = [];
    if (p.voices) {
      voiceOptions = [
        ["", "Model default voice"],
        ...catalog.voices.map((v) => {
          const char = [v.gender, v.pitch ? `${v.pitch} pitch` : ""]
            .filter(Boolean)
            .join(", ");
          const sub = char ? ` (${char})` : "";
          return [v.name, `${v.name} — ${v.description}${sub}`];
        }),
        ["__custom", "Custom voice name…"],
      ];
    } else {
      voiceOptions = [
        [
          "",
          p.kind === "translate"
            ? "Original speaker · automatic (preserved)"
            : "Not available · text output",
        ],
      ];
    }
    const isVoiceCustom =
      voiceVal === "__custom" ||
      (voiceVal &&
        p.voices &&
        !voiceOptions.some(
          (x) => x[0].toLowerCase() === voiceVal.toLowerCase(),
        ));
    if (isVoiceCustom && voiceVal !== "__custom") {
      q("[data-field=voiceCustom]").value = voiceVal;
      voiceVal = "__custom";
    }
    set("voice", voiceOptions, voiceVal, "");
    q("[data-field=voice]").disabled = !p.voices;
    q("[data-field=voiceCustom]").parentElement.hidden =
      !p.voices || q("[data-field=voice]").value !== "__custom";

    // Update voice details badge
    const curVoice = q("[data-field=voice]").value;
    const vMeta = catalog.voices.find(
      (v) => v.name.toLowerCase() === curVoice.toLowerCase(),
    );
    const vInfoEl = q("[data-voice-info]");
    if (p.voices && vMeta) {
      vInfoEl.hidden = false;
      vInfoEl.innerHTML = `<strong>${vMeta.name}</strong> · ${vMeta.description} &bull; <em>${vMeta.persona || "Featured Studio Voice"}</em> (${vMeta.gender || ""}, ${vMeta.pitch || ""} pitch). ${vMeta.details || ""}`;
    } else if (!p.voices && p.kind === "translate") {
      vInfoEl.hidden = false;
      vInfoEl.innerHTML = `ℹ️ <strong>Original voice preservation:</strong> Gemini 3.5 Live Translate is designed to clone/preserve the speaker's original voice. To choose a Google AI Studio voice character (<strong>Zephyr</strong>, <strong>Puck</strong>, <strong>Charon</strong>, <strong>Kore</strong>, <strong>Fenrir</strong>, etc.) or custom tone delivery, set Model to <strong>Gemini 3.8 Live</strong>.`;
    } else {
      vInfoEl.hidden = true;
    }

    // Handle tone / delivery style
    let deliveryVal = values.delivery ?? q("[data-field=delivery]").value;
    q("[data-field=delivery]").disabled = !p.style;
    if (!p.style) {
      q("[data-field=delivery]").value = "";
      q("[data-field=deliveryCustom]").parentElement.hidden = true;
    } else {
      q("[data-field=deliveryCustom]").parentElement.hidden =
        deliveryVal !== "custom";
    }

    // Affective dialog toggle
    const affectiveWrap = q("[data-affective-wrap]");
    if (affectiveWrap) {
      affectiveWrap.hidden = !p.affective;
      if (!p.affective) q("[data-field=affectiveDialog]").checked = false;
    }

    // Modality
    const mode = values.modality ?? q("[data-field=modality]").value;
    set(
      "modality",
      [
        ["auto", "Model default"],
        ...p.modalities.map((x) => [
          x,
          x === "AUDIO" ? "Speech + transcript" : "Text only",
        ]),
      ],
      mode,
      "auto",
    );
    q("[data-field=echoTarget]").parentElement.hidden = p.kind !== "translate";
    q("[data-field=prompt]").disabled =
      p.kind === "translate" || p.kind === "transcribe";
    q("[data-capabilities]").textContent = `${p.languages.length} model languages · ${p.voices ? catalog.voices.length + " Google AI Studio voices with tone" : "automatic voice / text only"}. ${p.note} Catalog: ${catalog.retrievedAt.slice(0, 10)}.`;
  };
  q("[data-field=preset]").onchange = (e) => {
    if (e.target.value !== "custom") q("[data-field=model]").value = e.target.value;
    else q("[data-field=model]").value = "custom-live";
    this.refreshCapabilities();
  };
  q("[data-field=model]").onchange = () => {
    q("[data-field=preset]").value = models.includes(q("[data-field=model]").value)
      ? q("[data-field=model]").value
      : "custom";
    this.refreshCapabilities();
  };
  for (const name of ["source", "target", "voice"])
    q(`[data-field=${name}]`).onchange = () => {
      q(`[data-field=${name}Custom]`).parentElement.hidden =
        q(`[data-field=${name}]`).value !== "__custom";
      if (name === "voice") {
        const cur = q("[data-field=voice]").value;
        const meta = catalog.voices.find(
          (v) => v.name.toLowerCase() === cur.toLowerCase(),
        );
        const vInfoEl = q("[data-voice-info]");
        if (meta) {
          vInfoEl.hidden = false;
          vInfoEl.innerHTML = `<strong>${meta.name}</strong> · ${meta.description} &bull; <em>${meta.persona || "Featured Studio Voice"}</em> (${meta.gender || ""}, ${meta.pitch || ""} pitch). ${meta.details || ""}`;
        } else {
          vInfoEl.hidden = true;
        }
      }
    };
  q("[data-field=delivery]").onchange = () => {
    q("[data-field=deliveryCustom]").parentElement.hidden =
      q("[data-field=delivery]").value !== "custom";
  };

  this.status = (s) => {
    q(".status").textContent = s;
  };
  this.clear = () => {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
    }
    this.sources.clear();
    this.next = 0;
  };
  this.text = (kind, text) => {
    if (!text) return;
    const entry = { time: new Date().toISOString(), kind, text };
    const last = this.transcript.at(-1);
    if (last?.kind === kind) last.text += text;
    else this.transcript.push(entry);
    if (this.transcript.length > 2000) this.transcript.shift();
    q(".transcript").textContent = this.transcript
      .map(
        (x) => `${x.kind === "input" ? "Original" : "Translation"} · ${x.text}`,
      )
      .join("\n\n");
    q(".transcript").scrollTop = 1e8;
  };
  this.stop = async (reason = "Stopped") => {
    this.active = false;
    this.epoch++;
    clearInterval(this.timer);
    await api.call("stop", id);
    this.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audio?.pause();
    if (this.audio) this.audio.srcObject = null;
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.status(reason);
    q("fieldset").disabled = false;
    q("[data-action=start]").disabled = false;
    q("[data-action=pause]").disabled = true;
    q("[data-action=stop]").disabled = true;
    q("progress").value = 0;
    lockCommon();
  };
  this.start = async () => {
    if (this.active) return;
    const c = this.config();
    for (const x of el.querySelectorAll("input"))
      if (!x.checkValidity())
        throw Error("Check " + x.parentElement.textContent.trim());
    if ((!c.target && profile(c.model).target) || !c.model)
      throw Error("Model and target language are required.");
    if (c.maxBuffer <= c.buffer)
      throw Error("Maximum queue must exceed playback buffer.");
    JSON.parse(c.advanced);
    this.c = c;
    q("[data-stat=latency]").textContent = "—";
    this.active = true;
    const epoch = ++this.epoch;
    this.paused = false;
    this.ready = false;
    this.speaking = false;
    this.lastLoud = 0;
    this.firstInput = 0;
    this.firstResponse = 0;
    this.stats = {
      inputSeconds: 0,
      outputSeconds: 0,
      droppedFrames: 0,
      queueResets: 0,
    };
    this.started = performance.now();
    usage.sessionsCount++;
    updateSpendDisplay();
    api.call("save", allSettings()).catch(() => {});
    q("fieldset").disabled = true;
    q("[data-action=start]").disabled = true;
    q("[data-action=stop]").disabled = false;
    q("[data-action=pause]").textContent = "Pause input";
    this.status("Connecting");
    lockCommon();
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId:
              !c.input || c.input === "default"
                ? undefined
                : { exact: c.input },
            channelCount: 1,
            echoCancellation: c.echo,
            noiseSuppression: c.noise,
            autoGainControl: c.agc,
          },
          video: false,
        });
      } catch (err) {
        if (c.input && c.input !== "default") {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: c.echo,
              noiseSuppression: c.noise,
              autoGainControl: c.agc,
            },
            video: false,
          });
        } else {
          throw err;
        }
      }
      if (epoch !== this.epoch) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.ctx = new AudioContext();
      await this.ctx.resume();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = c.gain;
      const dest = this.ctx.createMediaStreamDestination();
      this.gain.connect(dest);
      this.audio = new Audio();
      this.audio.srcObject = dest.stream;
      await this.audio.setSinkId(
        !c.output || c.output === "default" ? "" : c.output,
      );
      if (epoch !== this.epoch) return;
      await this.audio.play();
      if (epoch !== this.epoch) return;
      await this.ctx.audioWorklet.addModule("capture.js");
      if (epoch !== this.epoch) return;
      const work = new AudioWorkletNode(this.ctx, "capture", {
        processorOptions: { chunk: Number(c.chunk) },
      });
      const silence = this.ctx.createGain();
      silence.gain.value = 0;
      this.ctx.createMediaStreamSource(this.stream).connect(work);
      work.connect(silence).connect(this.ctx.destination);
      work.port.onmessage = (e) =>
        this.capture(e.data).catch((err) => {
          notice(err.message);
          this.stop("Audio error");
        });
      this.stream
        .getTracks()
        .forEach((t) => (t.onended = () => this.stop("Input disconnected")));
      this.timer = setInterval(() => {
        if (!this.active) return;
        const sec = Math.floor((performance.now() - this.started) / 1000);
        q("[data-stat=time]").textContent =
          `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
        q("[data-stat=queue]").textContent =
          Math.round(Math.max(0, this.next - this.ctx.currentTime) * 1000) +
          " ms";
        q("[data-stats]").textContent =
          `Sent ${this.stats.inputSeconds.toFixed(1)}s · Received ${this.stats.outputSeconds.toFixed(1)}s · Dropped ${this.stats.droppedFrames} · Queue resets ${this.stats.queueResets}`;
        if (sec >= c.maxSeconds) this.stop("Session limit reached");
        if (
          c.stopAfterSilence > 0 &&
          this.lastLoud &&
          now - this.lastLoud > c.stopAfterSilence * 1000
        ) {
          this.stop(`Auto-stopped after ${c.stopAfterSilence}s silence`);
        }
      }, 250);
      await api.call("connect", id, c);
      log(`${id}: connecting to ${c.provider} / ${c.model}`);
    } catch (e) {
      if (epoch !== this.epoch) return;
      await this.stop("Connection failed");
      throw e;
    }
  };
  this.capture = async (buffer) => {
    if (!this.active || !this.ready || this.paused) return;
    const pcm = new Int16Array(buffer);
    let sum = 0;
    for (const x of pcm) sum += (x / 32768) ** 2;
    const rms = Math.sqrt(sum / pcm.length);
    q("progress").value = Math.min(1, rms * 5);
    const now = performance.now(),
      loud = rms > this.c.threshold;
    if (loud) {
      this.lastLoud = now;
      if (!this.firstInput) this.firstInput = now;
    }
    if (manual(this.c)) {
      if (loud && !this.speaking) {
        this.speaking = true;
        await api.call("send", id, { realtimeInput: { activityStart: {} } });
      }
      if (!this.speaking) return;
    }
    const b64 = arrayBufferToBase64(buffer);
    api
      .call("send", id, {
        realtimeInput: {
          audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
        },
      })
      .then((sent) => {
        if (sent) {
          this.stats.inputSeconds += pcm.length / 16000;
          recordUsage(pcm.length / 16000, 0);
        } else {
          this.stats.droppedFrames++;
        }
      })
      .catch(() => {
        this.stats.droppedFrames++;
      });
    if (
      manual(this.c) &&
      this.speaking &&
      now - this.lastLoud > this.c.silence
    ) {
      this.speaking = false;
      await api.call("send", id, { realtimeInput: { activityEnd: {} } });
    }
  };
  this.play = (data, mime) => {
    if (!this.ctx) return;
    const raw = atob(data),
      bytes = Uint8Array.from(raw, (x) => x.charCodeAt(0)),
      view = new DataView(bytes.buffer),
      rate = Number(/rate=(\d+)/.exec(mime || "")?.[1] || 24000),
      count = Math.floor(bytes.length / 2);
    if (!count) return;
    const b = this.ctx.createBuffer(1, count, rate),
      out = b.getChannelData(0);
    for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768;
    this.stats.outputSeconds += count / rate;
    recordUsage(0, count / rate);
    let start = Math.max(
      this.ctx.currentTime + this.c.buffer / 1000,
      this.next,
    );
    if ((start - this.ctx.currentTime + b.duration) * 1000 > this.c.maxBuffer) {
      this.clear();
      this.stats.queueResets++;
      start = this.ctx.currentTime + this.c.buffer / 1000;
    }
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.gain);
    this.sources.add(s);
    s.onended = () => this.sources.delete(s);
    const offset = Math.max(
      0,
      b.duration - (this.c.maxBuffer - this.c.buffer) / 1000,
    );
    s.start(start, offset);
    this.next = start + b.duration - offset;
  };
  this.message = (m) => {
    if (!this.active) return;
    if (m.goAway) {
      notice(`${id}: server session ending. Stop and restart to reconnect.`);
      log(`${id}: goAway ${JSON.stringify(m.goAway)}`);
    }
    if (m.usageMetadata) this.stats.usage = m.usageMetadata;
    const s = m.serverContent;
    if (!s) return;
    if (s.interrupted) this.clear();
    this.text("input", s.inputTranscription?.text);
    this.text("output", s.outputTranscription?.text);
    for (const p of s.modelTurn?.parts || []) {
      if (p.inlineData?.data)
        this.play(p.inlineData.data, p.inlineData.mimeType);
      if (p.text && !p.thought) this.text("output", p.text);
    }
    if (
      !this.firstResponse &&
      this.firstInput &&
      (s.outputTranscription || s.modelTurn)
    ) {
      this.firstResponse = performance.now();
      q("[data-stat=latency]").textContent =
        Math.round(this.firstResponse - this.firstInput) + " ms";
    }
  };
  q("[data-action=start]").onclick = guard(() => this.start());
  q("[data-action=stop]").onclick = guard(() => this.stop());
  q("[data-action=flush]").onclick = this.clear;
  q("[data-action=pause]").onclick = guard(async () => {
    this.paused = !this.paused;
    if (this.paused) {
      if (manual(this.c) && this.speaking)
        await api.call("send", id, { realtimeInput: { activityEnd: {} } });
      else if (!manual(this.c))
        await api.call("send", id, { realtimeInput: { audioStreamEnd: true } });
      this.speaking = false;
      q("progress").value = 0;
    }
    q("[data-action=pause]").textContent = this.paused
      ? "Resume input"
      : "Pause input";
    this.status(this.paused ? "Paused" : "Live");
  });
}
api.onEvent((e) => {
  if (e.id === "check") {
    if (e.type === "ready") {
      notice(
        "Connection verified: WebSocket and model setup accepted. No microphone audio was sent.",
      );
      $("#connectionStatus").textContent = "Model ready ✓";
      api.call("stop", "check");
      checking = false;
      lockCommon();
    }
    if (e.type === "error" || e.type === "closed") {
      notice(typeof e.data === "string" ? e.data : JSON.stringify(e.data));
      $("#connectionStatus").textContent = "Connection failed";
      api.call("stop", "check");
      checking = false;
      lockCommon();
    }
    log(
      `check: ${e.type} ${e.type === "message" ? "" : JSON.stringify(e.data)}`,
    );
    return;
  }
  const c = channels[e.id];
  if (!c?.active) return;
  if (e.type === "ready") {
    c.ready = true;
    c.status("● Live");
    c.q("[data-action=pause]").disabled = false;
    log(`${e.id}: model ready`);
  }
  if (e.type === "status") c.status(e.data);
  if (e.type === "message") c.message(e.data);
  if (e.type === "error" || e.type === "closed") {
    const msg =
      typeof e.data === "string"
        ? e.data
        : `Closed ${e.data.code}: ${e.data.reason}`;
    notice(msg);
    log(`${e.id}: ${msg}`);
    c.stop("Disconnected");
  }
});
const isToMeetOutput = (lbl) =>
  lbl.includes("To Meet Microphone") ||
  lbl.includes("EmotionCast_send_Output") ||
  (lbl.includes("EmotionCast") && lbl.includes("send_Output"));
const isFromMeetInput = (lbl) =>
  lbl.includes("From Meet Speaker") ||
  lbl.includes("EmotionCast_receive_Input") ||
  (lbl.includes("EmotionCast") && lbl.includes("receive_Input"));
const isMeetSpeaker = (lbl) =>
  lbl.includes("Google Meet Speaker") ||
  lbl.includes("EmotionCast_receive_Output");
const isMeetMicrophone = (lbl) =>
  lbl.includes("Google Meet Microphone") ||
  lbl.includes("EmotionCast_send_Input");
const isVirtual = (lbl) => lbl.toLowerCase().includes("emotioncast");

function updateRouteFeedback() {
  for (const c of Object.values(channels)) {
    for (const field of ["input", "output"]) {
      const select = c.q(`[data-field=${field}]`);
      const chip = document.querySelector(`[data-chip="${c.id}-${field}"]`);
      if (!select || !chip) continue;
      const optText = select.selectedOptions[0]?.textContent || "";
      const val = select.value;

      if (c.id === "speak") {
        if (field === "input") {
          if (optText.includes("Virtual cable") || optText.includes("Virtual Cable")) {
            chip.className = "route-chip err";
            chip.innerHTML = `⚠️ Virtual cable selected as mic! Select your real mic. <button type="button" class="chip-btn" data-action-reset="speak-input">Reset to default</button>`;
          } else {
            chip.className = "route-chip ok";
            chip.innerHTML = `✓ Real microphone active (${val === "default" ? "System default" : "Physical"})`;
          }
        } else if (field === "output") {
          if (isToMeetOutput(optText) || optText.includes("[Recommended")) {
            chip.className = "route-chip ok";
            chip.innerHTML = `✓ Correctly routed: Feeding translated voice to Google Meet Microphone`;
          } else if (isMeetSpeaker(optText) || optText.includes("Meet Speaker")) {
            chip.className = "route-chip err";
            chip.innerHTML = `❌ Wrong device! You selected Meet Speaker as output. Meet won't hear you! <button type="button" class="chip-btn" data-action-fix="speak-output">Auto-Fix to Meet Output</button>`;
          } else {
            chip.className = "route-chip info";
            chip.innerHTML = `ℹ️ Local speaker test mode (Not broadcasting into Google Meet). <button type="button" class="chip-btn" data-action-fix="speak-output">Switch to Meet</button>`;
          }
        }
      } else if (c.id === "listen") {
        if (field === "input") {
          if (isFromMeetInput(optText) || optText.includes("[Recommended")) {
            chip.className = "route-chip ok";
            chip.innerHTML = `✓ Correctly routed: Capturing voices from Google Meet Speaker`;
          } else if (isMeetMicrophone(optText) || optText.includes("Meet Mic")) {
            chip.className = "route-chip err";
            chip.innerHTML = `❌ Wrong device! You selected Meet Mic as input. <button type="button" class="chip-btn" data-action-fix="listen-input">Auto-Fix to Meet Input</button>`;
          } else {
            chip.className = "route-chip info";
            chip.innerHTML = `ℹ️ Local mic test mode (Not capturing from Google Meet). <button type="button" class="chip-btn" data-action-fix="listen-input">Switch to Meet</button>`;
          }
        } else if (field === "output") {
          if (optText.includes("Virtual cable") || optText.includes("Virtual Cable")) {
            chip.className = "route-chip err";
            chip.innerHTML = `⚠️ Virtual cable selected as headphones! Causes echo loop. <button type="button" class="chip-btn" data-action-reset="listen-output">Reset to default</button>`;
          } else {
            chip.className = "route-chip ok";
            chip.innerHTML = `✓ Real headphones active (${val === "default" ? "System default" : "Physical"})`;
          }
        }
      }
    }
  }
}

document.addEventListener("click", (e) => {
  const fix = e.target.closest("[data-action-fix]");
  if (fix) {
    const target = fix.dataset.actionFix;
    if (target === "speak-output") {
      const select = channels.speak?.q("[data-field=output]");
      if (select) {
        const opt = [...select.options].find((o) => isToMeetOutput(o.textContent));
        if (opt) select.value = opt.value;
      }
    } else if (target === "listen-input") {
      const select = channels.listen?.q("[data-field=input]");
      if (select) {
        const opt = [...select.options].find((o) => isFromMeetInput(o.textContent));
        if (opt) select.value = opt.value;
      }
    }
    updateRouteFeedback();
    notice("Route auto-fixed for Google Meet.");
    return;
  }
  const reset = e.target.closest("[data-action-reset]");
  if (reset) {
    const target = reset.dataset.actionReset;
    if (target === "speak-input") {
      channels.speak?.q("[data-field=input]") && (channels.speak.q("[data-field=input]").value = "default");
    } else if (target === "listen-output") {
      channels.listen?.q("[data-field=output]") && (channels.listen.q("[data-field=output]").value = "default");
    }
    updateRouteFeedback();
    notice("Reset device to default physical hardware.");
    return;
  }
});

async function refresh(permission = true, autoAssignMeet = false) {
  if (permission) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {}
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const c of Object.values(channels)) {
    for (const [field, kind] of [
      ["input", "audioinput"],
      ["output", "audiooutput"],
    ]) {
      const select = c.q(`[data-field=${field}]`),
        value = select.value || saved.channels?.[c.id]?.[field] || "default";
      select.replaceChildren();

      let defaultLabel = "System default";
      if (c.id === "speak" && field === "input") defaultLabel = "System default (Physical Microphone)";
      else if (c.id === "speak" && field === "output") defaultLabel = "System default (Local Speaker - Test Only)";
      else if (c.id === "listen" && field === "input") defaultLabel = "System default (Physical Mic - Test Only)";
      else if (c.id === "listen" && field === "output") defaultLabel = "System default (Physical Headphones)";

      select.add(new Option(defaultLabel, "default"));

      for (const d of devices.filter((d) => d.kind === kind)) {
        const o = document.createElement("option");
        o.value = d.deviceId;
        const lbl = d.label || `${kind} ${select.length}`;

        if (c.id === "speak") {
          if (field === "input") {
            o.textContent = isVirtual(lbl)
              ? `⚠️ ${lbl} (Virtual cable - Do NOT select as your mic)`
              : `${lbl} (Physical Microphone)`;
          } else {
            if (isToMeetOutput(lbl)) {
              o.textContent = `★ ${lbl} [Recommended for Speak Channel]`;
            } else if (isMeetSpeaker(lbl)) {
              o.textContent = `⚠️ ${lbl} (Meet Speaker - Do NOT select for Speak Output)`;
            } else if (isVirtual(lbl)) {
              o.textContent = `⚠️ ${lbl} (Virtual Cable)`;
            } else {
              o.textContent = `${lbl} (Local Speaker - Test Only)`;
            }
          }
        } else {
          if (field === "input") {
            if (isFromMeetInput(lbl)) {
              o.textContent = `★ ${lbl} [Recommended for Listen Channel]`;
            } else if (isMeetMicrophone(lbl)) {
              o.textContent = `⚠️ ${lbl} (Meet Mic - Do NOT select for Listen Input)`;
            } else if (isVirtual(lbl)) {
              o.textContent = `⚠️ ${lbl} (Virtual Cable)`;
            } else {
              o.textContent = `${lbl} (Physical Mic - Test Only)`;
            }
          } else {
            o.textContent = isVirtual(lbl)
              ? `⚠️ ${lbl} (Virtual cable - Do NOT select for Headphones)`
              : `${lbl} (Physical Headphones / Speaker)`;
          }
        }
        select.append(o);
      }

      let assigned = false;
      if (autoAssignMeet) {
        if (c.id === "speak" && field === "output") {
          const opt = [...select.options].find((o) => isToMeetOutput(o.textContent));
          if (opt) {
            select.value = opt.value;
            assigned = true;
          }
        } else if (c.id === "listen" && field === "input") {
          const opt = [...select.options].find((o) => isFromMeetInput(o.textContent));
          if (opt) {
            select.value = opt.value;
            assigned = true;
          }
        }
        if (c.id === "speak" && field === "input") {
          if (select.selectedOptions[0]?.textContent.includes("Virtual cable")) {
            select.value = "default";
            assigned = true;
          }
        } else if (c.id === "listen" && field === "output") {
          if (select.selectedOptions[0]?.textContent.includes("Virtual cable")) {
            select.value = "default";
            assigned = true;
          }
        }
      }
      if (!assigned) {
        select.value = [...select.options].some((o) => o.value === value)
          ? value
          : "default";
      }

      select.onchange = () => updateRouteFeedback();
    }
  }
  updateRouteFeedback();
  notice("Audio devices refreshed.");
}
$("#provider").onchange = () => {
  $("#base").value =
    $("#provider").value === "gemini"
      ? "https://generativelanguage.googleapis.com"
      : "https://llmfoundry.straivedemo.com/gemini";
  $("#key").value = "";
  notice("Provider changed. Set its key if you have not already.");
};
$("#saveKey").onclick = guard(async () => {
  await api.call(
    "key",
    $("#provider").value,
    $("#key").value,
    $("#remember").checked,
  );
  $("#key").value = "";
  notice("API key set.");
});
$("#forgetKey").onclick = guard(async () => {
  await api.call("key", $("#provider").value, "", false);
  $("#key").value = "";
  notice("Saved key removed.");
});
$("#save").onclick = guard(async () => {
  await api.call("save", allSettings());
  notice("Settings saved locally.");
});
$("#reset").onclick = guard(async () => {
  if (
    !confirm(
      "Reset connection and channel settings? Saved keys and virtual devices are retained.",
    )
  )
    return;
  saved = {};
  for (const n of ["provider", "base", "version", "project"])
    $("#" + n).value = defaults[n];
  for (const c of Object.values(channels))
    fill(c, { ...defaults, target: c.id === "listen" ? "en" : "hi" });
  applyTheme("system");
  applyZoom(1.05);
  applyTuningValues(tuningPresets["low"]);
  await api.call("save", allSettings());
  notice("Settings reset.");
});
$("#check").onclick = guard(async () => {
  checking = true;
  lockCommon();
  $("#connectionStatus").textContent = "Checking speak channel model…";
  try {
    await api.call("connect", "check", channels.speak.config());
  } catch (e) {
    checking = false;
    $("#connectionStatus").textContent = "Connection failed";
    lockCommon();
    throw e;
  }
});
$("#stopAll").onclick = guard(async () => {
  checking = false;
  await api.call("stop", "check");
  await Promise.all(Object.values(channels).map((c) => c.stop()));
  lockCommon();
  notice("All audio sessions stopped.");
});
$("#refresh").onclick = guard(() => refresh());
navigator.mediaDevices.ondevicechange = () =>
  refresh(false).catch((e) => notice(e.message));
for (const [button, action] of [
  ["createRoutes", "create"],
  ["removeRoutes", "remove"],
])
  $("#" + button).onclick = guard(async () => {
    if (
      action === "remove" &&
      !confirm(
        "Remove EmotionCast virtual devices? Apps using them will lose those devices.",
      )
    )
      return;
    const result = await api.call("routes", action);
    $("#routeStatus").textContent = result.sinks + "\n" + result.sources;
    await refresh(false, action === "create");
    notice(
      action === "create"
        ? "Virtual devices active! In Google Meet Settings: Set Mic to 'EmotionCast (Google Meet Microphone)' and Speaker to 'EmotionCast (Google Meet Speaker)'."
        : "Virtual devices removed.",
    );
  });
$("#autoRouteMeet").onclick = guard(async () => {
  await api.call("routes", "create").catch(() => {});
  await refresh(false, true);
  notice("Google Meet routes configured! In Google Meet Settings: Set Mic to 'EmotionCast (Google Meet Microphone)' and Speaker to 'EmotionCast (Google Meet Speaker)'.");
});
$("#export").onclick = guard(() =>
  api.call("export", {
    exportedAt: new Date().toISOString(),
    settings: allSettings(),
    channels: Object.fromEntries(
      Object.entries(channels).map(([id, c]) => [
        id,
        { transcript: c.transcript, stats: c.stats },
      ]),
    ),
    logs,
  }),
);
$("#clear").onclick = () => {
  logs.length = 0;
  $("#log").textContent = "No activity yet.";
  for (const c of Object.values(channels)) {
    c.transcript = [];
    c.q(".transcript").textContent = "";
  }
};
document.querySelectorAll(".theme-chip").forEach((chip) => {
  chip.onclick = () => {
    applyTheme(chip.dataset.themeVal);
    api.call("save", allSettings()).catch(() => {});
  };
});
$("#zoomIn").onclick = () => changeZoom(1);
$("#zoomOut").onclick = () => changeZoom(-1);
$("#zoomReset").onclick = () => {
  applyZoom(1.05);
  api.call("save", allSettings()).catch(() => {});
};
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      changeZoom(1);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      changeZoom(-1);
    } else if (e.key === "0") {
      e.preventDefault();
      applyZoom(1.05);
      api.call("save", allSettings()).catch(() => {});
    }
  }
});
$("#tuningPreset").onchange = () => {
  const p = tuningPresets[$("#tuningPreset").value];
  if (p) {
    $("#tuningChunk").value = p.chunk;
    $("#tuningBuffer").value = p.buffer;
    $("#tuningMaxBuffer").value = p.maxBuffer;
    $("#tuningStopAfterSilence").value = p.stopAfterSilence;
  }
};
["#tuningChunk", "#tuningBuffer", "#tuningMaxBuffer", "#tuningStopAfterSilence"].forEach((sel) => {
  const el = $(sel);
  if (el)
    el.oninput = () => {
      $("#tuningPreset").value = "custom";
    };
});
$("#saveTuningBtn").onclick = guard(async () => {
  const t = {
    preset: $("#tuningPreset").value,
    chunk: Number($("#tuningChunk").value) || 40,
    buffer: Number($("#tuningBuffer").value) || 60,
    maxBuffer: Number($("#tuningMaxBuffer").value) || 1500,
    stopAfterSilence: Number($("#tuningStopAfterSilence").value) || 0,
  };
  applyTuningValues(t);
  await api.call("save", allSettings());
  notice("Latency & session tuning saved! Applied on next start in either direction.");
});
$("#clearDelayedAudioBtn").onclick = () => {
  for (const c of Object.values(channels)) {
    c.clear();
  }
  notice("Delayed audio cleared immediately.");
};
$("#viewUsageLink").onclick = (e) => {
  e.preventDefault();
  $("#usageModal").hidden = !$("#usageModal").hidden;
};
$("#closeUsageBtn").onclick = () => {
  $("#usageModal").hidden = true;
};
$("#resetUsageBtn").onclick = guard(async () => {
  usage = { audioInSeconds: 0, audioOutSeconds: 0, sessionsCount: 0 };
  updateSpendDisplay();
  await api.call("save", allSettings());
  notice("Usage statistics reset.");
});
const initial = await api.call("load");
saved = initial.settings;
applyTheme(saved.theme || "system");
applyZoom(typeof saved.zoom === "number" ? saved.zoom : 1.05);
if (saved.tuning && saved.tuning.preset) applyTuningValues(saved.tuning);
else applyTuningValues(tuningPresets["low"]);
if (saved.usage) usage = { ...usage, ...saved.usage };
updateSpendDisplay();
for (const n of ["provider", "base", "version", "project"])
  $("#" + n).value = saved[n] ?? defaults[n];
for (const c of Object.values(channels))
  fill(c, {
    ...defaults,
    target: c.id === "listen" ? "en" : "hi",
    ...saved.channels?.[c.id],
  });
$("#platform").textContent = initial.platform.toUpperCase() + " · DESKTOP";
$("#remember").disabled = !initial.secure;
notice(
  `Ready. ${initial.keys.length ? "Stored keys: " + initial.keys.join(", ") + "." : "Set your API key to connect."} ${initial.secure ? "OS key encryption available." : "Keys are session-only: secure OS key storage unavailable."}`,
);
await refresh(false).catch(() => {});
