import type { VoiceInfo } from './types'

import {
  isQwen3TtsRealtimeModel,
  QWEN3_TTS_REALTIME_DEFAULT_MODEL,
  QWEN3_TTS_REALTIME_MODEL_IDS,
} from './qwen3-tts-realtime-models'

export interface Qwen3TtsRealtimeVoiceLanguage {
  code: string
  title: string
}

export interface Qwen3TtsRealtimeVoiceCatalogEntry {
  id: string
  name: string
  description: string
  compatibleModels: readonly typeof QWEN3_TTS_REALTIME_MODEL_IDS[number][]
  languages: readonly Qwen3TtsRealtimeVoiceLanguage[]
  gender?: 'female' | 'male'
  languageNotes?: string
}

const standardLanguages = [
  { code: 'zh', title: 'Chinese (Mandarin)' },
  { code: 'en', title: 'English' },
  { code: 'fr', title: 'French' },
  { code: 'de', title: 'German' },
  { code: 'ru', title: 'Russian' },
  { code: 'it', title: 'Italian' },
  { code: 'es', title: 'Spanish' },
  { code: 'pt', title: 'Portuguese' },
  { code: 'ja', title: 'Japanese' },
  { code: 'ko', title: 'Korean' },
] as const

const flashOnly = [QWEN3_TTS_REALTIME_DEFAULT_MODEL] as const
const bothModels = QWEN3_TTS_REALTIME_MODEL_IDS

/**
 * Official Qwen-TTS realtime system voices, limited to the two accepted
 * stable Qwen3 realtime models. Compatibility is intentionally per entry;
 * it is not computed as an all-voices-by-all-models cross product.
 *
 * Source: https://www.alibabacloud.com/help/en/model-studio/qwen-tts-voice-list
 * Retrieved 2026-09-05; the page reports Last Updated: Sep 02, 2026.
 */
export const QWEN3_TTS_REALTIME_VOICE_CATALOG = [
  { id: 'Cherry', name: 'Cherry', description: 'A sunny, positive, friendly, and natural young woman.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Serena', name: 'Serena', description: 'A gentle young woman.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Ethan', name: 'Ethan', description: 'Standard Mandarin with a slight northern accent. Sunny, warm, energetic, and vibrant.', compatibleModels: bothModels, languages: standardLanguages, gender: 'male' },
  { id: 'Chelsie', name: 'Chelsie', description: 'A two-dimensional virtual girlfriend.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Momo', name: 'Momo', description: 'Playful and mischievous, cheering you up.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Vivian', name: 'Vivian', description: 'Confident, cute, and slightly feisty.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Moon', name: 'Moon', description: 'A bold and handsome man named Yuebai.', compatibleModels: bothModels, languages: standardLanguages, gender: 'male' },
  { id: 'Maia', name: 'Maia', description: 'A blend of intellect and gentleness.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Kai', name: 'Kai', description: 'A soothing audio spa for your ears.', compatibleModels: bothModels, languages: standardLanguages, gender: 'male' },
  { id: 'Nofish', name: 'Nofish', description: 'A designer who cannot pronounce retroflex sounds.', compatibleModels: bothModels, languages: standardLanguages, gender: 'male' },
  { id: 'Bella', name: 'Bella', description: 'A playful young woman with a bubbly, mischievous tone.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Jennifer', name: 'Jennifer', description: 'A premium, cinematic-quality American English female voice.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'female' },
  { id: 'Ryan', name: 'Ryan', description: 'Full of rhythm, bursting with dramatic flair, balancing authenticity and tension.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'male' },
  { id: 'Katerina', name: 'Katerina', description: 'A mature-woman voice with rich, memorable rhythm.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'female' },
  { id: 'Aiden', name: 'Aiden', description: 'An American English young man skilled in cooking.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'male' },
  { id: 'Eldric Sage', name: 'Eldric Sage', description: 'A calm and wise elder, weathered like a pine tree yet clear-minded as a mirror.', compatibleModels: bothModels, languages: standardLanguages, gender: 'male' },
  { id: 'Mia', name: 'Mia', description: 'Gentle as spring water, obedient as fresh snow.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Mochi', name: 'Mochi', description: 'A clever, quick-witted young adult with childlike innocence and wisdom.', compatibleModels: bothModels, languages: standardLanguages, gender: 'male' },
  { id: 'Bellona', name: 'Bellona', description: 'A powerful, clear voice that brings characters to life with heroic grandeur and perfect diction.', compatibleModels: bothModels, languages: standardLanguages },
  { id: 'Vincent', name: 'Vincent', description: 'A uniquely raspy, smoky voice that evokes armies and heroic tales.', compatibleModels: bothModels, languages: standardLanguages, gender: 'male' },
  { id: 'Bunny', name: 'Bunny', description: 'A little girl overflowing with cuteness.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Neil', name: 'Neil', description: 'A flat baseline intonation with precise, clear pronunciation—the most professional news anchor.', compatibleModels: bothModels, languages: standardLanguages, gender: 'male' },
  { id: 'Elias', name: 'Elias', description: 'Maintains academic rigor while using storytelling techniques to make complex knowledge digestible.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Arthur', name: 'Arthur', description: 'A simple, earthy voice steeped in time and tobacco smoke, unfolding village stories and curiosities.', compatibleModels: bothModels, languages: standardLanguages, gender: 'male' },
  { id: 'Nini', name: 'Nini', description: 'A soft, clingy voice like sweet rice cakes.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Seren', name: 'Seren', description: 'A gentle, soothing voice to help you fall asleep faster.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Pip', name: 'Pip', description: 'A playful, mischievous boy full of childlike wonder.', compatibleModels: bothModels, languages: standardLanguages, gender: 'male' },
  { id: 'Stella', name: 'Stella', description: 'A sweet, dazed teenage-girl voice that radiates love and justice when shouting.', compatibleModels: bothModels, languages: standardLanguages, gender: 'female' },
  { id: 'Bodega', name: 'Bodega', description: 'A passionate Spanish man.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'male' },
  { id: 'Sonrisa', name: 'Sonrisa', description: 'A cheerful, outgoing Latin American woman.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'female' },
  { id: 'Alek', name: 'Alek', description: 'Cold like the Russian spirit, yet warm like wool coat lining.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'male' },
  { id: 'Dolce', name: 'Dolce', description: 'A laid-back Italian man.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'male' },
  { id: 'Sohee', name: 'Sohee', description: 'A warm, cheerful, emotionally expressive Korean unnie.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'female' },
  { id: 'Ono Anna', name: 'Ono Anna', description: 'A clever, spirited childhood friend.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'female' },
  { id: 'Lenn', name: 'Lenn', description: 'Rational at heart, rebellious in detail—a German youth who wears suits and listens to post-punk.', compatibleModels: flashOnly, languages: standardLanguages },
  { id: 'Emilien', name: 'Emilien', description: 'A romantic French big brother.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'male' },
  { id: 'Andre', name: 'Andre', description: 'A magnetic, natural, and steady male voice.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'male' },
  { id: 'Radio Gol', name: 'Radio Gol', description: 'A football poet and commentator.', compatibleModels: flashOnly, languages: standardLanguages, gender: 'male' },
  { id: 'Jada', name: 'Shanghai - Jada', description: 'A fast-paced, energetic Shanghai auntie.', compatibleModels: flashOnly, languages: [{ code: 'zh', title: 'Shanghainese' }, ...standardLanguages.slice(1)], gender: 'female', languageNotes: 'Official dialect: Shanghainese.' },
  { id: 'Dylan', name: 'Beijing - Dylan', description: 'A young man raised in Beijing’s hutongs.', compatibleModels: flashOnly, languages: [{ code: 'zh', title: 'Beijing dialect' }, ...standardLanguages.slice(1)], gender: 'male', languageNotes: 'Official dialect: Beijing dialect.' },
  { id: 'Li', name: 'Nanjing - Li', description: 'A patient yoga teacher.', compatibleModels: flashOnly, languages: [{ code: 'zh', title: 'Nanjing dialect' }, ...standardLanguages.slice(1)], gender: 'male', languageNotes: 'Official dialect: Nanjing dialect.' },
  { id: 'Marcus', name: 'Shaanxi - Marcus', description: 'An authentic Shaanxi voice: broad face, few words, sincere heart, and deep voice.', compatibleModels: flashOnly, languages: [{ code: 'zh', title: 'Shaanxi dialect' }, ...standardLanguages.slice(1)], gender: 'male', languageNotes: 'Official dialect: Shaanxi dialect.' },
  { id: 'Roy', name: 'Southern Min - Roy', description: 'A humorous, straightforward, lively Taiwanese guy.', compatibleModels: flashOnly, languages: [{ code: 'zh', title: 'Southern Min' }, ...standardLanguages.slice(1)], gender: 'male', languageNotes: 'Official dialect: Southern Min.' },
  { id: 'Peter', name: 'Tianjin - Peter', description: 'Tianjin-style crosstalk, professional foil.', compatibleModels: flashOnly, languages: [{ code: 'zh', title: 'Tianjin dialect' }, ...standardLanguages.slice(1)], gender: 'male', languageNotes: 'Official dialect: Tianjin dialect.' },
  { id: 'Sunny', name: 'Sichuan - Sunny', description: 'A Sichuan girl sweet enough to melt your heart.', compatibleModels: flashOnly, languages: [{ code: 'zh', title: 'Sichuan dialect' }, ...standardLanguages.slice(1)], gender: 'female', languageNotes: 'Official dialect: Sichuan dialect.' },
  { id: 'Eric', name: 'Sichuan - Eric', description: 'A Sichuanese man from Chengdu who stands out in everyday life.', compatibleModels: flashOnly, languages: [{ code: 'zh', title: 'Sichuan dialect' }, ...standardLanguages.slice(1)], gender: 'male', languageNotes: 'Official dialect: Sichuan dialect.' },
  { id: 'Rocky', name: 'Cantonese - Rocky', description: 'A humorous, witty A Qiang providing live chat.', compatibleModels: flashOnly, languages: [{ code: 'zh', title: 'Cantonese' }, ...standardLanguages.slice(1)], gender: 'male', languageNotes: 'Official dialect: Cantonese.' },
  { id: 'Kiki', name: 'Cantonese - Kiki', description: 'A sweet Hong Kong girl best friend.', compatibleModels: flashOnly, languages: [{ code: 'zh', title: 'Cantonese' }, ...standardLanguages.slice(1)], gender: 'female', languageNotes: 'Official dialect: Cantonese.' },
] as const satisfies readonly Qwen3TtsRealtimeVoiceCatalogEntry[]

export type Qwen3TtsRealtimeVoiceId = typeof QWEN3_TTS_REALTIME_VOICE_CATALOG[number]['id']

export const QWEN3_TTS_REALTIME_DEFAULT_VOICE: Qwen3TtsRealtimeVoiceId = 'Cherry'
export const QWEN3_TTS_REALTIME_VOICE_IDS = QWEN3_TTS_REALTIME_VOICE_CATALOG.map(voice => voice.id) as Qwen3TtsRealtimeVoiceId[]

export function isQwen3TtsRealtimeVoice(value: unknown): value is Qwen3TtsRealtimeVoiceId {
  return typeof value === 'string' && QWEN3_TTS_REALTIME_VOICE_IDS.includes(value as Qwen3TtsRealtimeVoiceId)
}

export function isQwen3TtsRealtimeVoiceForModel(value: unknown, model: unknown): value is Qwen3TtsRealtimeVoiceId {
  if (!isQwen3TtsRealtimeModel(model) || !isQwen3TtsRealtimeVoice(value))
    return false
  return QWEN3_TTS_REALTIME_VOICE_CATALOG.some(voice => voice.id === value && voice.compatibleModels.includes(model))
}

export function normalizeQwen3TtsRealtimeVoice(value: unknown, model: unknown = QWEN3_TTS_REALTIME_DEFAULT_MODEL): Qwen3TtsRealtimeVoiceId {
  const selectedModel = isQwen3TtsRealtimeModel(model) ? model : QWEN3_TTS_REALTIME_DEFAULT_MODEL
  return isQwen3TtsRealtimeVoiceForModel(value, selectedModel) ? value : QWEN3_TTS_REALTIME_DEFAULT_VOICE
}

export function qwen3TtsRealtimeVoiceInfo(voice: Qwen3TtsRealtimeVoiceCatalogEntry): VoiceInfo {
  return {
    id: voice.id,
    name: voice.name,
    provider: 'qwen3-tts-realtime',
    compatibleModels: [...voice.compatibleModels],
    description: [voice.description, voice.languageNotes].filter(Boolean).join(' '),
    ...(voice.gender ? { gender: voice.gender } : {}),
    languages: voice.languages.map(language => ({ ...language })),
  }
}

export function listQwen3TtsRealtimeVoices(model?: string): VoiceInfo[] {
  if (model !== undefined && !isQwen3TtsRealtimeModel(model))
    return []
  const selectedModel = model ?? QWEN3_TTS_REALTIME_DEFAULT_MODEL
  return QWEN3_TTS_REALTIME_VOICE_CATALOG
    .filter(voice => voice.compatibleModels.includes(selectedModel))
    .map(qwen3TtsRealtimeVoiceInfo)
}
