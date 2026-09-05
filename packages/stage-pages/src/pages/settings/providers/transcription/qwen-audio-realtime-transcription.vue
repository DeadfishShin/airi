<script setup lang="ts">
import type { RemovableRef } from '@vueuse/core'

import QwenHearingSettings from '@proj-airi/stage-ui/libs/providers/providers/qwen-audio-realtime/hearing-settings.vue'

import {
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { hearingProviderViewContextKey, selectProviderMetadata } from '@proj-airi/stage-ui/libs'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { computedAsync } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import DashScopePaygCredentialSettings from '../speech/DashScopePaygCredentialSettings.vue'

const providerId = 'qwen-audio-realtime-transcription'
const { t } = useI18n()
const router = useRouter()
const providersStore = useProviderStore()
const providerConfigStore = useProviderConfigStore()
const { configs: providers } = storeToRefs(providerConfigStore) as { configs: RemovableRef<Record<string, Record<string, unknown> | undefined>> }

const providerMetadata = computedAsync(() => selectProviderMetadata(
  providersStore.getProviderDefinition(providerId),
  t,
  { id: providerId },
))

const providerConfig = computed(() => providers.value[providerId])

async function updateProviderConfig(patch: Record<string, unknown>) {
  await providersStore.initializeProvider(providerId)

  const provider = providerConfigStore.getProvider(providerId)
  if (!provider)
    throw new Error('The Qwen Audio realtime ASR configuration is unavailable.')

  await providerConfigStore.updateProviderConfig(
    providerId,
    { ...provider.config, ...patch },
    'configured',
  )
  await providersStore.disposeProviderInstance(providerId)
}

provide(hearingProviderViewContextKey, {
  providerConfig,
  updateProviderConfig,
})

onMounted(() => {
  void providersStore.initializeProvider(providerId)
})
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <ProviderBasicSettings
        :title="t('settings.pages.providers.common.section.basic.title')"
        :description="t('settings.pages.providers.common.section.basic.description')"
      >
        <QwenHearingSettings />
        <DashScopePaygCredentialSettings />
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
