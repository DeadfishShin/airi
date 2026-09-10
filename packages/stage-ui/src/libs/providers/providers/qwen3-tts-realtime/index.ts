import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { ModelInfo, ProviderConfigContext } from '../../types'

import { isElectronWindow, isStageTamagotchi } from '@proj-airi/stage-shared'
import { z } from 'zod'

import {
  QWEN3_TTS_REALTIME_PROVIDER_ID,
} from '../../qwen-tts-realtime-ipc'
import {
  QWEN3_TTS_REALTIME_MODEL_CATALOG,
  qwen3TtsRealtimeModelInfo,
} from '../../qwen3-tts-realtime-models'
import { listQwen3TtsRealtimeVoices } from '../../qwen3-tts-realtime-voices'
import { defineProvider } from '../registry'

const qwen3TtsRealtimeConfigSchema = z.object({})

type Qwen3TtsRealtimeConfig = z.input<typeof qwen3TtsRealtimeConfigSchema>

function isQwen3TtsRealtimeAvailable() {
  return isStageTamagotchi()
    && typeof window !== 'undefined'
    && isElectronWindow(window)
    && window.platform === 'darwin'
}

const qwen3TtsRealtimeModels: ModelInfo[] = QWEN3_TTS_REALTIME_MODEL_CATALOG.map(model => qwen3TtsRealtimeModelInfo(model))

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
    listVoices: async (_config, _provider, model) => listQwen3TtsRealtimeVoices(model),
  },
})

export {
  isQwen3TtsRealtimeModel,
  normalizeQwen3TtsRealtimeModel,
  QWEN3_TTS_REALTIME_DEFAULT_MODEL,
  QWEN3_TTS_REALTIME_MODEL_CATALOG,
} from '../../qwen3-tts-realtime-models'

export {
  isQwen3TtsRealtimeVoice,
  isQwen3TtsRealtimeVoiceForModel,
  listQwen3TtsRealtimeVoices,
  normalizeQwen3TtsRealtimeVoice,
  QWEN3_TTS_REALTIME_DEFAULT_VOICE,
  QWEN3_TTS_REALTIME_VOICE_CATALOG,
} from '../../qwen3-tts-realtime-voices'

export {
  QWEN3_TTS_REALTIME_MODEL,
  QWEN3_TTS_REALTIME_PROVIDER_ID,
  QWEN3_TTS_REALTIME_VOICE_ID,
} from '../../qwen-tts-realtime-ipc'
