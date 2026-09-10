import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const configSource = readFileSync(new URL('../electron.vite.config.ts', import.meta.url), 'utf8')

describe('stage UI main-process bundling guard', () => {
  it('bundles the private Stage UI package while preserving native externalization', () => {
    expect(configSource).toContain(`'@xsai-apple-speech/transcription-native'`)
    expect(configSource).toContain(`exclude: [\n          '@proj-airi/stage-ui',\n        ]`)
    expect(configSource).not.toContain('externalizeDeps: false')
  })
})
