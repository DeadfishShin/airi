<script setup lang="ts">
const props = withDefaults(defineProps<{
  model: string
  voice: string
  text: string
  maxChars: number
  busy: boolean
  error?: string
}>(), {
  error: '',
})

const emit = defineEmits<{
  'update:text': [value: string]
  'preview': []
  'stop': []
}>()
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="qwen3-realtime-streaming-preview">
    <div class="border border-neutral-200 rounded-lg bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/40">
      <div class="font-medium">
        Qwen3 realtime streaming preview
      </div>
      <div class="mt-1 text-neutral-500 dark:text-neutral-400">
        Uses the selected model <code>{{ props.model }}</code> and provider voice <code>{{ props.voice }}</code> through the secure realtime WebSocket path. It starts only after an explicit action.
      </div>
    </div>
    <textarea
      :value="props.text"
      :maxlength="props.maxChars"
      class="h-24 w-full border border-neutral-200 rounded-lg bg-white px-3 py-2 text-sm outline-none dark:border-neutral-800 focus:border-primary-400 dark:bg-neutral-900"
      placeholder="Enter a short plain-text preview"
      aria-label="Qwen3 preview text"
      @input="emit('update:text', ($event.target as HTMLTextAreaElement).value)"
    />
    <div class="flex items-center justify-between text-xs text-neutral-400">
      <span>Plain text only · maximum {{ props.maxChars }} characters</span>
      <span>{{ props.text.trim().length }}/{{ props.maxChars }}</span>
    </div>
    <div v-if="props.error" class="text-sm text-red-600 dark:text-red-400" role="alert">
      {{ props.error }}
    </div>
    <div class="flex flex-row gap-4">
      <button
        type="button"
        class="border-2 border-neutral-800 rounded-lg bg-neutral-700 px-4 py-2 text-sm text-neutral-100 transition-opacity dark:border-neutral-200 dark:bg-neutral-300 dark:text-neutral-900"
        :disabled="props.busy || !props.text.trim() || props.text.trim().length > props.maxChars || !props.voice"
        :class="{ 'cursor-not-allowed opacity-50': props.busy || !props.text.trim() || props.text.trim().length > props.maxChars || !props.voice }"
        @click="emit('preview')"
      >
        {{ props.busy ? 'Streaming preview…' : 'Preview/Test voice' }}
      </button>
      <button
        v-if="props.busy"
        type="button"
        class="border-2 border-primary-300 rounded-lg px-4 py-2 text-sm dark:border-primary-800"
        @click="emit('stop')"
      >
        Stop
      </button>
    </div>
  </div>
</template>
