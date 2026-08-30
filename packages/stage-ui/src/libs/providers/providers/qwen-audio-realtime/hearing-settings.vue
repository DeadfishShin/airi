<script setup lang="ts">
import { FieldCombobox } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useHearingProviderViewContext } from '../../hearing-view'

const { t } = useI18n()
const { providerConfig, updateProviderConfig } = useHearingProviderViewContext()

const language = computed(() => {
  const value = providerConfig.value?.language
  return value === 'zh' || value === 'en' ? value : 'auto'
})

const languageOptions = computed(() => [
  { label: t('settings.pages.providers.provider.qwen-audio-realtime-transcription.fields.language.options.auto'), value: 'auto' },
  { label: t('settings.pages.providers.provider.qwen-audio-realtime-transcription.fields.language.options.zh'), value: 'zh' },
  { label: t('settings.pages.providers.provider.qwen-audio-realtime-transcription.fields.language.options.en'), value: 'en' },
])

async function updateLanguage(value: string | undefined) {
  if (value !== 'auto' && value !== 'zh' && value !== 'en')
    return
  if (value === language.value)
    return

  await updateProviderConfig({ language: value })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <FieldCombobox
      data-testid="qwen-audio-realtime-language"
      :model-value="language"
      :label="t('settings.pages.providers.provider.qwen-audio-realtime-transcription.fields.language.label')"
      :description="t('settings.pages.providers.provider.qwen-audio-realtime-transcription.fields.language.description')"
      :placeholder="t('settings.pages.providers.provider.qwen-audio-realtime-transcription.fields.language.placeholder')"
      :options="languageOptions"
      layout="vertical"
      @update:model-value="updateLanguage"
    />
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ t('settings.pages.providers.provider.qwen-audio-realtime-transcription.environment') }}
    </p>
  </div>
</template>
