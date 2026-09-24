import { readFileSync, statSync } from 'node:fs'

import { createContext } from '@moeru/eventa'
import {
  QWEN_AUDIO_ASR_TOKEN_PLAN_EXPECTED_DAILY_PROFILE,
  QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_ENDPOINT,
  QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_MODEL,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-asr-token-plan-capability-probe-ipc'
import { app } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import {
  buildQwenAudioAsrTokenPlanProbeRequest,
  createQwenAudioAsrTokenPlanProbe,
  runQwenAudioAsrTokenPlanProbe,
} from './index'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => QWEN_AUDIO_ASR_TOKEN_PLAN_EXPECTED_DAILY_PROFILE) },
  ipcMain: {},
}))

const credentialStore = {
  getPublicProfile: () => ({ hasApiKey: true, ready: true, source: 'secure-store' as const, secureStorageAvailable: true }),
  getRuntimeProfile: () => ({ apiKey: 'unit-test-token' }),
}
const fixtureBytes = new Uint8Array(readFileSync(new URL('../../../../../resources/token-plan-asr-capability-probe.wav', import.meta.url)))

function response(status: number, body: unknown, contentType = 'application/json') {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  })
}

function fetchFor(status: number, body: unknown) {
  return vi.fn(async () => response(status, body)) as unknown as typeof fetch
}

describe('qwen Token Plan ASR capability probe', () => {
  it('uses the fixed POST hypothesis and keeps credential/audio in the main process', async () => {
    const fetchImpl = vi.fn(async () => response(200, {
      choices: [{ message: { content: 'AIRI probe' } }],
    })) as unknown as typeof fetch
    const result = await runQwenAudioAsrTokenPlanProbe(credentialStore.getRuntimeProfile, { fetchImpl, fixtureBytes })
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const request = JSON.parse(String(init.body)) as { model: string, stream: boolean, messages: Array<{ content: Array<{ type: string, input_audio: { data: string } }> }> }

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_ENDPOINT, expect.objectContaining({
      method: 'POST',
      redirect: 'error',
    }))
    expect(request.model).toBe(QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_MODEL)
    expect(request.stream).toBe(false)
    expect(request.messages).toHaveLength(1)
    expect(request.messages[0].content[0].type).toBe('input_audio')
    expect(request.messages[0].content[0].input_audio.data).toMatch(/^data:audio\/wav;base64,/)
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer unit-test-token' }))
    expect(JSON.stringify(result)).not.toContain('unit-test-token')
    expect(JSON.stringify(result)).not.toContain(request.messages[0].content[0].input_audio.data)
    expect(result).toMatchObject({
      responseClass: 'SUCCESS_CHAT_COMPLETION_TRANSCRIPT',
      transcript: 'AIRI probe',
      transcriptPresent: true,
    })
  })

  it('uses the deterministic small PCM16 mono 16 kHz WAV fixture', () => {
    expect(statSync(new URL('../../../../../resources/token-plan-asr-capability-probe.wav', import.meta.url)).size).toBeLessThan(100_000)
    expect(String.fromCharCode(...fixtureBytes.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...fixtureBytes.slice(8, 12))).toBe('WAVE')
    expect(new DataView(fixtureBytes.buffer, fixtureBytes.byteOffset, fixtureBytes.byteLength).getUint16(22, true)).toBe(1)
    expect(new DataView(fixtureBytes.buffer, fixtureBytes.byteOffset, fixtureBytes.byteLength).getUint32(24, true)).toBe(16_000)
    expect(new DataView(fixtureBytes.buffer, fixtureBytes.byteOffset, fixtureBytes.byteLength).getUint16(34, true)).toBe(16)
    expect(buildQwenAudioAsrTokenPlanProbeRequest('fixture').messages[0].content[0].input_audio.data).toBe('data:audio/wav;base64,fixture')
  })

  it.each([
    [200, { choices: [] }, 'SUCCESS_UNEXPECTED_SCHEMA'],
    [200, { choices: [{ message: { content: '' } }] }, 'SUCCESS_EMPTY_TRANSCRIPT'],
    [200, { choices: [{ message: { content: 42 } }] }, 'SUCCESS_UNEXPECTED_SCHEMA'],
    [200, { result: 'AIRI probe' }, 'SUCCESS_UNEXPECTED_SCHEMA'],
  ] as const)('classifies success payload %s fail-closed', async (status, body, responseClass) => {
    await expect(runQwenAudioAsrTokenPlanProbe(credentialStore.getRuntimeProfile, { fetchImpl: fetchFor(status, body), fixtureBytes })).resolves.toMatchObject({ responseClass })
  })

  it.each([
    [400, 'BAD_REQUEST_400'],
    [401, 'AUTH_401'],
    [403, 'AUTH_403'],
    [404, 'NOT_FOUND_404'],
    [405, 'METHOD_NOT_ALLOWED_405'],
    [422, 'UNPROCESSABLE_422'],
    [429, 'RATE_LIMIT_429'],
    [500, 'SERVER_ERROR_5XX'],
  ] as const)('classifies HTTP %s without fallback or retry', async (status, responseClass) => {
    const fetchImpl = fetchFor(status, { error: { code: 'bounded_error', message: 'safe diagnostic' } })
    await expect(runQwenAudioAsrTokenPlanProbe(credentialStore.getRuntimeProfile, { fetchImpl, fixtureBytes })).resolves.toMatchObject({ httpStatus: status, responseClass })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('classifies malformed, timeout, redirect, and network failures without retry', async () => {
    const malformed = vi.fn(async () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    await expect(runQwenAudioAsrTokenPlanProbe(credentialStore.getRuntimeProfile, { fetchImpl: malformed, fixtureBytes })).resolves.toMatchObject({ responseClass: 'MALFORMED_RESPONSE' })

    const timeout = vi.fn(async () => {
      throw Object.assign(new Error('request aborted'), { name: 'AbortError' })
    }) as unknown as typeof fetch
    await expect(runQwenAudioAsrTokenPlanProbe(credentialStore.getRuntimeProfile, { fetchImpl: timeout, fixtureBytes })).resolves.toMatchObject({ responseClass: 'TIMEOUT' })

    const redirect = vi.fn(async () => {
      throw new Error('redirect is not allowed')
    }) as unknown as typeof fetch
    await expect(runQwenAudioAsrTokenPlanProbe(credentialStore.getRuntimeProfile, { fetchImpl: redirect, fixtureBytes })).resolves.toMatchObject({ responseClass: 'REDIRECT_REJECTED' })

    const network = vi.fn(async () => {
      throw new Error('socket failed')
    }) as unknown as typeof fetch
    await expect(runQwenAudioAsrTokenPlanProbe(credentialStore.getRuntimeProfile, { fetchImpl: network, fixtureBytes })).resolves.toMatchObject({ responseClass: 'NETWORK_ERROR' })
    expect(timeout).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('rejects a concurrent invocation and never uses a Workspace or PAYG fallback', async () => {
    const context = createContext()
    let resolveFetch!: (value: Response) => void
    const fetchSpy = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    const fetchImpl = fetchSpy as unknown as typeof fetch
    const service = createQwenAudioAsrTokenPlanProbe({
      context: context as never,
      credentialStore,
      fetchImpl,
      fixtureBytes,
    })
    try {
      const first = service.probe()
      await expect(service.probe()).rejects.toThrow('already in progress')
      resolveFetch(response(200, { choices: [{ message: { content: 'AIRI probe' } }] }))
      await expect(first).resolves.toMatchObject({ responseClass: 'SUCCESS_CHAT_COMPLETION_TRANSCRIPT' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain('workspace')
      expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain('payg')
    }
    finally {
      service.dispose()
    }
  })

  it('reports main-process daily profile and public credential readiness without probing', async () => {
    const context = createContext()
    const service = createQwenAudioAsrTokenPlanProbe({
      context: context as never,
      credentialStore,
      fixtureBytes,
    })
    try {
      await expect(service.getPreflight()).resolves.toMatchObject({
        userDataPath: QWEN_AUDIO_ASR_TOKEN_PLAN_EXPECTED_DAILY_PROFILE,
        profileAuthority: 'DAILY_PROFILE',
        profileAuthorityMatch: true,
        credentialConfigured: true,
        credentialStatus: 'saved',
        credentialSource: 'secure-store',
        fixtureReady: true,
        probeReady: true,
      })
    }
    finally {
      service.dispose()
    }
  })

  it('keeps the preflight gate closed for a non-daily or missing-credential runtime', async () => {
    vi.mocked(app.getPath).mockReturnValue('/private/tmp/airi-asr-preflight-test-profile')
    const context = createContext()
    const service = createQwenAudioAsrTokenPlanProbe({
      context: context as never,
      credentialStore: {
        ...credentialStore,
        getPublicProfile: () => ({ hasApiKey: false, ready: false, source: 'none' as const, secureStorageAvailable: true }),
      },
      fixtureBytes,
    })
    try {
      const result = await service.getPreflight()
      expect(result.credentialConfigured).toBe(false)
      expect(result.credentialStatus).toBe('missing')
      expect(result.probeReady).toBe(false)
    }
    finally {
      vi.mocked(app.getPath).mockReturnValue(QWEN_AUDIO_ASR_TOKEN_PLAN_EXPECTED_DAILY_PROFILE)
      service.dispose()
    }
  })
})
