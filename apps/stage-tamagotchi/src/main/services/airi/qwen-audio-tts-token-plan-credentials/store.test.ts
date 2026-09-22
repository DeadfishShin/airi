import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createQwenAudioTtsTokenPlanCredentialStore } from './store'

function createHarness(environment: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'airi-qwen-token-plan-'))
  const filePath = join(directory, 'credential.json')
  const secureStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`cipher:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^cipher:/, ''),
  }
  const store = createQwenAudioTtsTokenPlanCredentialStore({ filePath, secureStorage, environment })
  return { directory, filePath, store }
}

describe('Qwen Audio Token Plan credential store', () => {
  it('persists encrypted credentials and exposes only public readiness', () => {
    const harness = createHarness()
    try {
      expect(harness.store.getPublicProfile()).toMatchObject({ hasApiKey: false, source: 'none', ready: false })
      expect(harness.store.save({ apiKey: 'unit-token' })).toMatchObject({ hasApiKey: true, source: 'secure-store', ready: true })
      expect(readFileSync(harness.filePath, 'utf8')).not.toContain('unit-token')
      expect(harness.store.getRuntimeProfile()).toEqual({ apiKey: 'unit-token' })
    }
    finally {
      rmSync(harness.directory, { recursive: true, force: true })
    }
  })

  it('uses an explicit environment fallback only when secure storage has no saved value', () => {
    const harness = createHarness({ TOKEN_PLAN_API_KEY: 'environment-token' })
    try {
      expect(harness.store.getPublicProfile()).toMatchObject({ hasApiKey: true, source: 'environment', ready: true })
      expect(harness.store.getRuntimeProfile()).toEqual({ apiKey: 'environment-token' })
      harness.store.save({ apiKey: 'saved-token' })
      expect(harness.store.getPublicProfile()).toMatchObject({ source: 'secure-store' })
      expect(harness.store.getRuntimeProfile()).toEqual({ apiKey: 'saved-token' })
    }
    finally {
      rmSync(harness.directory, { recursive: true, force: true })
    }
  })

  it('clears the saved profile without deleting the explicit environment fallback', () => {
    const harness = createHarness({ TOKEN_PLAN_API_KEY: 'environment-token' })
    try {
      harness.store.save({ apiKey: 'saved-token' })
      expect(harness.store.clear()).toMatchObject({ source: 'environment', ready: true })
      expect(harness.store.getRuntimeProfile()).toEqual({ apiKey: 'environment-token' })
    }
    finally {
      rmSync(harness.directory, { recursive: true, force: true })
    }
  })
})
