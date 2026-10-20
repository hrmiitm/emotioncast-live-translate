import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, profile, normalizeLanguage, deliveryStyles } from '../app/capabilities.js';
import { setup, defaults } from '../app/protocol.js';

test('scraped language catalogs preserve regional codes and Norwegian aliases', () => {
  assert.equal(catalog.languages.translate.length, 79);
  assert.equal(catalog.languages.transcribe.length, 84);
  assert.equal(catalog.languages.live.length, 100);
  assert.ok(catalog.languages.translate.some((x) => x.code === 'zh-Hant'));
  assert.ok(catalog.languages.transcribe.some((x) => x.code === 'en-IN'));
  assert.equal(normalizeLanguage('hi', profile('gemini-3.5-transcribe-live'), 'auto'), 'hi-IN');
});

test('translation voice overrides are omitted and echo is configurable', () => {
  const s = setup({ ...defaults, model: 'gemini-3.5-live-translate-preview', voice: 'Kore', echoTarget: false }).setup;
  assert.equal(s.generationConfig.speechConfig, undefined);
  assert.equal(s.generationConfig.translationConfig.echoTargetLanguage, false);
});

test('native voice and delivery use appropriate fields and target survives custom instruction', () => {
  const s = setup({
    ...defaults,
    model: 'gemini-3.8-live',
    source: 'en',
    target: 'hi',
    voice: 'Sulafat',
    delivery: 'warm',
    prompt: 'Keep names unchanged.',
  }).setup;
  assert.equal(s.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Sulafat');
  assert.match(s.systemInstruction.parts[0].text, /Hindi/);
  assert.match(s.systemInstruction.parts[0].text, /warm/);
  assert.match(s.systemInstruction.parts[0].text, /Keep names/);
});

test('transcription has no translation target and invalid language/modality fails early', () => {
  assert.equal(profile('gemini-3.5-transcribe-live').target, false);
  const s = setup({ ...defaults, model: 'gemini-3.5-transcribe-live', source: 'hi-IN', target: '' }).setup;
  assert.deepEqual(s.inputAudioTranscription.languageCodes, ['hi-IN']);
  assert.equal(s.systemInstruction, undefined);
  assert.throws(() => setup({ ...defaults, target: 'bogus' }));
  assert.throws(() => setup({ ...defaults, model: 'gemini-3.8-live', modality: 'TEXT' }));
});

test('enriched voices include gender, pitch, persona, and description metadata', () => {
  assert.ok(catalog.voices.length >= 30);
  const puck = catalog.voices.find((v) => v.name === 'Puck');
  assert.ok(puck);
  assert.equal(puck.description, 'Upbeat');
  assert.equal(puck.gender, 'male');
  assert.equal(puck.pitch, 'low');
  assert.ok(puck.persona);
  assert.ok(puck.details);

  const kore = catalog.voices.find((v) => v.name === 'Kore');
  assert.ok(kore);
  assert.equal(kore.gender, 'female');
});

test('affective dialog and custom tone prompts configure Gemini 3.8 correctly', () => {
  const s = setup({
    ...defaults,
    version: 'v1alpha',
    model: 'gemini-3.8-live',
    affectiveDialog: true,
    delivery: 'custom',
    deliveryCustom: 'laid-back late-night radio DJ',
  }).setup;
  assert.equal(s.enableAffectiveDialog, true);
  assert.match(s.systemInstruction.parts[0].text, /laid-back late-night radio DJ/);
});
