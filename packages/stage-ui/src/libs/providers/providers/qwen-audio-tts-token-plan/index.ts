import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { ProviderConfigContext } from '../../types'

import { isElectronWindow, isStageTamagotchi } from '@proj-airi/stage-shared'
import { z } from 'zod'

import {
  getQwenAudioTtsTokenPlanModels,
  getQwenAudioTtsTokenPlanVoices,
  qwenAudioTtsTokenPlanModels,
  qwenAudioTtsTokenPlanVoices,
} from '../../qwen-audio-tts-token-plan-catalog'
import {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
  QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID,
} from '../../qwen-audio-tts-token-plan-ipc'
import { defineProvider } from '../registry'

const qwenAudioTtsTokenPlanConfigSchema = z.object({
  credentialSource: z.enum(['secure-store', 'environment']).optional(),
})

type QwenAudioTtsTokenPlanConfig = z.input<typeof qwenAudioTtsTokenPlanConfigSchema>

function isQwenAudioTtsTokenPlanAvailable() {
  return isStageTamagotchi()
    && typeof window !== 'undefined'
    && isElectronWindow(window)
    && window.platform === 'darwin'
}

function createQwenAudioTtsTokenPlanProvider(): SpeechProviderWithExtraOptions<string> {
  return {
    speech: () => {
      throw new Error('Qwen Audio Token Plan TTS is streaming-only in the Electron canary.')
    },
  }
}

export const providerQwenAudioTtsTokenPlan = defineProvider<QwenAudioTtsTokenPlanConfig>({
  id: QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
  name: 'Qwen Audio TTS Token Plan',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.qwen-audio-tts-token-plan.title'),
  description: 'Alibaba Cloud Token Plan native WebSocket text-to-speech canary.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.qwen-audio-tts-token-plan.description'),
  tasks: ['text-to-speech', 'tts'],
  icon: 'i-simple-icons:alibabacloud',
  requiresCredentials: false,
  isAvailableBy: isQwenAudioTtsTokenPlanAvailable,
  capabilities: {
    speech: {
      transport: 'bidirectional-ws',
    },
  },
  createProviderConfig: (_context: ProviderConfigContext<QwenAudioTtsTokenPlanConfig>) => qwenAudioTtsTokenPlanConfigSchema,
  createProvider: createQwenAudioTtsTokenPlanProvider,
  validationRequiredWhen: () => false,
  extraMethods: {
    listModels: async () => getQwenAudioTtsTokenPlanModels(),
    listVoices: async (_config, _provider, model) => getQwenAudioTtsTokenPlanVoices(model),
  },
})

export {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
  QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID,
}

export { qwenAudioTtsTokenPlanModels, qwenAudioTtsTokenPlanVoices }
