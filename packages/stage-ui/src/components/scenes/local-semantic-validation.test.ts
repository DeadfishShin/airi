import { describe, expect, it, vi } from 'vitest'

import { Emotion } from '../../constants/emotions'
import {
  enqueueLocalSemanticEmotion,
  LOCAL_SEMANTIC_VALIDATION_EMOTIONS,
} from './local-semantic-validation'

describe('local semantic validation trigger', () => {
  it('enqueues the canonical semantic emotions with no physical motion fields', () => {
    const enqueue = vi.fn()

    for (const emotion of LOCAL_SEMANTIC_VALIDATION_EMOTIONS)
      enqueueLocalSemanticEmotion(enqueue, emotion)

    expect(enqueue).toHaveBeenCalledTimes(4)
    expect(enqueue.mock.calls.map(([payload]) => payload)).toEqual([
      { name: Emotion.Happy, intensity: 1 },
      { name: Emotion.Angry, intensity: 1 },
      { name: Emotion.Sad, intensity: 1 },
      { name: Emotion.Surprise, intensity: 1 },
    ])
    for (const [payload] of enqueue.mock.calls) {
      expect(payload).not.toHaveProperty('group')
      expect(payload).not.toHaveProperty('index')
    }
  })
})
