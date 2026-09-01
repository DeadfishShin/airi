import { describe, expect, it } from 'vitest'

import { createQwenAudioTtsTokenPlanStageDiagnostics } from './qwen-audio-tts-token-plan-diagnostics'

describe('token Plan Qwen Audio TTS stage diagnostics', () => {
  it('deduplicates bounded milestones without accepting content or secrets', () => {
    const entries: Array<{ sessionId: string, milestone: string, details?: unknown }> = []
    const diagnostics = createQwenAudioTtsTokenPlanStageDiagnostics('stage-session-with-an-intentionally-long-identifier', (milestone, details) => {
      entries.push({ sessionId: details.sessionId ?? '', milestone, details })
    })

    diagnostics.emit('STAGE_BEFORE_MESSAGE')
    diagnostics.emit('STAGE_BEFORE_MESSAGE')
    diagnostics.emit('STAGE_PROVIDER_SELECTED', { providerId: 'qwen-audio-tts-token-plan' })
    diagnostics.emit('STAGE_MODEL_SELECTED', { modelId: 'qwen-audio-3.0-tts-plus' })
    diagnostics.emit('STAGE_VOICE_OBJECT_RESOLVED', { resolved: true, voiceId: 'longanlingxin' })
    diagnostics.emit('STAGE_MUTED', { muted: false })
    diagnostics.emit('STAGE_SNAPSHOT_READY', { ready: true, modelId: 'qwen-audio-3.0-tts-plus', voiceId: 'longanlingxin' })

    expect(entries).toHaveLength(6)
    expect(entries[0]?.sessionId).toHaveLength(32)
    expect(JSON.stringify(entries)).not.toContain('你好')
    expect(JSON.stringify(entries)).not.toContain('unit-test-token')
    expect(JSON.stringify(entries)).not.toContain('Authorization')
  })

  it('updates the bounded session identifier without changing milestone cardinality', () => {
    const entries: string[] = []
    const diagnostics = createQwenAudioTtsTokenPlanStageDiagnostics('initial', (milestone, details) => entries.push(`${details.sessionId}:${milestone}`))

    diagnostics.emit('STAGE_SESSION_CREATED')
    diagnostics.setSessionId('replacement-session-id-that-is-also-bounded')
    diagnostics.emit('STAGE_SESSION_CREATED')
    diagnostics.emit('STAGE_SESSION_CREATE_FAILED')

    expect(entries).toEqual([
      'initial:STAGE_SESSION_CREATED',
      'replacement-session-id-that-is-a:STAGE_SESSION_CREATE_FAILED',
    ])
  })
})
