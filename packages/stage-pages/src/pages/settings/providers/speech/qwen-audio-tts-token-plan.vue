<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import {
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { selectProviderMetadata } from '@proj-airi/stage-ui/libs'
import {
  clearQwenAudioTtsTokenPlanCredential,
  getQwenAudioTtsTokenPlanCredentialProfile,
  saveQwenAudioTtsTokenPlanCredential,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-credential'
import { QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL, QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID } from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-ipc'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { computedAsync } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const providerId = QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID
const { t } = useI18n()
const router = useRouter()
const providersStore = useProviderStore()
const speechStore = useSpeechStore()
const initializationFailed = ref(false)
const busy = ref(false)
const apiKey = ref('')
const statusMessage = ref('')
const errorMessage = ref('')
const profile = ref({
  hasApiKey: false,
  ready: false,
  source: 'none' as 'secure-store' | 'environment' | 'none',
  secureStorageAvailable: false,
})

const providerMetadata = computedAsync(() => selectProviderMetadata(
  providersStore.getProviderDefinition(providerId),
  t,
  { id: providerId },
))

const model = computed(() => providersStore.getModelsForProvider(providerId).find(candidate => candidate.id === QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL))
const voices = computed(() => speechStore.getVoicesForProvider(providerId).filter(voice => voice.compatibleModels?.includes(QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL) ?? true))
const selectedVoiceId = computed({
  get: () => speechStore.activeSpeechProvider === providerId ? speechStore.activeSpeechVoiceId : '',
  set: (value: string) => {
    const voice = voices.value.find(candidate => candidate.id === value)
    if (!voice)
      return
    speechStore.activeSpeechProvider = providerId
    speechStore.activeSpeechModel = QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL
    speechStore.activeSpeechVoiceId = voice.id
    speechStore.activeSpeechVoice = voice
  },
})

const readiness = computed(() => {
  if (profile.value.source === 'environment')
    return 'Available from the explicit TOKEN_PLAN_API_KEY environment fallback'
  if (profile.value.source === 'secure-store' && profile.value.ready)
    return 'Saved securely; live calls require an eligible Token Plan'
  return 'Not configured'
})

function applyProfile(next: typeof profile.value) {
  profile.value = next
  if (next.ready)
    providersStore.forceProviderConfigured(providerId)
  else
    providersStore.setProviderUnconfigured(providerId)
}

async function initializeCatalog() {
  try {
    await providersStore.initializeProvider(providerId)
    await providersStore.fetchModelsForProvider(providerId)
    await speechStore.loadVoicesForProvider(providerId, QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL)
    const next = await getQwenAudioTtsTokenPlanCredentialProfile()
    if (next)
      applyProfile(next)
  }
  catch {
    initializationFailed.value = true
  }
}

async function save() {
  if (busy.value)
    return
  busy.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const next = await saveQwenAudioTtsTokenPlanCredential(apiKey.value)
    applyProfile(next)
    apiKey.value = ''
    statusMessage.value = 'Saved securely. The credential is not displayed.'
  }
  catch (error) {
    apiKey.value = ''
    errorMessage.value = errorMessageFrom(error) ?? 'The Token Plan credential could not be saved.'
  }
  finally {
    busy.value = false
  }
}

async function clear() {
  if (busy.value)
    return
  busy.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    applyProfile(await clearQwenAudioTtsTokenPlanCredential())
    statusMessage.value = 'The secure credential was cleared. Environment fallback, if present, is shown separately.'
  }
  catch {
    errorMessage.value = 'The Token Plan credential could not be cleared.'
  }
  finally {
    busy.value = false
  }
}

onMounted(() => {
  void initializeCatalog()
})
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName ?? t('settings.pages.providers.provider.qwen-audio-tts-token-plan.title')"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <ProviderBasicSettings
        :title="t('settings.pages.providers.common.section.basic.title')"
        :description="t('settings.pages.providers.common.section.basic.description')"
      >
        <div data-testid="qwen-audio-tts-token-plan-settings" class="flex flex-col gap-5">
          <div>
            <h1 data-testid="qwen-audio-tts-token-plan-title" class="text-lg font-semibold">
              {{ providerMetadata?.localizedName ?? t('settings.pages.providers.provider.qwen-audio-tts-token-plan.title') }}
            </h1>
            <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Token Plan is a separate route from Qwen PAYG. Saving a credential does not verify account entitlement.
            </p>
          </div>

          <dl class="grid gap-4 sm:grid-cols-3">
            <div>
              <dt class="text-sm text-neutral-500 dark:text-neutral-400">
                Route
              </dt>
              <dd data-testid="qwen-audio-tts-token-plan-route" class="mt-1 text-sm">
                Token Plan
              </dd>
            </div>
            <div>
              <dt class="text-sm text-neutral-500 dark:text-neutral-400">
                Model
              </dt>
              <dd data-testid="qwen-audio-tts-token-plan-model" class="mt-1 text-sm font-mono">
                {{ model?.id ?? QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-neutral-500 dark:text-neutral-400">
                Call status
              </dt>
              <dd data-testid="qwen-audio-tts-token-plan-readiness" class="mt-1 text-sm">
                {{ readiness }}
              </dd>
            </div>
          </dl>

          <form class="flex flex-col gap-3" @submit.prevent="save">
            <label class="flex flex-col gap-1 text-sm">
              <span>Token Plan credential</span>
              <input
                v-model="apiKey"
                data-testid="qwen-audio-tts-token-plan-api-key"
                type="password"
                autocomplete="new-password"
                placeholder="Enter to save or replace"
                class="border border-neutral-300 rounded bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              >
            </label>
            <div class="flex flex-wrap gap-2">
              <button data-testid="qwen-audio-tts-token-plan-save" type="submit" :disabled="busy" class="rounded bg-primary-500 px-4 py-2 text-white disabled:opacity-50">
                {{ profile.hasApiKey ? 'Replace credential' : 'Save securely' }}
              </button>
              <button data-testid="qwen-audio-tts-token-plan-clear" type="button" :disabled="busy || !profile.hasApiKey" class="border border-neutral-300 rounded px-4 py-2 dark:border-neutral-700 disabled:opacity-50" @click="clear">
                Clear saved credential
              </button>
            </div>
          </form>

          <p data-testid="qwen-audio-tts-token-plan-credential-state" class="text-sm">
            Credential: {{ profile.hasApiKey ? (profile.source === 'secure-store' ? 'Saved securely' : 'Available from environment fallback') : 'Not configured' }}
          </p>

          <label class="flex flex-col gap-1 text-sm">
            <span>Voice</span>
            <select v-model="selectedVoiceId" data-testid="qwen-audio-tts-token-plan-voice" class="border border-neutral-300 rounded bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
              <option v-for="voice in voices" :key="voice.id" :value="voice.id">
                {{ voice.name }} ({{ voice.id }})
              </option>
            </select>
          </label>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Voice selection is model-scoped and is reused by the preview and production streaming TTS route.
          </p>
          <p v-if="statusMessage" data-testid="qwen-audio-tts-token-plan-status" class="text-sm text-green-600 dark:text-green-400">
            {{ statusMessage }}
          </p>
          <p v-if="errorMessage" data-testid="qwen-audio-tts-token-plan-error" class="text-sm text-red-600 dark:text-red-400">
            {{ errorMessage }}
          </p>
          <p v-if="initializationFailed" class="text-xs text-amber-600 dark:text-amber-400">
            The static Token Plan model/voice catalog could not be loaded.
          </p>
          <p v-if="!profile.secureStorageAvailable" class="text-xs text-amber-600 dark:text-amber-400">
            Secure storage is unavailable on this device; no credential was saved.
          </p>
        </div>
      </ProviderBasicSettings>
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
