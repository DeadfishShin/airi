import { createContext } from '@moeru/eventa'
import {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODELS_PROBE_ENDPOINT,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-models-probe-ipc'
import { describe, expect, it, vi } from 'vitest'

import {
  createQwenAudioTtsTokenPlanModelsProbe,
  runQwenAudioTtsTokenPlanModelsProbe,
} from './index'

vi.mock('electron', () => ({ ipcMain: {} }))

const credentialStore = { getRuntimeProfile: () => ({ apiKey: 'unit-test-token' }) }

function response(status: number, body: unknown, contentType = 'application/json') {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  })
}

function fetchFor(status: number, body: unknown) {
  return vi.fn(async () => response(status, body)) as unknown as typeof fetch
}

describe('qwen Token Plan model probe', () => {
  it('uses the fixed endpoint and returns only a sanitized model-list result', async () => {
    const fetchImpl = fetchFor(200, { data: [{ id: 'qwen-audio-3.0-tts-plus' }, { id: 'qwen-plus' }] })
    const result = await runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, { fetchImpl })

    expect(result).toEqual(expect.objectContaining({
      httpStatus: 200,
      responseClass: 'SUCCESS_OPENAI_MODEL_LIST',
      modelIds: ['qwen-audio-3.0-tts-plus', 'qwen-plus'],
      ttsModelIds: ['qwen-audio-3.0-tts-plus'],
      containsQwenAudioTtsPlus: true,
    }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(QWEN_AUDIO_TTS_TOKEN_PLAN_MODELS_PROBE_ENDPOINT, expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer unit-test-token',
      },
    }))
    expect(JSON.stringify(result)).not.toContain('unit-test-token')
  })

  it('classifies text-only, empty, non-model, and malformed payloads fail-closed', async () => {
    await expect(runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, {
      fetchImpl: fetchFor(200, { data: [{ id: 'qwen-plus' }] }),
    })).resolves.toMatchObject({ responseClass: 'SUCCESS_TEXT_ONLY_MODELS', ttsModelIds: [] })

    await expect(runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, {
      fetchImpl: fetchFor(200, { data: [{ id: 'future-unknown-model' }] }),
    })).resolves.toMatchObject({ responseClass: 'SUCCESS_OPENAI_MODEL_LIST', ttsModelIds: [] })

    await expect(runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, {
      fetchImpl: fetchFor(200, { data: [] }),
    })).resolves.toMatchObject({ responseClass: 'EMPTY_MODEL_LIST' })

    await expect(runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, {
      fetchImpl: fetchFor(200, { models: [] }),
    })).resolves.toMatchObject({ responseClass: 'SUCCESS_NON_MODEL_PAYLOAD' })

    await expect(runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, {
      fetchImpl: fetchFor(200, { data: [{ id: 42 }] }),
    })).resolves.toMatchObject({ responseClass: 'MALFORMED_RESPONSE' })

    const malformedJson = vi.fn(async () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    await expect(runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, { fetchImpl: malformedJson })).resolves.toMatchObject({ responseClass: 'MALFORMED_RESPONSE' })
  })

  it.each([
    [401, 'AUTH_401'],
    [403, 'AUTH_403'],
    [404, 'NOT_FOUND_404'],
    [405, 'METHOD_NOT_ALLOWED_405'],
  ] as const)('classifies HTTP %s without retry or fallback', async (status, responseClass) => {
    const fetchImpl = fetchFor(status, { error: 'redacted' })
    await expect(runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, { fetchImpl })).resolves.toMatchObject({ responseClass, httpStatus: status })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('classifies timeout, redirect, and network errors without retry', async () => {
    const timeoutFetch = vi.fn(async () => {
      throw Object.assign(new Error('request aborted'), { name: 'AbortError' })
    }) as unknown as typeof fetch
    await expect(runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, { fetchImpl: timeoutFetch })).resolves.toMatchObject({ responseClass: 'TIMEOUT' })

    const redirectFetch = vi.fn(async () => {
      throw new Error('redirect is not allowed')
    }) as unknown as typeof fetch
    await expect(runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, { fetchImpl: redirectFetch })).resolves.toMatchObject({ responseClass: 'REDIRECT_REJECTED' })

    const networkFetch = vi.fn(async () => {
      throw new Error('socket failed')
    }) as unknown as typeof fetch
    await expect(runQwenAudioTtsTokenPlanModelsProbe(credentialStore.getRuntimeProfile, { fetchImpl: networkFetch })).resolves.toMatchObject({ responseClass: 'NETWORK_ERROR' })
    expect(timeoutFetch).toHaveBeenCalledTimes(1)
    expect(redirectFetch).toHaveBeenCalledTimes(1)
    expect(networkFetch).toHaveBeenCalledTimes(1)
  })

  it('bounds concurrent invocation to one in-flight request', async () => {
    const context = createContext()
    let resolveFetch!: (value: Response) => void
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })) as unknown as typeof fetch
    const service = createQwenAudioTtsTokenPlanModelsProbe({
      context: context as never,
      credentialStore,
      fetchImpl,
    })
    try {
      const first = service.probe()
      await expect(service.probe()).rejects.toThrow('already in progress')
      resolveFetch(response(200, { data: [{ id: 'qwen-audio-3.0-tts-plus' }] }))
      await expect(first).resolves.toMatchObject({ responseClass: 'SUCCESS_OPENAI_MODEL_LIST' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
    finally {
      service.dispose()
    }
  })
})
