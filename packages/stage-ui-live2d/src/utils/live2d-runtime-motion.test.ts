import { describe, expect, it } from 'vitest'

import {
  clearSelectedLive2DMotion,
  parseLive2DMotionIndex,
  readSelectedLive2DMotion,
  writeSelectedLive2DMotion,
} from './live2d-runtime-motion'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('live2d runtime idle selection persistence', () => {
  it('round-trips a valid selection including motion index zero', () => {
    const storage = createStorage()

    writeSelectedLive2DMotion(storage, { path: 'motions/idle.motion3.json', group: '', index: 0 })

    expect(readSelectedLive2DMotion(storage)).toEqual({
      motion: { path: 'motions/idle.motion3.json', group: '', index: 0 },
      hasAnyKey: true,
      invalid: false,
    })
    expect(parseLive2DMotionIndex('0')).toBe(0)
  })

  it('clears all runtime idle authority when idle is set to none', () => {
    const storage = createStorage()
    writeSelectedLive2DMotion(storage, { path: 'motions/old.motion3.json', group: 'Idle', index: 2 })

    clearSelectedLive2DMotion(storage)

    expect(readSelectedLive2DMotion(storage)).toEqual({ hasAnyKey: false, invalid: false })
  })

  it('fails closed for partial, malformed, or negative persisted selections', () => {
    const storage = createStorage()
    storage.setItem('selected-runtime-motion-group', 'Idle')
    storage.setItem('selected-runtime-motion-index', '0')
    expect(readSelectedLive2DMotion(storage)).toMatchObject({ hasAnyKey: true, invalid: true })

    storage.setItem('selected-runtime-motion', 'motions/idle.motion3.json')
    storage.setItem('selected-runtime-motion-index', '-1')
    expect(readSelectedLive2DMotion(storage)).toMatchObject({ hasAnyKey: true, invalid: true })
  })

  it('restores a newly selected motion after a none selection', () => {
    const storage = createStorage()
    writeSelectedLive2DMotion(storage, { path: 'motions/new.motion3.json', group: 'Custom', index: 0 })

    expect(readSelectedLive2DMotion(storage).motion).toEqual({
      path: 'motions/new.motion3.json',
      group: 'Custom',
      index: 0,
    })
  })
})
