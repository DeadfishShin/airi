import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./DashScopePaygCredentialSettings.vue', import.meta.url), 'utf8')

describe('dashScope PAYG settings surface', () => {
  it('offers save, replace, clear, and region controls without local secret persistence', () => {
    expect(source).toContain('Save securely')
    expect(source).toContain('Replace credential')
    expect(source).toContain('Save settings')
    expect(source).toContain('Clear saved credential')
    expect(source).toContain('value="beijing"')
    expect(source).toContain('value="singapore"')
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('useStorage')
  })

  it('clears the input after save or clear and only renders public profile state', () => {
    expect(source).toContain('apiKey.value = \'\'')
    expect(source).toContain('hasApiKey')
    expect(source).not.toContain('profile.value.apiKey')
    expect(source).toContain('Saved securely')
    expect(source).toContain('Not configured')
  })
})
