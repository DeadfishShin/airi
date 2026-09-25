<script setup lang="ts">
import { FieldCombobox } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useHearingProviderViewContext } from '../../hearing-view'
import {
  normalizeQwenAudioRealtimeTokenPlanAsrModel,
  QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL_CATALOG,
} from '../../qwen-audio-realtime-token-plan-models'

const { t } = useI18n()
const { providerConfig, updateProviderConfig } = useHearingProviderViewContext()

const language = computed(() => {
  const value = providerConfig.value?.language
  return value === 'zh' || value === 'en' ? value : 'auto'
})

const model = computed(() => normalizeQwenAudioRealtimeTokenPlanAsrModel(providerConfig.value?.model))
const modelOptions = computed(() => QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL_CATALOG.map(item => ({
  label: item.name,
  value: item.id,
})))
const languageOptions = computed(() => [
  { label: t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.fields.language.options.auto'), value: 'auto' },
  { label: t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.fields.language.options.zh'), value: 'zh' },
  { label: t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.fields.language.options.en'), value: 'en' },
])

async function updateModel(value: string | undefined) {
  const next = normalizeQwenAudioRealtimeTokenPlanAsrModel(value)
  if (next !== model.value)
    await updateProviderConfig({ model: next })
}

async function updateLanguage(value: string | undefined) {
  if (value !== 'auto' && value !== 'zh' && value !== 'en')
    return
  if (value !== language.value)
    await updateProviderConfig({ language: value })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <FieldCombobox
      data-testid="qwen-audio-realtime-token-plan-model"
      :model-value="model"
      :label="t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.fields.model.label')"
      :description="t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.fields.model.description')"
      :placeholder="t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.fields.model.placeholder')"
      :options="modelOptions"
      layout="vertical"
      @update:model-value="updateModel"
    />
    <FieldCombobox
      data-testid="qwen-audio-realtime-token-plan-language"
      :model-value="language"
      :label="t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.fields.language.label')"
      :description="t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.fields.language.description')"
      :placeholder="t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.fields.language.placeholder')"
      :options="languageOptions"
      layout="vertical"
      @update:model-value="updateLanguage"
    />
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.environment') }}
    </p>
  </div>
</template>
