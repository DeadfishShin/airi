import type { AIRIStreamTranscriptionDelta } from './index'

export interface StreamingTranscriptionFinalConsumer {
  consume: (value: AIRIStreamTranscriptionDelta) => void
  complete: () => void
}

export interface StreamingTranscriptionFinalConsumerOptions {
  onUpdate: (text: string) => void
  onFinal: (text: string) => void
}

/**
 * Keeps provider snapshots and deltas on the UI path until a final result exists.
 * A final snapshot publishes immediately so session teardown cannot remove the chat handoff.
 */
export function createStreamingTranscriptionFinalConsumer(
  options: StreamingTranscriptionFinalConsumerOptions,
): StreamingTranscriptionFinalConsumer {
  let fullText = ''
  let finalPublished = false

  const publishFinal = () => {
    const text = fullText.trim()
    if (!text || finalPublished)
      return

    finalPublished = true
    options.onFinal(text)
  }

  return {
    consume(value) {
      if (value.type === 'transcript.text.snapshot') {
        fullText = value.text
        options.onUpdate(fullText)
        if (value.isFinal)
          publishFinal()
        return
      }

      if (value.type === 'transcript.text.delta' && value.delta) {
        fullText += value.delta
        options.onUpdate(fullText)
      }
    },
    complete: publishFinal,
  }
}
