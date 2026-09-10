import { describe, expect, it } from 'vitest'

import {
  migrateLegacyDeepSeekCredential,
  stripDeepSeekCredential,
} from './deepseek-credential'

describe('deepseek Route A credential boundary', () => {
  it('strips apiKey from persisted provider configuration', () => {
    const sanitized = stripDeepSeekCredential({ apiKey: 'test-provider-secret', baseUrl: 'https://example.invalid' })

    expect(sanitized).toEqual({ baseUrl: 'https://example.invalid' })
  })

  it('removes a legacy value only after secure save succeeds', async () => {
    const events: string[] = []
    let removed = false

    await migrateLegacyDeepSeekCredential({
      legacyApiKey: 'test-provider-secret',
      getProfile: async () => ({ hasCredential: false, ready: false }),
      save: async () => {
        events.push('secure-save')
        return { hasCredential: true, ready: true }
      },
      removeLegacy: () => {
        events.push('remove-legacy')
        removed = true
      },
    })

    expect(events).toEqual(['secure-save', 'remove-legacy'])
    expect(removed).toBe(true)
  })

  it('keeps a legacy value when secure save fails', async () => {
    let removed = false

    await expect(migrateLegacyDeepSeekCredential({
      legacyApiKey: 'test-provider-secret',
      getProfile: async () => ({ hasCredential: false, ready: false }),
      save: async () => {
        throw new Error('secure storage unavailable')
      },
      removeLegacy: () => {
        removed = true
      },
    })).rejects.toThrow('unavailable')

    expect(removed).toBe(false)
  })
})
