import { catalog } from './catalog-data.js';
export { catalog };

export const deliveryStyles = [
  ['', 'Natural · preserve the speaker’s tone'],
  ['calm', 'Calm and measured'],
  ['warm', 'Warm and friendly'],
  ['professional', 'Professional and clear'],
  ['upbeat', 'Upbeat and energetic'],
  ['gentle', 'Gentle and reassuring'],
  ['serious', 'Serious and composed'],
  ['conversational', 'Casual and conversational'],
  ['informative', 'Informative and educational'],
  ['urgent', 'Fast-paced and dynamic'],
  ['custom', 'Custom tone prompt…'],
];

export function profile(model) {
  const id = model.replace(/^models\//, '');
  if (id === 'gemini-3.5-live-translate-preview')
    return {
      kind: 'translate',
      languages: catalog.languages.translate,
      source: catalog.sources.translate,
      voices: false,
      style: false,
      affective: false,
      target: true,
      modalities: ['AUDIO'],
      note: 'Live Translate uses its own language list and preserves the original speaker’s voice. Named voices and tone instructions are not part of its documented configuration.',
    };
  if (id === 'gemini-3.5-transcribe-live')
    return {
      kind: 'transcribe',
      languages: catalog.languages.transcribe,
      source: catalog.sources.transcribe,
      voices: false,
      style: false,
      affective: false,
      target: false,
      modalities: ['TEXT'],
      note: 'Source language is a recognition hint. Transcribe returns the original speech as text; it has no translation target or spoken voice.',
    };
  if (['gemini-3.8-live', 'gemini-3.8-live-extended-thinking', 'gemini-3.1-flash-live-preview'].includes(id))
    return {
      kind: 'native',
      languages: catalog.languages.live,
      source: catalog.sources.live,
      voices: true,
      style: true,
      affective: id.startsWith('gemini-3.8'),
      target: true,
      modalities: ['AUDIO'],
      note: 'Uses Google’s Live API language list. Supports Google AI Studio voices, tone delivery instructions, and real-time bidirectional translation.',
    };
  if (id === 'gemini-robotics-er-2-streaming-preview')
    return {
      kind: 'robotics',
      languages: catalog.languages.live,
      source: 'https://ai.google.dev/gemini-api/docs/robotics-streaming',
      voices: false,
      style: false,
      affective: false,
      target: true,
      modalities: ['TEXT'],
      note: 'Text output only. Shared Live API language suggestions; robotics streaming preview.',
    };
  return {
    kind: 'custom',
    languages: catalog.languages.live,
    source: catalog.sources.live,
    voices: true,
    style: true,
    affective: true,
    target: true,
    modalities: ['AUDIO', 'TEXT'],
    note: 'Custom model: shared Live API suggestions. Supports any custom model ID, language code, and voice name.',
  };
}

export function languageName(code, p) {
  return p.languages.find((x) => x.code === code)?.name || code;
}

export function normalizeLanguage(value, p, fallback) {
  if (p.languages.some((x) => x.code === value) || value === 'auto') return value;
  const aliases = { zh: 'zh-Hans', pt: 'pt-BR', nb: 'no', nn: 'no' };
  if (aliases[value] && p.languages.some((x) => x.code === aliases[value])) return aliases[value];
  const base = value?.split('-')[0];
  const exactBase = p.languages.find((x) => x.code === base);
  if (exactBase) return exactBase.code;
  const near = p.languages.find((x) => x.code.split('-')[0] === base);
  return near?.code || fallback;
}
