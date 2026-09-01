import {
  QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-ipc'
import { QWEN3_TTS_REALTIME_PROVIDER_ID } from '@proj-airi/stage-ui/libs/providers/qwen-tts-realtime-ipc'

const staticQwenTtsModelCatalogProviders = [
  QWEN3_TTS_REALTIME_PROVIDER_ID,
  QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
] as const

export interface SpeechModelCatalogStore {
  getModelsForProvider: (providerId: string) => readonly unknown[]
  initializeProvider: (providerId: string) => Promise<void>
  fetchModelsForProvider: (providerId: string) => Promise<unknown>
}

export function shouldEnsureQwenTtsModelCatalog(providerId: string | undefined, modelCount: number) {
  return !!providerId
    && staticQwenTtsModelCatalogProviders.includes(providerId as typeof staticQwenTtsModelCatalogProviders[number])
    && modelCount === 0
}

/** Ensure the local static model catalog is present for the native Qwen TTS settings surfaces. */
export async function ensureQwenTtsModelCatalog(
  providersStore: SpeechModelCatalogStore,
  providerId: string | undefined,
) {
  if (!providerId || !shouldEnsureQwenTtsModelCatalog(providerId, providersStore.getModelsForProvider(providerId).length))
    return

  await providersStore.initializeProvider(providerId)
  if (providersStore.getModelsForProvider(providerId).length === 0)
    await providersStore.fetchModelsForProvider(providerId)
}
