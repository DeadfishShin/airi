import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { env } from '@huggingface/transformers'
import { afterEach, describe, expect, it } from 'vitest'

import {
  PRODUCTION_VAD_MODEL_CONFIG,
  PRODUCTION_VAD_MODEL_DTYPE,
  PRODUCTION_VAD_MODEL_FILE,
  PRODUCTION_VAD_MODEL_ID,
  PRODUCTION_VAD_MODEL_REVISION,
} from './model-authority'
import { VAD } from './vad'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../')
const MODEL_ROOT = resolve(REPOSITORY_ROOT, 'apps/stage-tamagotchi/scripts/assets/production-vad')
const MODEL_PATH = resolve(MODEL_ROOT, PRODUCTION_VAD_MODEL_ID, PRODUCTION_VAD_MODEL_FILE)
const LICENSE_PATH = resolve(MODEL_ROOT, 'LICENSE')
const PROVENANCE_PATH = resolve(MODEL_ROOT, 'PROVENANCE.md')
const TRANSFORMERS_MODELS_SOURCE_PATH = resolve(REPOSITORY_ROOT, 'node_modules/.pnpm/@huggingface+transformers@3.8.1/node_modules/@huggingface/transformers/src/models.js')
const TRANSFORMERS_DTYPES_SOURCE_PATH = resolve(REPOSITORY_ROOT, 'node_modules/.pnpm/@huggingface+transformers@3.8.1/node_modules/@huggingface/transformers/src/utils/dtypes.js')
const EXPECTED_SHA256 = 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808'
const EXPECTED_SIZE_BYTES = 2243022

describe('production VAD model authority', () => {
  const originalEnvironment = {
    allowRemoteModels: env.allowRemoteModels,
    allowLocalModels: env.allowLocalModels,
    localModelPath: env.localModelPath,
    useBrowserCache: env.useBrowserCache,
    useFSCache: env.useFSCache,
  }

  afterEach(() => {
    env.allowRemoteModels = originalEnvironment.allowRemoteModels
    env.allowLocalModels = originalEnvironment.allowLocalModels
    env.localModelPath = originalEnvironment.localModelPath
    env.useBrowserCache = originalEnvironment.useBrowserCache
    env.useFSCache = originalEnvironment.useFSCache
  })

  it('pins the model identity, revision, fp32 dtype, and custom config', () => {
    expect(PRODUCTION_VAD_MODEL_ID).toBe('onnx-community/silero-vad')
    expect(PRODUCTION_VAD_MODEL_REVISION).toBe('ddc9a7e80d6758f6fc795a1e8a04b798eb929d3a')
    expect(PRODUCTION_VAD_MODEL_FILE).toBe('onnx/model.onnx')
    expect(PRODUCTION_VAD_MODEL_DTYPE).toBe('fp32')
    expect(PRODUCTION_VAD_MODEL_CONFIG).toEqual({ model_type: 'custom' })
  })

  it('proves the installed Transformers.js fp32 resolution', () => {
    const modelsSource = readFileSync(TRANSFORMERS_MODELS_SOURCE_PATH, 'utf8')
    const dtypesSource = readFileSync(TRANSFORMERS_DTYPES_SOURCE_PATH, 'utf8')

    expect(modelsSource).toContain('subfolder = \'onnx\'')
    expect(modelsSource).toContain('model: options.model_file_name ?? \'model\'')
    expect(modelsSource).toMatch(/const baseName = `\$\{fileName\}\$\{suffix\}\.onnx`/)
    expect(modelsSource).toMatch(/const modelFileName = `\$\{options\.subfolder \?\? ''\}\/\$\{baseName\}`/)
    expect(dtypesSource).toContain('[DATA_TYPES.fp32]: \'\'')
    expect(PRODUCTION_VAD_MODEL_FILE).toBe('onnx/model.onnx')
  })

  it('matches the vendored artifact provenance', () => {
    const model = readFileSync(MODEL_PATH)
    expect(statSync(MODEL_PATH).size).toBe(EXPECTED_SIZE_BYTES)
    expect(createHash('sha256').update(model).digest('hex')).toBe(EXPECTED_SHA256)
  })

  it('includes the MIT license and complete provenance manifest', () => {
    const license = readFileSync(LICENSE_PATH, 'utf8')
    const provenance = readFileSync(PROVENANCE_PATH, 'utf8')

    expect(license).toContain('MIT License')
    expect(license).toContain('Permission is hereby granted')
    expect(provenance).toContain('| `MODEL_ID` | `onnx-community/silero-vad` |')
    expect(provenance).toContain('| `UPSTREAM_REVISION` | `ddc9a7e80d6758f6fc795a1e8a04b798eb929d3a` |')
    expect(provenance).toContain('| `UPSTREAM_FILE` | `onnx/model.onnx` |')
    expect(provenance).toContain(`| \`SHA256\` | \`${EXPECTED_SHA256}\` |`)
    expect(provenance).toContain(`| \`SIZE_BYTES\` | \`${EXPECTED_SIZE_BYTES}\` |`)
    expect(provenance).toContain('| `LICENSE` | `MIT` |')
  })

  it('loads the actual production VAD class from the vendored model with remote fallback rejected', async () => {
    const originalFetch = globalThis.fetch
    let externalRequestCount = 0
    globalThis.fetch = (async () => {
      externalRequestCount++
      throw new Error('external-network-request-blocked')
    }) as typeof fetch

    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = `${MODEL_ROOT}/`
    env.useBrowserCache = false
    env.useFSCache = false

    try {
      const vad = new VAD({
        sampleRate: 16000,
        newBufferSize: 512,
      })
      let probability: number | undefined
      vad.on('debug', ({ data }) => {
        if (typeof data?.probability === 'number')
          probability = data.probability
      })

      await vad.initialize()
      await vad.processAudio(new Float32Array(512))

      expect(externalRequestCount).toBe(0)
      expect(probability).toEqual(expect.any(Number))
      expect(Number.isFinite(probability)).toBe(true)

      const state = (vad as unknown as { state: { data: Float32Array, dims: number[], type: string } }).state
      expect(state.type).toBe('float32')
      expect(state.dims).toEqual([2, 1, 128])
      expect(Array.from(state.data).every(Number.isFinite)).toBe(true)
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })
})
