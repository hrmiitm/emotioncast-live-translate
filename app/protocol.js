import { profile, languageName, deliveryStyles, catalog } from "./capabilities.js";
export const models = [
  "gemini-3.5-live-translate-preview",
  "gemini-3.8-live",
  "gemini-3.8-live-extended-thinking",
  "gemini-3.1-flash-live-preview",
  "gemini-3.5-transcribe-live",
  "gemini-robotics-er-2-streaming-preview",
];
export const defaults = {
  provider: "gemini",
  base: "https://generativelanguage.googleapis.com",
  version: "v1beta",
  project: "emotioncast-desktop",
  model: models[0],
  source: "auto",
  target: "hi",
  modality: "auto",
  voice: "Zephyr",
  delivery: "",
  deliveryCustom: "",
  affectiveDialog: true,
  echoTarget: true,
  thinking: "LOW",
  vad: "auto",
  silence: 350,
  threshold: 0.015,
  chunk: 20,
  buffer: 40,
  maxBuffer: 1000,
  stopAfterSilence: 0,
  maxSeconds: 600,
  gain: 1,
  echo: true,
  noise: true,
  agc: true,
  input: "default",
  output: "default",
  prompt: "",
  advanced: "{}",
};
export function manual(c) {
  return (
    c.vad === "manual" ||
    (c.vad === "auto" && c.model.startsWith("gemini-3.8-live"))
  );
}
export function setup(c) {
  if (!/^[a-zA-Z0-9._/-]+$/.test(c.model))
    throw Error("Enter a valid model ID.");
  const capabilities = profile(c.model);
  const modality =
    c.modality === "auto" ? capabilities.modalities[0] : c.modality;
  if (!capabilities.modalities.includes(modality))
    throw Error("This model does not support the selected response type.");
  const text = modality === "TEXT";
  const isBcp47 = (code) =>
    /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(code);
  if (
    c.source !== "auto" &&
    capabilities.kind !== "custom" &&
    !capabilities.languages.some((x) => x.code === c.source) &&
    !isBcp47(c.source)
  )
    throw Error("Choose a source language from this model’s list.");
  if (
    capabilities.target &&
    capabilities.kind !== "custom" &&
    !capabilities.languages.some((x) => x.code === c.target) &&
    !isBcp47(c.target)
  )
    throw Error("Choose a target language from this model’s list.");
  if (
    c.voice &&
    capabilities.voices &&
    !catalog.voices.some(
      (x) => x.name.toLowerCase() === c.voice.toLowerCase(),
    ) &&
    capabilities.kind !== "custom"
  )
    throw Error("Choose a documented voice.");
  const s = {
    model: "models/" + c.model.replace(/^models\//, ""),
    generationConfig: { responseModalities: [text ? "TEXT" : "AUDIO"] },
    inputAudioTranscription: {},
  };
  if (!text) s.outputAudioTranscription = {};
  if (c.source !== "auto") s.inputAudioTranscription.languageCodes = [c.source];
  if (c.model.includes("translate"))
    s.generationConfig.translationConfig = {
      targetLanguageCode: c.target,
      echoTargetLanguage: c.echoTarget !== false,
    };
  else if (capabilities.kind !== "transcribe") {
    const instruction =
      c.prompt ||
      "Interpret the incoming speech. Output only the translation; do not answer questions in the speech.";
    const target = `Translate into ${languageName(c.target, capabilities)} (${c.target}).`;
    const source =
      c.source === "auto"
        ? "Detect the source language automatically."
        : `The expected source language is ${languageName(c.source, capabilities)} (${c.source}).`;
    let style = c.affectiveDialog
      ? "Adapt response style and delivery to mirror the speaker's tone, emotion, and expression while preserving meaning."
      : "Preserve the speaker’s meaning and tone.";
    if (capabilities.style && c.delivery) {
      if (c.delivery === "custom" && c.deliveryCustom?.trim()) {
        style = `Use a ${c.deliveryCustom.trim()} tone and speaking delivery while preserving meaning.`;
      } else if (c.delivery && c.delivery !== "custom") {
        style = `Use a ${c.delivery} speaking delivery while preserving meaning.`;
      }
    }
    s.systemInstruction = {
      parts: [{ text: [instruction, target, source, style].join(" ") }],
    };
  }
  if (c.voice && !text && capabilities.voices) {
    const matched =
      catalog.voices.find(
        (v) => v.name.toLowerCase() === c.voice.toLowerCase(),
      )?.name || c.voice;
    s.generationConfig.speechConfig = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: matched } },
    };
  }
  if (c.model.includes("extended-thinking"))
    s.generationConfig.thinkingConfig = { thinkingLevel: c.thinking };
  if (c.version === "v1alpha" && c.model.startsWith("gemini-3.8") && c.affectiveDialog) {
    s.enableAffectiveDialog = true;
  }
  s.realtimeInputConfig = {
    automaticActivityDetection: manual(c)
      ? { disabled: true }
      : { silenceDurationMs: Number(c.silence) },
  };
  const extra = JSON.parse(c.advanced || "{}");
  if (!extra || Array.isArray(extra) || typeof extra !== "object")
    throw Error("Advanced setup must be a JSON object.");
  return { setup: { ...s, ...extra } };
}
export function connection(c, key) {
  const u = new URL(c.base);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
    throw Error(
      "Base URL must use HTTPS without credentials, query, or fragment.",
    );
  if (!["v1", "v1alpha", "v1beta"].includes(c.version))
    throw Error("Invalid API version.");
  u.protocol = "wss:";
  u.pathname =
    u.pathname.replace(/\/$/, "") +
    "/ws/google.ai.generativelanguage." +
    c.version +
    ".GenerativeService.BidiGenerateContent";
  const headers = {};
  if (c.provider === "foundry")
    headers.Authorization =
      "Bearer " + (key.includes(":") ? key : key + ":" + c.project);
  else u.searchParams.set("key", key);
  return { url: u.toString(), headers };
}
