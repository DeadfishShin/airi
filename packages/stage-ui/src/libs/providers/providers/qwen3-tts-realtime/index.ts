import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { ModelInfo, ProviderConfigContext, VoiceInfo } from '../../types'

import { isElectronWindow, isStageTamagotchi } from '@proj-airi/stage-shared'
import { z } from 'zod'

import {
  QWEN3_TTS_REALTIME_MODEL,
  QWEN3_TTS_REALTIME_PROVIDER_ID,
} from '../../qwen-tts-realtime-ipc'
import { defineProvider } from '../registry'

const qwen3TtsRealtimeConfigSchema = z.object({})

type Qwen3TtsRealtimeConfig = z.input<typeof qwen3TtsRealtimeConfigSchema>

function isQwen3TtsRealtimeAvailable() {
  return isStageTamagotchi()
    && typeof window !== 'undefined'
    && isElectronWindow(window)
    && window.platform === 'darwin'
}

const qwen3TtsRealtimeModels: ModelInfo[] = [{
  id: QWEN3_TTS_REALTIME_MODEL,
  name: 'Qwen3 TTS Flash Realtime',
  provider: QWEN3_TTS_REALTIME_PROVIDER_ID,
  description: 'Incremental text-to-speech through Alibaba Cloud Model Studio.',
  contextLength: 0,
  deprecated: false,
}]

const qwen3TtsRealtimeVoices: VoiceInfo[] = [{
  id: 'Cherry',
  name: 'Cherry',
  provider: QWEN3_TTS_REALTIME_PROVIDER_ID,
  compatibleModels: [QWEN3_TTS_REALTIME_MODEL],
  description: 'Official Mandarin-capable Qwen3 realtime preset voice.',
  languages: [{ code: 'zh', title: 'Chinese' }],
  gender: 'female',
}]

function createQwen3TtsRealtimeProvider(): SpeechProviderWithExtraOptions<string> {
  return {
    speech: () => {
      throw new Error('Qwen3 realtime TTS is streaming-only in the Electron canary.')
    },
  }
}

export const providerQwen3TtsRealtime = defineProvider<Qwen3TtsRealtimeConfig>({
  id: QWEN3_TTS_REALTIME_PROVIDER_ID,
  name: 'Qwen3 realtime TTS',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.qwen3-tts-realtime.title'),
  description: 'Alibaba Cloud Model Studio realtime text-to-speech canary.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.qwen3-tts-realtime.description'),
  tasks: ['text-to-speech', 'tts'],
  icon: 'i-simple-icons:alibabacloud',
  requiresCredentials: false,
  isAvailableBy: isQwen3TtsRealtimeAvailable,
  capabilities: {
    speech: {
      transport: 'bidirectional-ws',
    },
  },
  createProviderConfig: (_context: ProviderConfigContext<Qwen3TtsRealtimeConfig>) => qwen3TtsRealtimeConfigSchema,
  createProvider: createQwen3TtsRealtimeProvider,
  validationRequiredWhen: () => false,
  extraMethods: {
    listModels: async () => qwen3TtsRealtimeModels.map(model => ({ ...model })),
    listVoices: async () => qwen3TtsRealtimeVoices.map(voice => ({ ...voice, languages: voice.languages.map(language => ({ ...language })) })),
  },
})

export { QWEN3_TTS_REALTIME_MODEL, QWEN3_TTS_REALTIME_PROVIDER_ID }
