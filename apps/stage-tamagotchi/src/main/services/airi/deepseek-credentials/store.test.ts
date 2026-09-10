import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDeepSeekCredentialStore } from './store'

const roots: string[] = []

function createStore(encryptionAvailable = true) {
  const root = mkdtempSync(join(tmpdir(), 'airi-deepseek-credential-'))
  roots.push(root)
  const filePath = join(root, 'deepseek-credential.json')
  const calls = {
    isEncryptionAvailable: 0,
    encryptString: 0,
    decryptString: 0,
  }
  const secureStorage = {
    isEncryptionAvailable: () => {
      calls.isEncryptionAvailable++
      return encryptionAvailable
    },
    encryptString: (value: string) => {
      calls.encryptString++
      return Buffer.from(`encrypted:${value}`, 'utf8')
    },
    decryptString: (value: Buffer) => {
      calls.decryptString++
      return value.toString('utf8').replace(/^encrypted:/, '')
    },
  }
  return {
    calls,
    filePath,
    secureStorage,
    store: createDeepSeekCredentialStore({ filePath, secureStorage }),
  }
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop()
    if (root)
      rmSync(root, { recursive: true, force: true })
  }
})

describe('deepseek secure credential store', () => {
  it('saves encrypted data with a public readiness profile and restores after restart', () => {
    const { filePath, secureStorage, store } = createStore()

    expect(store.save({ apiKey: 'test-provider-secret' })).toEqual({ hasCredential: true, ready: true })
    expect(readFileSync(filePath, 'utf8')).not.toContain('test-provider-secret')
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    expect(store.getPublicProfile()).toEqual({ hasCredential: true, ready: true })
    expect(store.getRuntimeCredential()).toBe('test-provider-secret')

    const restarted = createDeepSeekCredentialStore({ filePath, secureStorage })
    expect(restarted.getPublicProfile()).toEqual({ hasCredential: true, ready: true })
    expect(restarted.getRuntimeCredential()).toBe('test-provider-secret')
  })

  it('replaces and clears the credential without exposing it in public state', () => {
    const { filePath, store } = createStore()

    store.save({ apiKey: 'test-provider-secret-old' })
    store.save({ apiKey: 'test-provider-secret-new' })
    expect(store.getRuntimeCredential()).toBe('test-provider-secret-new')
    expect(JSON.stringify(store.getPublicProfile())).not.toContain('test-provider-secret')

    expect(store.clear()).toEqual({ hasCredential: false, ready: false })
    expect(store.getPublicProfile()).toEqual({ hasCredential: false, ready: false })
    expect(() => store.getRuntimeCredential()).toThrow('not configured')
    expect(() => readFileSync(filePath)).toThrow()
  })

  it('fails closed when encryption is unavailable or ciphertext is corrupt', () => {
    const { filePath, secureStorage, store } = createStore()
    store.save({ apiKey: 'test-provider-secret' })
    const unavailable = createDeepSeekCredentialStore({
      filePath,
      secureStorage: { ...secureStorage, isEncryptionAvailable: () => false },
    })
    expect(unavailable.getPublicProfile()).toEqual({ hasCredential: false, ready: false })
    expect(() => unavailable.getRuntimeCredential()).toThrow('unavailable')

    writeFileSync(filePath, JSON.stringify({ version: 1, apiKeyCiphertext: 'not-valid-ciphertext' }))
    const corrupt = createDeepSeekCredentialStore({
      filePath,
      secureStorage: { ...secureStorage, decryptString: () => { throw new Error('corrupt ciphertext') } },
    })
    expect(corrupt.getPublicProfile()).toEqual({ hasCredential: false, ready: false })
    expect(() => corrupt.getRuntimeCredential()).toThrow('invalid')
  })

  it('rejects an empty first save without creating a file', () => {
    const { filePath, store } = createStore()
    expect(() => store.save({ apiKey: '   ' })).toThrow('missing')
    expect(() => readFileSync(filePath)).toThrow()
  })
})
