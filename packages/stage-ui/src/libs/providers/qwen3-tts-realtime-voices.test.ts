import { describe, expect, it } from 'vitest'

import { QWEN3_TTS_REALTIME_MODEL_CATALOG } from './qwen3-tts-realtime-models'
import {
  isQwen3TtsRealtimeVoiceForModel,
  listQwen3TtsRealtimeVoices,
  normalizeQwen3TtsRealtimeVoice,
  QWEN3_TTS_REALTIME_DEFAULT_VOICE,
  QWEN3_TTS_REALTIME_VOICE_CATALOG,
} from './qwen3-tts-realtime-voices'

const officialRealtimeVoiceIds = [
  'Cherry',
  'Serena',
  'Ethan',
  'Chelsie',
  'Momo',
  'Vivian',
  'Moon',
  'Maia',
  'Kai',
  'Nofish',
  'Bella',
  'Jennifer',
  'Ryan',
  'Katerina',
  'Aiden',
  'Eldric Sage',
  'Mia',
  'Mochi',
  'Bellona',
  'Vincent',
  'Bunny',
  'Neil',
  'Elias',
  'Arthur',
  'Nini',
  'Seren',
  'Pip',
  'Stella',
  'Bodega',
  'Sonrisa',
  'Alek',
  'Dolce',
  'Sohee',
  'Ono Anna',
  'Lenn',
  'Emilien',
  'Andre',
  'Radio Gol',
  'Shanghai - Jada',
  'Beijing - Dylan',
  'Nanjing - Li',
  'Shaanxi - Marcus',
  'Southern Min - Roy',
  'Tianjin - Peter',
  'Sichuan - Sunny',
  'Sichuan - Eric',
  'Cantonese - Rocky',
  'Cantonese - Kiki',
]

describe('qwen3 realtime voice authority', () => {
  it('matches the official in-scope system voice ids without aliases or duplicates', () => {
    expect(QWEN3_TTS_REALTIME_VOICE_CATALOG.map(voice => voice.id)).toEqual(officialRealtimeVoiceIds)
    expect(new Set(QWEN3_TTS_REALTIME_VOICE_CATALOG.map(voice => voice.id)).size).toBe(48)
    expect(QWEN3_TTS_REALTIME_VOICE_CATALOG.every(voice => voice.compatibleModels.length > 0)).toBe(true)
  })

  it('keeps compatibility per model and preserves Cherry as the default', () => {
    const [flash, instruct] = QWEN3_TTS_REALTIME_MODEL_CATALOG.map(model => model.id)
    const flashVoices = listQwen3TtsRealtimeVoices(flash)
    const instructVoices = listQwen3TtsRealtimeVoices(instruct)

    expect(QWEN3_TTS_REALTIME_DEFAULT_VOICE).toBe('Cherry')
    expect(flashVoices).toHaveLength(48)
    expect(instructVoices).toHaveLength(24)
    expect(instructVoices.some(voice => voice.id === 'Jennifer')).toBe(false)
    expect(flashVoices.some(voice => voice.id === 'Jennifer')).toBe(true)
    expect(isQwen3TtsRealtimeVoiceForModel('Cherry', flash)).toBe(true)
    expect(isQwen3TtsRealtimeVoiceForModel('Cherry', instruct)).toBe(true)
    expect(listQwen3TtsRealtimeVoices('unsupported-model')).toEqual([])
  })

  it('normalizes stale or incompatible state while retaining compatible voices', () => {
    const [flash, instruct] = QWEN3_TTS_REALTIME_MODEL_CATALOG.map(model => model.id)

    expect(normalizeQwen3TtsRealtimeVoice(undefined, flash)).toBe('Cherry')
    expect(normalizeQwen3TtsRealtimeVoice('unknown-voice', flash)).toBe('Cherry')
    expect(normalizeQwen3TtsRealtimeVoice('Jennifer', instruct)).toBe('Cherry')
    expect(normalizeQwen3TtsRealtimeVoice('Serena', instruct)).toBe('Serena')

    const jada = QWEN3_TTS_REALTIME_VOICE_CATALOG.find(voice => voice.id === 'Shanghai - Jada')
    expect(jada?.languages[0]).toEqual({ code: 'zh', title: 'Shanghainese' })
    expect(jada?.languageNotes).toContain('Shanghainese')
  })
})
