import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  models,
  setup,
  connection,
  manual,
} from "../app/protocol.js";
test("six models use correct modalities and model-specific setup", () => {
  assert.equal(models.length, 6);
  for (const model of models) {
    const c = { ...defaults, model },
      s = setup(c).setup;
    assert.equal(
      s.generationConfig.responseModalities[0],
      /transcribe|robotics/.test(model) ? "TEXT" : "AUDIO",
    );
    assert.equal(
      s.realtimeInputConfig.automaticActivityDetection.disabled === true,
      model.startsWith("gemini-3.8"),
    );
    if (model.includes("translate"))
      assert.equal(
        s.generationConfig.translationConfig.targetLanguageCode,
        "hi",
      );
    if (model.includes("extended-thinking"))
      assert.equal(s.generationConfig.thinkingConfig.thinkingLevel, "LOW");
  }
});
test("Foundry retains proxy prefix and sends bearer auth without putting key in URL", () => {
  const c = connection(
    {
      ...defaults,
      provider: "foundry",
      base: "https://llmfoundry.straivedemo.com/gemini",
    },
    "secret",
  );
  assert.match(c.url, /\/gemini\/ws\/google/);
  assert.ok(!c.url.includes("secret"));
  assert.equal(c.headers.Authorization, "Bearer secret:emotioncast-desktop");
});
test("direct endpoint and alpha version", () => {
  assert.match(
    connection({ ...defaults, version: "v1alpha" }, "test").url,
    /v1alpha.*\?key=test/,
  );
  assert.throws(() =>
    connection({ ...defaults, base: "http://example.com" }, "x"),
  );
  assert.throws(() =>
    connection({ ...defaults, base: "https://example.com?key=abc" }, "x"),
  );
});
test("custom model and overrides remain configurable", () => {
  assert.equal(
    setup({
      ...defaults,
      model: "custom-live",
      advanced: '{"generationConfig":{"responseModalities":["TEXT"]}}',
    }).setup.generationConfig.responseModalities[0],
    "TEXT",
  );
  assert.throws(() => setup({ ...defaults, advanced: "[]" }));
  assert.equal(manual({ ...defaults, vad: "manual" }), true);
});
