import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { ModelInfo, ProviderConfigContext, VoiceInfo } from '../../types'

import { isElectronWindow, isStageTamagotchi } from '@proj-airi/stage-shared'
import { z } from 'zod'

import {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
  QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID,
} from '../../qwen-audio-tts-token-plan-ipc'
import { defineProvider } from '../registry'

const qwenAudioTtsTokenPlanConfigSchema = z.object({})

type QwenAudioTtsTokenPlanConfig = z.input<typeof qwenAudioTtsTokenPlanConfigSchema>

function isQwenAudioTtsTokenPlanAvailable() {
  return isStageTamagotchi()
    && typeof window !== 'undefined'
    && isElectronWindow(window)
    && window.platform === 'darwin'
}

const qwenAudioTtsTokenPlanModels: ModelInfo[] = [{
  id: QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  name: 'Qwen Audio 3.0 TTS Plus',
  provider: QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
  description: 'Token Plan native WebSocket text-to-speech.',
}]

const qwenAudioTtsTokenPlanVoices: VoiceInfo[] = [{
  id: QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID,
  name: QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID,
  provider: QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
  compatibleModels: [QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL],
  description: 'Official Mandarin-capable qwen-audio-3.0-tts-plus system voice.',
  languages: [
    { code: 'zh', title: 'Chinese' },
    { code: 'en', title: 'English' },
  ],
}]

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
    listModels: async () => qwenAudioTtsTokenPlanModels.map(model => ({ ...model })),
    listVoices: async () => qwenAudioTtsTokenPlanVoices.map(voice => ({ ...voice, languages: voice.languages.map(language => ({ ...language })) })),
  },
})

export {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
  QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID,
}
