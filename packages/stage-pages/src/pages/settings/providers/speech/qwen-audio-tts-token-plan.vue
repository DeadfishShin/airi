<script setup lang="ts">
import {
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { selectProviderMetadata } from '@proj-airi/stage-ui/libs'
import {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
  QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-ipc'
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

const providerMetadata = computedAsync(() => selectProviderMetadata(
  providersStore.getProviderDefinition(providerId),
  t,
  { id: providerId },
))

const model = computed(() => providersStore.getModelsForProvider(providerId).find(model => model.id === QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL))
const voice = computed(() => speechStore.getVoicesForProvider(providerId).find(voice => voice.id === QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID))

async function initializeCatalog() {
  try {
    await providersStore.initializeProvider(providerId)
    await providersStore.fetchModelsForProvider(providerId)
    await speechStore.loadVoicesForProvider(providerId, QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL)
  }
  catch {
    initializationFailed.value = true
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
              {{ providerMetadata?.localizedDescription ?? t('settings.pages.providers.provider.qwen-audio-tts-token-plan.description') }}
            </p>
          </div>

          <dl class="grid gap-4 sm:grid-cols-2">
            <div>
              <dt class="text-sm text-neutral-500 dark:text-neutral-400">
                {{ t('settings.pages.providers.provider.qwen-audio-tts-token-plan.fields.model.label') }}
              </dt>
              <dd data-testid="qwen-audio-tts-token-plan-model" class="mt-1 text-sm font-mono">
                {{ model?.id ?? QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-neutral-500 dark:text-neutral-400">
                {{ t('settings.pages.providers.provider.qwen-audio-tts-token-plan.fields.voice.label') }}
              </dt>
              <dd data-testid="qwen-audio-tts-token-plan-voice" class="mt-1 text-sm">
                {{ voice?.id ?? QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID }}
              </dd>
            </div>
          </dl>

          <p data-testid="qwen-audio-tts-token-plan-environment" class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ t('settings.pages.providers.provider.qwen-audio-tts-token-plan.environment') }}
          </p>

          <p v-if="initializationFailed" class="text-xs text-amber-600 dark:text-amber-400">
            {{ t('settings.pages.providers.provider.qwen-audio-tts-token-plan.catalogUnavailable') }}
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
