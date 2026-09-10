import { describe, expect, it } from 'vitest'

import { createRemoteAsrOwnerSyncGate } from './remote-asr-owner-sync-gate'

describe('createRemoteAsrOwnerSyncGate', () => {
  it('defaults to bypass and preserves the product gate', async () => {
    const gate = createRemoteAsrOwnerSyncGate(false)
    const productGate = gate.compose()
    const rejectingProductGate = gate.compose(() => false)

    expect(productGate).toBeUndefined()
    expect(rejectingProductGate?.()).toBe(false)
    expect(gate.control.snapshot()).toMatchObject({
      gateMode: 'BYPASS',
      canStartCallCount: 0,
      lastDecision: 'bypass',
    })
  })

  it('keeps a closed diagnostic gate local while denying remote ASR', async () => {
    const gate = createRemoteAsrOwnerSyncGate(true)

    expect(await gate.compose()!()).toBe(false)
    expect(gate.control.snapshot()).toMatchObject({
      gateMode: 'CLOSED',
      canStartCallCount: 1,
      denyCount: 1,
      allowCount: 0,
    })
  })

  it('does not consume ARM_ONCE when the existing product gate rejects', async () => {
    const gate = createRemoteAsrOwnerSyncGate(true)
    gate.control.armOnce()

    expect(await gate.compose(() => false)!()).toBe(false)
    expect(gate.control.snapshot()).toMatchObject({ gateMode: 'ARMED_ONCE', allowCount: 0, consumedCount: 0 })

    expect(await gate.compose(() => true)!()).toBe(true)
    expect(gate.control.snapshot()).toMatchObject({ gateMode: 'CONSUMED', allowCount: 1, consumedCount: 1 })
  })

  it('allows only one eligible remote ASR start and blocks later segments', async () => {
    const gate = createRemoteAsrOwnerSyncGate(true)
    gate.control.armOnce()

    expect(await gate.compose()!()).toBe(true)
    expect(await gate.compose()!()).toBe(false)
    expect(gate.control.snapshot()).toMatchObject({
      gateMode: 'CONSUMED',
      canStartCallCount: 2,
      allowCount: 1,
      denyCount: 1,
      consumedCount: 1,
    })
  })

  it('supports close, bypass and reset without persistence', () => {
    const gate = createRemoteAsrOwnerSyncGate(true)
    gate.control.armOnce()
    expect(gate.control.snapshot().gateMode).toBe('ARMED_ONCE')
    gate.control.close()
    expect(gate.control.snapshot().gateMode).toBe('CLOSED')
    gate.control.bypass()
    expect(gate.control.snapshot().gateMode).toBe('BYPASS')
    gate.control.reset()
    expect(gate.control.snapshot()).toMatchObject({
      gateMode: 'CLOSED',
      canStartCallCount: 0,
      denyCount: 0,
      allowCount: 0,
      consumedCount: 0,
    })
  })

  it('keeps the snapshot content-free and bounded', () => {
    const gate = createRemoteAsrOwnerSyncGate(true)
    gate.setRuntimeSnapshotProvider(() => ({ speechActive: true, providerSessionActive: false, segmentSequence: 3 }))
    const snapshot = gate.control.snapshot()

    expect(snapshot).toEqual({
      gateMode: 'CLOSED',
      speechActive: true,
      providerSessionActive: false,
      segmentSequence: 3,
      canStartCallCount: 0,
      denyCount: 0,
      allowCount: 0,
      consumedCount: 0,
      lastDecision: 'deny',
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/transcript|pcm|api|workspace|authorization/i)
  })
})
