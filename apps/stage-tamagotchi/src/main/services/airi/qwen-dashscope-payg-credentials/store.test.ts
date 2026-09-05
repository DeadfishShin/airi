import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDashScopePaygCredentialStore } from './store'

const roots: string[] = []

function createStore(encryptionAvailable = true) {
  const root = mkdtempSync(join(tmpdir(), 'airi-qwen-payg-'))
  roots.push(root)
  const filePath = join(root, 'qwen-dashscope-payg-credential.json')
  const secureStorage = {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
  }
  return { filePath, store: createDashScopePaygCredentialStore({ filePath, secureStorage }) }
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop()
    if (root)
      rmSync(root, { recursive: true, force: true })
  }
})

describe('Qwen DashScope PAYG credential store', () => {
  it('saves a shared profile without putting the API key in the persisted JSON', () => {
    const { filePath, store } = createStore()

    expect(store.save({ apiKey: 'unit-test-secret', workspaceId: 'workspace-test', region: 'beijing' })).toMatchObject({
      hasApiKey: true,
      workspaceId: 'workspace-test',
      region: 'beijing',
      ready: true,
    })

    const persisted = readFileSync(filePath, 'utf8')
    expect(persisted).not.toContain('unit-test-secret')
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    expect(store.getRuntimeProfile()).toEqual({ apiKey: 'unit-test-secret', workspaceId: 'workspace-test', region: 'beijing' })
  })

  it('replaces the encrypted key and keeps one canonical authority', () => {
    const { store } = createStore()

    store.save({ apiKey: 'old-unit-test-secret', workspaceId: 'workspace-old', region: 'singapore' })
    store.save({ apiKey: 'new-unit-test-secret', workspaceId: 'workspace-new', region: 'beijing' })

    expect(store.getRuntimeProfile()).toEqual({ apiKey: 'new-unit-test-secret', workspaceId: 'workspace-new', region: 'beijing' })
    expect(store.getPublicProfile().hasApiKey).toBe(true)
  })

  it('updates workspace and region without requiring the existing key again', () => {
    const { store } = createStore()

    store.save({ apiKey: 'unit-test-secret', workspaceId: 'workspace-old', region: 'singapore' })
    store.save({ apiKey: '', workspaceId: 'workspace-new', region: 'beijing' })

    expect(store.getRuntimeProfile()).toEqual({ apiKey: 'unit-test-secret', workspaceId: 'workspace-new', region: 'beijing' })
  })

  it('clears the ciphertext and fails closed for later runtime sessions', () => {
    const { filePath, store } = createStore()

    store.save({ apiKey: 'unit-test-secret', workspaceId: 'workspace-test', region: 'beijing' })
    expect(store.clear()).toEqual({
      hasApiKey: false,
      workspaceId: '',
      workspaceIdValid: false,
      region: null,
      regionConfigured: false,
      ready: false,
    })
    expect(() => store.getRuntimeProfile()).toThrow('credential is not configured')
    expect(() => readFileSync(filePath)).toThrow()
  })

  it('rejects invalid workspace IDs and regions', () => {
    const { store } = createStore()

    expect(() => store.save({ apiKey: 'unit-test-secret', workspaceId: 'not valid', region: 'beijing' })).toThrow('workspace ID is invalid')
    expect(() => store.save({ apiKey: 'unit-test-secret', workspaceId: 'workspace-test', region: 'tokyo' as 'beijing' })).toThrow('region is invalid')
  })

  it('fails closed when platform encryption is unavailable', () => {
    const { store } = createStore(false)

    expect(store.getPublicProfile().ready).toBe(false)
    expect(() => store.save({ apiKey: 'unit-test-secret', workspaceId: 'workspace-test', region: 'beijing' })).toThrow('secure storage is unavailable')
    expect(() => store.getRuntimeProfile()).toThrow('secure storage is unavailable')
  })

  it('does not expose a corrupt ciphertext as a configured public profile', () => {
    const { filePath, store } = createStore()

    writeFileSync(filePath, JSON.stringify({
      version: 1,
      apiKeyCiphertext: Buffer.from('encrypted:', 'utf8').toString('base64'),
      workspaceId: 'workspace-test',
      region: 'beijing',
    }))

    expect(store.getPublicProfile()).toEqual({
      hasApiKey: false,
      workspaceId: '',
      workspaceIdValid: false,
      region: null,
      regionConfigured: false,
      ready: false,
    })
    expect(() => store.getRuntimeProfile()).toThrow('credential is invalid')
  })
})
