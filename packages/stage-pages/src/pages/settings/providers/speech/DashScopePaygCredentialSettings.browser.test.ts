import type { QwenDashScopePaygPublicProfile } from '@proj-airi/stage-ui/libs/providers/qwen-dashscope-payg-ipc'

import {
  qwenDashScopePaygClearProfile,
  qwenDashScopePaygGetProfile,
  qwenDashScopePaygSaveProfile,
} from '@proj-airi/stage-ui/libs/providers/qwen-dashscope-payg-ipc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import DashScopePaygCredentialSettings from './DashScopePaygCredentialSettings.vue'

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), get: vi.fn(), save: vi.fn(), clear: vi.fn(), dispose: vi.fn() }))

vi.mock('@moeru/eventa', async (original) => {
  const actual = await original<typeof import('@moeru/eventa')>()
  return { ...actual, defineInvoke: ipc.invoke }
})
vi.mock('@moeru/eventa/adapters/electron/renderer', () => ({
  createContext: () => ({ context: {}, dispose: ipc.dispose }),
}))
vi.mock('@proj-airi/stage-shared', () => ({ isElectronWindow: () => true }))

const empty: QwenDashScopePaygPublicProfile = {
  hasApiKey: false,
  workspaceId: '',
  workspaceIdValid: false,
  region: null,
  regionConfigured: false,
  ready: false,
}
const saved: QwenDashScopePaygPublicProfile = {
  hasApiKey: true,
  workspaceId: 'unit-workspace',
  workspaceIdValid: true,
  region: 'singapore',
  regionConfigured: true,
  ready: true,
}
const mounted: Array<ReturnType<typeof createApp>> = []

async function mount() {
  const host = document.createElement('div')
  const app = createApp(DashScopePaygCredentialSettings)
  app.mount(host)
  mounted.push(app)
  await vi.waitFor(() => expect(ipc.get).toHaveBeenCalled())
  await nextTick()
  return host
}

function field(host: HTMLElement, name: string) {
  const element = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-testid="qwen-dashscope-payg-${name}"]`)
  if (!element)
    throw new Error('Missing test field')
  return element
}

async function fill(host: HTMLElement, name: string, value: string) {
  const element = field(host, name)
  element.value = value
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  await nextTick()
}

async function submit(host: HTMLElement) {
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(ipc.save).toHaveBeenCalled())
  await nextTick()
}

beforeEach(() => {
  vi.resetAllMocks()
  Object.defineProperty(window, 'electron', { configurable: true, value: { ipcRenderer: {} } })
  ipc.get.mockResolvedValue({ ...empty })
  ipc.save.mockResolvedValue({ ...saved })
  ipc.clear.mockResolvedValue({ ...empty })
  ipc.invoke.mockImplementation((_context, event) => {
    if (event === qwenDashScopePaygGetProfile)
      return ipc.get
    if (event === qwenDashScopePaygSaveProfile)
      return ipc.save
    if (event === qwenDashScopePaygClearProfile)
      return ipc.clear
    throw new Error('Unexpected credential IPC')
  })
})

afterEach(() => {
  for (const app of mounted.splice(0))
    app.unmount()
  Reflect.deleteProperty(window, 'electron')
})

describe('shared DashScope PAYG settings browser behavior', () => {
  it('shows the missing state without a saved secret and disables clear', async () => {
    const host = await mount()
    expect(host.textContent).toContain('Not configured')
    expect(field(host, 'api-key').value).toBe('')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="qwen-dashscope-payg-clear"]')!.disabled).toBe(true)
  })

  it('saves a one-time synthetic secret, workspace and selected region then clears the input', async () => {
    const host = await mount()
    await fill(host, 'api-key', 'unit-test-secret')
    await fill(host, 'workspace-id', 'unit-workspace')
    await fill(host, 'region', 'singapore')
    await submit(host)
    expect(ipc.save).toHaveBeenCalledExactlyOnceWith({ apiKey: 'unit-test-secret', workspaceId: 'unit-workspace', region: 'singapore' })
    expect(field(host, 'api-key').value).toBe('')
    expect(host.textContent).toContain('Saved securely')
    expect(host.textContent).not.toContain('unit-test-secret')
  })

  it('restores only public settings after remount and never renders an old key', async () => {
    ipc.get.mockResolvedValue({ ...saved })
    const first = await mount()
    expect(field(first, 'api-key').value).toBe('')
    mounted.pop()!.unmount()
    const reloaded = await mount()
    expect(field(reloaded, 'workspace-id').value).toBe('unit-workspace')
    expect(field(reloaded, 'region').value).toBe('singapore')
    expect(field(reloaded, 'api-key').value).toBe('')
    expect(reloaded.textContent).toContain('Ready for new PAYG sessions')
  })

  it('replaces without reading an old secret and clears public state immediately after clear', async () => {
    ipc.get.mockResolvedValue({ ...saved })
    const host = await mount()
    await fill(host, 'api-key', 'unit-test-replacement')
    expect(host.textContent).toContain('Replace credential')
    await submit(host)
    expect(field(host, 'api-key').value).toBe('')
    host.querySelector<HTMLButtonElement>('[data-testid="qwen-dashscope-payg-clear"]')!.click()
    await vi.waitFor(() => expect(host.textContent).toContain('Not configured'))
    expect(ipc.clear).toHaveBeenCalledOnce()
    expect(field(host, 'workspace-id').value).toBe('')
    expect(field(host, 'api-key').value).toBe('')
  })

  it('rejects an invalid workspace and clears the attempted secret without echoing it', async () => {
    ipc.save.mockRejectedValue(new Error('Qwen DashScope PAYG workspace ID is invalid. unit-test-secret'))
    const host = await mount()
    await fill(host, 'api-key', 'unit-test-secret')
    await fill(host, 'workspace-id', 'bad/workspace')
    expect(field(host, 'workspace-id').checkValidity()).toBe(false)
    await submit(host)
    expect(host.textContent).toContain('Workspace ID must contain only letters, numbers, and hyphens.')
    expect(host.textContent).not.toContain('unit-test-secret')
    expect(field(host, 'api-key').value).toBe('')
  })

  it('reports encryption failure safely and disposes the IPC boundary on unmount', async () => {
    ipc.save.mockRejectedValue(new Error('Qwen DashScope PAYG secure storage is unavailable. unit-test-secret'))
    const host = await mount()
    await fill(host, 'api-key', 'unit-test-secret')
    await submit(host)
    expect(host.textContent).toContain('Secure storage is unavailable on this device; nothing was saved.')
    expect(host.textContent).not.toContain('unit-test-secret')
    expect(field(host, 'api-key').value).toBe('')
    mounted.pop()!.unmount()
    expect(ipc.dispose).toHaveBeenCalledOnce()
  })
})
