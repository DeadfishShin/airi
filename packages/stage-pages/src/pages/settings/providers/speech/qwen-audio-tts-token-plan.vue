<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import {
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { selectProviderMetadata } from '@proj-airi/stage-ui/libs'
import {
  QWEN_AUDIO_TTS_TOKEN_PLAN_CATALOG_UPDATED_AT,
  QWEN_AUDIO_TTS_TOKEN_PLAN_DISCOVERY_LIMITATIONS,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-catalog'
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
const catalogStatus = ref('')
const catalogSource = ref(t('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.source'))
const voiceSearchQuery = ref('')
const refreshingCatalog = ref(false)
const browsingModelId = ref('')
const browsingVoiceId = ref('')
let catalogRefreshSequence = 0
let voiceRequestSequence = 0
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

const models = computed(() => providersStore.getModelsForProvider(providerId))
const selectedModelId = computed({
  get: () => {
    if (models.value.some(candidate => candidate.id === browsingModelId.value))
      return browsingModelId.value
    const active = speechStore.activeSpeechProvider === providerId ? speechStore.activeSpeechModel : ''
    return models.value.some(candidate => candidate.id === active) ? active : models.value[0]?.id ?? QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL
  },
  set: (value: string) => {
    if (!models.value.some(candidate => candidate.id === value))
      return
    catalogRefreshSequence++
    browsingModelId.value = value
    speechStore.activeSpeechProvider = providerId
    speechStore.activeSpeechModel = value
    void loadVoicesForCatalog(value, true)
  },
})
const model = computed(() => models.value.find(candidate => candidate.id === selectedModelId.value))
const voices = computed(() => speechStore.getVoicesForProvider(providerId).filter(voice => voice.compatibleModels?.includes(selectedModelId.value) ?? true))
const filteredVoices = computed(() => {
  const query = voiceSearchQuery.value.trim().toLowerCase()
  if (!query)
    return voices.value
  return voices.value.filter(voice => voice.id.toLowerCase().includes(query) || voice.name.toLowerCase().includes(query) || voice.description?.toLowerCase().includes(query))
})
const voiceCounts = computed(() => ({
  system: voices.value.filter(voice => voice.catalogKind === 'system').length,
  base: voices.value.filter(voice => voice.catalogKind === 'base').length,
  custom: voices.value.filter(voice => voice.catalogKind === 'custom').length,
}))
const selectedVoiceId = computed({
  get: () => {
    if (speechStore.activeSpeechProvider === providerId && speechStore.activeSpeechModel === selectedModelId.value)
      return speechStore.activeSpeechVoiceId
    return browsingVoiceId.value
  },
  set: (value: string) => {
    const voice = voices.value.find(candidate => candidate.id === value)
    if (!voice)
      return
    browsingVoiceId.value = voice.id
    speechStore.activeSpeechProvider = providerId
    speechStore.activeSpeechModel = selectedModelId.value
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
    const next = await getQwenAudioTtsTokenPlanCredentialProfile()
    if (next)
      applyProfile(next)
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? 'The Token Plan credential status could not be loaded.'
  }
  await refreshCatalog()
}

async function loadVoicesForCatalog(modelId: string, applySelectionDefaults: boolean) {
  const requestSequence = ++voiceRequestSequence
  try {
    const nextVoices = await speechStore.loadVoicesForProvider(providerId, modelId, {
      applySelectionDefaults,
      preserveOnEmpty: true,
      throwOnError: true,
      trackGlobalState: applySelectionDefaults,
    })
    if (requestSequence !== voiceRequestSequence)
      return undefined

    if (applySelectionDefaults)
      browsingVoiceId.value = speechStore.activeSpeechVoiceId
    else if (speechStore.activeSpeechProvider === providerId && speechStore.activeSpeechModel === modelId)
      browsingVoiceId.value = speechStore.activeSpeechVoiceId
    return nextVoices
  }
  catch (error) {
    if (requestSequence !== voiceRequestSequence)
      return undefined
    throw error
  }
}

async function refreshCatalog() {
  if (refreshingCatalog.value)
    return
  const refreshSequence = ++catalogRefreshSequence
  refreshingCatalog.value = true
  initializationFailed.value = false
  errorMessage.value = ''
  catalogStatus.value = t('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.loading')
  try {
    await providersStore.initializeProvider(providerId)
    const refreshedModels = await providersStore.fetchModelsForProvider(providerId, {
      preserveOnEmpty: true,
      throwOnError: true,
    })
    if (refreshSequence !== catalogRefreshSequence)
      return
    if (!refreshedModels.length) {
      catalogStatus.value = t('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.empty')
      return
    }

    const activeModel = speechStore.activeSpeechProvider === providerId ? speechStore.activeSpeechModel : ''
    const nextModel = models.value.some(candidate => candidate.id === browsingModelId.value)
      ? browsingModelId.value
      : models.value.some(candidate => candidate.id === activeModel)
        ? activeModel
        : models.value[0]?.id
    if (!nextModel)
      return

    browsingModelId.value = nextModel
    const refreshedVoices = await loadVoicesForCatalog(nextModel, false)
    if (refreshSequence !== catalogRefreshSequence || refreshedVoices === undefined)
      return

    catalogSource.value = t('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.source')
    if (!refreshedVoices.length) {
      catalogStatus.value = t('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.emptyVoices')
      return
    }
    catalogStatus.value = t('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.loaded', {
      models: models.value.length,
      voices: refreshedVoices.length,
      date: QWEN_AUDIO_TTS_TOKEN_PLAN_CATALOG_UPDATED_AT,
    })
  }
  catch (error) {
    if (refreshSequence !== catalogRefreshSequence)
      return
    initializationFailed.value = true
    catalogStatus.value = t('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.failed')
    errorMessage.value = errorMessageFrom(error) ?? 'The Token Plan directory could not be loaded.'
  }
  finally {
    refreshingCatalog.value = false
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
    await refreshCatalog()
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
                Selected model
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

          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-3">
              <label class="text-sm font-medium" for="qwen-audio-tts-token-plan-model-select">Token Plan TTS models</label>
              <button data-testid="qwen-audio-tts-token-plan-refresh-catalog" type="button" :disabled="refreshingCatalog || busy" class="border border-neutral-300 rounded px-3 py-1 text-sm dark:border-neutral-700 disabled:opacity-50" @click="refreshCatalog">
                {{ refreshingCatalog ? t('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.reloading') : t('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.reload') }}
              </button>
            </div>
            <select id="qwen-audio-tts-token-plan-model-select" v-model="selectedModelId" data-testid="qwen-audio-tts-token-plan-model-select" class="border border-neutral-300 rounded bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
              <option v-for="candidate in models" :key="candidate.id" :value="candidate.id">
                {{ candidate.name }} ({{ candidate.id }})
              </option>
            </select>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              Token Plan model discovery is not documented as a credential-scoped API. This selection uses the official published directory and does not claim account entitlement.
            </p>
          </div>

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

          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">Voices for {{ model?.id ?? selectedModelId }}</span>
            <input v-model="voiceSearchQuery" data-testid="qwen-audio-tts-token-plan-voice-search" type="search" placeholder="Search voices" class="border border-neutral-300 rounded bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
            <select v-model="selectedVoiceId" data-testid="qwen-audio-tts-token-plan-voice" class="border border-neutral-300 rounded bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
              <option v-for="voice in filteredVoices" :key="voice.id" :value="voice.id">
                {{ voice.name }} ({{ voice.id }})
              </option>
            </select>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ voiceCounts.system }} system · {{ voiceCounts.base }} base · {{ t('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.customNotQueried') }} · Source: {{ catalogSource }}
            </p>
          </div>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Voice selection is model-scoped and is reused by the preview and production streaming TTS route.
          </p>
          <p v-if="catalogStatus" data-testid="qwen-audio-tts-token-plan-catalog-status" class="text-sm text-neutral-600 dark:text-neutral-300">
            {{ catalogStatus }}
          </p>
          <p v-if="statusMessage" data-testid="qwen-audio-tts-token-plan-status" class="text-sm text-green-600 dark:text-green-400">
            {{ statusMessage }}
          </p>
          <p v-if="errorMessage" data-testid="qwen-audio-tts-token-plan-error" class="text-sm text-red-600 dark:text-red-400">
            {{ errorMessage }}
          </p>
          <p v-if="initializationFailed" data-testid="qwen-audio-tts-token-plan-catalog-error" class="text-xs text-amber-600 dark:text-amber-400">
            The official Token Plan directory could not be loaded. Existing model and voice selections were preserved.
          </p>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Provider discovery limits: model API {{ QWEN_AUDIO_TTS_TOKEN_PLAN_DISCOVERY_LIMITATIONS.modelApi }}; system voice API {{ QWEN_AUDIO_TTS_TOKEN_PLAN_DISCOVERY_LIMITATIONS.systemVoiceApi }}; custom voice API {{ QWEN_AUDIO_TTS_TOKEN_PLAN_DISCOVERY_LIMITATIONS.customVoiceApi }}.
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
