import type { EmotionPayload } from '../../constants/emotions'

import { Emotion } from '../../constants/emotions'

export const LOCAL_SEMANTIC_VALIDATION_EMOTIONS = [
  Emotion.Happy,
  Emotion.Angry,
  Emotion.Sad,
  Emotion.Surprise,
] as const

export type LocalSemanticValidationEmotion = typeof LOCAL_SEMANTIC_VALIDATION_EMOTIONS[number]

export const LOCAL_SEMANTIC_VALIDATION_LABELS: Record<LocalSemanticValidationEmotion, string> = {
  [Emotion.Happy]: 'Happy',
  [Emotion.Angry]: 'Angry',
  [Emotion.Sad]: 'Sad',
  [Emotion.Surprise]: 'Surprise',
}

export function enqueueLocalSemanticEmotion(
  enqueue: (payload: EmotionPayload) => unknown,
  emotion: LocalSemanticValidationEmotion,
) {
  enqueue({ name: emotion, intensity: 1 })
}
