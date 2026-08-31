<script setup lang="ts">
import {
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { selectProviderMetadata } from '@proj-airi/stage-ui/libs'
import { QWEN3_TTS_REALTIME_MODEL, QWEN3_TTS_REALTIME_PROVIDER_ID, QWEN3_TTS_REALTIME_VOICE_ID } from '@proj-airi/stage-ui/libs/providers/qwen-tts-realtime-ipc'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { computedAsync } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const providerId = QWEN3_TTS_REALTIME_PROVIDER_ID
const canaryVoiceId = QWEN3_TTS_REALTIME_VOICE_ID
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

const model = computed(() => providersStore.getModelsForProvider(providerId).find(model => model.id === QWEN3_TTS_REALTIME_MODEL))
const voice = computed(() => speechStore.getVoicesForProvider(providerId).find(voice => voice.id === canaryVoiceId))

async function initializeCatalog() {
  try {
    await providersStore.initializeProvider(providerId)
    await providersStore.fetchModelsForProvider(providerId)
    await speechStore.loadVoicesForProvider(providerId, QWEN3_TTS_REALTIME_MODEL)
  }
  catch {
    // Catalog loading is best-effort for this static canary page. Keep the
    // route renderable even if a renderer-side catalog refresh fails.
    initializationFailed.value = true
  }
}

onMounted(() => {
  void initializeCatalog()
})
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName ?? t('settings.pages.providers.provider.qwen3-tts-realtime.title')"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <ProviderBasicSettings
        :title="t('settings.pages.providers.common.section.basic.title')"
        :description="t('settings.pages.providers.common.section.basic.description')"
      >
        <div data-testid="qwen3-tts-realtime-settings" class="flex flex-col gap-5">
          <div>
            <h1 data-testid="qwen3-tts-realtime-title" class="text-lg font-semibold">
              {{ providerMetadata?.localizedName ?? t('settings.pages.providers.provider.qwen3-tts-realtime.title') }}
            </h1>
            <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {{ providerMetadata?.localizedDescription ?? t('settings.pages.providers.provider.qwen3-tts-realtime.description') }}
            </p>
          </div>

          <dl class="grid gap-4 sm:grid-cols-2">
            <div>
              <dt class="text-sm text-neutral-500 dark:text-neutral-400">
                {{ t('settings.pages.providers.provider.qwen3-tts-realtime.fields.model.label') }}
              </dt>
              <dd data-testid="qwen3-tts-realtime-model" class="mt-1 text-sm font-mono">
                {{ model?.id ?? QWEN3_TTS_REALTIME_MODEL }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-neutral-500 dark:text-neutral-400">
                {{ t('settings.pages.providers.provider.qwen3-tts-realtime.fields.voice.label') }}
              </dt>
              <dd data-testid="qwen3-tts-realtime-voice" class="mt-1 text-sm">
                {{ voice?.id ?? canaryVoiceId }}
              </dd>
            </div>
          </dl>

          <p data-testid="qwen3-tts-realtime-environment" class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ t('settings.pages.providers.provider.qwen3-tts-realtime.environment') }}
          </p>

          <p v-if="initializationFailed" class="text-xs text-amber-600 dark:text-amber-400">
            {{ t('settings.pages.providers.provider.qwen3-tts-realtime.catalogUnavailable') }}
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
