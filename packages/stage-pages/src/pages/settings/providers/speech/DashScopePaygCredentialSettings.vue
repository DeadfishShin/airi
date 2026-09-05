<script setup lang="ts">
import type { QwenDashScopePaygPublicProfile, QwenDashScopeRegion } from '@proj-airi/stage-ui/libs/providers/qwen-dashscope-payg-ipc'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createElectronRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { errorMessageFrom } from '@moeru/std'
import { isElectronWindow } from '@proj-airi/stage-shared'
import {
  qwenDashScopePaygClearProfile,
  qwenDashScopePaygGetProfile,
  qwenDashScopePaygSaveProfile,
} from '@proj-airi/stage-ui/libs/providers/qwen-dashscope-payg-ipc'
import { computed, onMounted, onUnmounted, ref } from 'vue'

const emptyProfile: QwenDashScopePaygPublicProfile = {
  hasApiKey: false,
  workspaceId: '',
  workspaceIdValid: false,
  region: null,
  regionConfigured: false,
  ready: false,
}

const profile = ref<QwenDashScopePaygPublicProfile>({ ...emptyProfile })
const apiKey = ref('')
const workspaceId = ref('')
const region = ref<QwenDashScopeRegion>('beijing')
const busy = ref(false)
const statusMessage = ref('')
const errorMessage = ref('')
const eventa = typeof window !== 'undefined' && isElectronWindow(window) && window.electron?.ipcRenderer
  ? createElectronRendererContext(window.electron.ipcRenderer)
  : undefined
const getProfile = eventa ? defineInvoke(eventa.context, qwenDashScopePaygGetProfile) : undefined
const saveProfile = eventa ? defineInvoke(eventa.context, qwenDashScopePaygSaveProfile) : undefined
const clearProfile = eventa ? defineInvoke(eventa.context, qwenDashScopePaygClearProfile) : undefined

const readiness = computed(() => {
  if (!profile.value.hasApiKey)
    return 'Not configured'
  if (!profile.value.workspaceIdValid)
    return 'Workspace ID needs attention'
  if (!profile.value.regionConfigured)
    return 'Region needs attention'
  return profile.value.ready ? 'Ready for new PAYG sessions' : 'Not ready'
})

const saveLabel = computed(() => profile.value.hasApiKey ? (apiKey.value ? 'Replace credential' : 'Save settings') : 'Save securely')

function safeError(reason: unknown): string {
  const message = errorMessageFrom(reason) ?? ''
  if (message.includes('API key is missing'))
    return 'Enter an API key before saving.'
  if (message.includes('workspace ID is invalid'))
    return 'Workspace ID must contain only letters, numbers, and hyphens.'
  if (message.includes('region is invalid'))
    return 'Select Beijing or Singapore.'
  if (message.includes('secure storage is unavailable'))
    return 'Secure storage is unavailable on this device; nothing was saved.'
  return 'The secure PAYG profile could not be updated.'
}

function applyPublicProfile(next: QwenDashScopePaygPublicProfile) {
  profile.value = next
  workspaceId.value = next.workspaceId
  if (next.region)
    region.value = next.region
}

async function loadProfile() {
  if (!getProfile) {
    errorMessage.value = 'This settings surface requires the AIRI desktop app.'
    return
  }

  try {
    applyPublicProfile(await getProfile())
  }
  catch {
    errorMessage.value = 'Secure PAYG profile status is unavailable.'
  }
}

async function save() {
  if (!saveProfile || busy.value)
    return

  busy.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    applyPublicProfile(await saveProfile({
      apiKey: apiKey.value,
      workspaceId: workspaceId.value,
      region: region.value,
    }))
    apiKey.value = ''
    statusMessage.value = 'Saved securely. The API key is not displayed.'
  }
  catch (error) {
    apiKey.value = ''
    errorMessage.value = safeError(error)
  }
  finally {
    busy.value = false
  }
}

async function clear() {
  if (!clearProfile || busy.value)
    return

  busy.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    applyPublicProfile(await clearProfile())
    apiKey.value = ''
    statusMessage.value = 'Cleared. New PAYG sessions are disabled.'
  }
  catch {
    errorMessage.value = 'The saved PAYG credential could not be cleared.'
  }
  finally {
    busy.value = false
  }
}

onMounted(() => {
  void loadProfile()
})

onUnmounted(() => {
  apiKey.value = ''
  eventa?.dispose()
})
</script>

<template>
  <section data-testid="qwen-dashscope-payg-credential-settings" class="rounded-xl bg-neutral-100 p-4 dark:bg-neutral-800/60">
    <div class="flex flex-col gap-1">
      <h2 class="text-lg font-semibold">
        Qwen PAYG runtime settings
      </h2>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        Shared by Qwen Audio realtime ASR and Qwen3 realtime PAYG TTS. The API key is stored only in the desktop secure store.
      </p>
    </div>

    <dl class="grid mt-4 gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt class="text-neutral-500 dark:text-neutral-400">
          API key
        </dt>
        <dd data-testid="qwen-dashscope-payg-key-state" class="font-medium">
          {{ profile.hasApiKey ? 'Saved securely' : 'Not configured' }}
        </dd>
      </div>
      <div>
        <dt class="text-neutral-500 dark:text-neutral-400">
          Workspace
        </dt>
        <dd data-testid="qwen-dashscope-payg-workspace-state" class="font-medium">
          {{ profile.workspaceIdValid ? 'Configured' : 'Missing or invalid' }}
        </dd>
      </div>
      <div>
        <dt class="text-neutral-500 dark:text-neutral-400">
          Readiness
        </dt>
        <dd data-testid="qwen-dashscope-payg-readiness" class="font-medium">
          {{ readiness }}
        </dd>
      </div>
    </dl>

    <form class="mt-4 flex flex-col gap-3" @submit.prevent="save">
      <label class="flex flex-col gap-1 text-sm">
        <span>API key</span>
        <input
          v-model="apiKey"
          data-testid="qwen-dashscope-payg-api-key"
          type="password"
          autocomplete="new-password"
          placeholder="Enter to save or replace"
          class="border border-neutral-300 rounded bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        >
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span>Workspace ID</span>
        <input
          v-model="workspaceId"
          data-testid="qwen-dashscope-payg-workspace-id"
          autocomplete="off"
          placeholder="workspace-id"
          pattern="[A-Za-z0-9\-]+"
          class="border border-neutral-300 rounded bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        >
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span>Region</span>
        <select v-model="region" data-testid="qwen-dashscope-payg-region" class="border border-neutral-300 rounded bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
          <option value="beijing">Beijing</option>
          <option value="singapore">Singapore</option>
        </select>
      </label>

      <div class="flex flex-wrap gap-2">
        <button data-testid="qwen-dashscope-payg-save" type="submit" :disabled="busy" class="rounded bg-primary-500 px-4 py-2 text-white disabled:opacity-50">
          {{ saveLabel }}
        </button>
        <button data-testid="qwen-dashscope-payg-clear" type="button" :disabled="busy || !profile.hasApiKey" class="border border-neutral-300 rounded px-4 py-2 dark:border-neutral-700 disabled:opacity-50" @click="clear">
          Clear saved credential
        </button>
      </div>
    </form>

    <p v-if="statusMessage" data-testid="qwen-dashscope-payg-status" class="mt-3 text-sm text-green-600 dark:text-green-400">
      {{ statusMessage }}
    </p>
    <p v-if="errorMessage" data-testid="qwen-dashscope-payg-error" class="mt-3 text-sm text-amber-600 dark:text-amber-400">
      {{ errorMessage }}
    </p>
  </section>
</template>
