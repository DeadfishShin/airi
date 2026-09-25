<script setup lang="ts">
import type { Live2DSemanticMotion } from '@proj-airi/stage-ui-live2d/utils/live2d-compatibility'

import { LIVE2D_SEMANTIC_MOTIONS } from '@proj-airi/stage-ui-live2d/utils/live2d-compatibility'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface RuntimeMotion {
  name: string
  displayPath: string
  group: string
  index: number
}

const props = defineProps<{
  modelId?: string
  motions: RuntimeMotion[]
  overrides: Record<string, string>
}>()

const emit = defineEmits<{
  (event: 'update', fileName: string, semantic: string): void
}>()

const { t } = useI18n()
const semanticOptions = computed(() => LIVE2D_SEMANTIC_MOTIONS.map((value: Live2DSemanticMotion) => ({
  value,
  label: t(`settings.live2d.map-motions.semantic.${value}`),
})))

function handleChange(fileName: string, event: Event) {
  const target = event.target as HTMLSelectElement
  emit('update', fileName, target.value)
}
</script>

<template>
  <div data-testid="live2d-semantic-motion-mapping" class="flex flex-col gap-2">
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ modelId ? `Model: ${modelId}` : 'Select a model before configuring mappings.' }}
    </p>
    <div v-if="motions.length" class="flex flex-col gap-2">
      <label
        v-for="motion in motions"
        :key="`${motion.group}:${motion.index}:${motion.displayPath}`"
        class="flex flex-wrap items-center justify-between gap-2 text-sm"
      >
        <span class="min-w-0 flex-1">
          <span class="block truncate font-mono" :title="motion.displayPath">{{ motion.name }}</span>
          <span class="block text-xs text-neutral-500 dark:text-neutral-400">
            {{ motion.displayPath }} · {{ motion.group || '(default)' }} / {{ motion.index }}
          </span>
        </span>
        <select
          :aria-label="motion.displayPath"
          class="border border-neutral-300 rounded bg-transparent px-2 py-1 text-xs dark:border-neutral-700"
          :disabled="!modelId"
          :value="props.overrides[motion.displayPath] ?? ''"
          @change="handleChange(motion.displayPath, $event)"
        >
          <option value="">{{ t('settings.live2d.map-motions.semantic.auto') }}</option>
          <option v-for="option in semanticOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>
    <p v-else class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ t('settings.live2d.animation.idle-motion.no-motion') }}
    </p>
  </div>
</template>
