import { describe, expect, it, vi } from 'vitest'

import { createStreamingTranscriptionFinalConsumer } from './final-transcript-consumer'

describe('createStreamingTranscriptionFinalConsumer', () => {
  it('publishes one final transcript as soon as a final snapshot arrives', () => {
    const updates: string[] = []
    const finals: string[] = []
    const consumer = createStreamingTranscriptionFinalConsumer({
      onUpdate: text => updates.push(text),
      onFinal: text => finals.push(text),
    })

    consumer.consume({
      type: 'transcript.text.snapshot',
      text: '你好',
      isFinal: true,
      locale: 'zh-CN',
      startMilliseconds: 0,
      durationMilliseconds: 100,
    })

    expect(updates).toEqual(['你好'])
    expect(finals).toEqual(['你好'])

    consumer.complete()
    expect(finals).toEqual(['你好'])
  })

  it('keeps deltas on the interim path until the stream completes', () => {
    const onFinal = vi.fn()
    const consumer = createStreamingTranscriptionFinalConsumer({
      onUpdate: vi.fn(),
      onFinal,
    })

    consumer.consume({ type: 'transcript.text.delta', delta: 'hello' })
    consumer.consume({ type: 'transcript.text.delta', delta: ' world' })

    expect(onFinal).not.toHaveBeenCalled()

    consumer.complete()
    expect(onFinal).toHaveBeenCalledOnce()
    expect(onFinal).toHaveBeenCalledWith('hello world')
  })

  it('drops an incomplete stream without publishing a final transcript', () => {
    const onFinal = vi.fn()
    const consumer = createStreamingTranscriptionFinalConsumer({
      onUpdate: vi.fn(),
      onFinal,
    })

    consumer.consume({
      type: 'transcript.text.snapshot',
      text: 'pending',
      isFinal: false,
      locale: 'zh-CN',
      startMilliseconds: 0,
      durationMilliseconds: 100,
    })

    expect(onFinal).not.toHaveBeenCalled()
  })

  it('does not publish an empty final snapshot', () => {
    const onFinal = vi.fn()
    const consumer = createStreamingTranscriptionFinalConsumer({
      onUpdate: vi.fn(),
      onFinal,
    })

    consumer.consume({
      type: 'transcript.text.snapshot',
      text: '   ',
      isFinal: true,
      locale: 'zh-CN',
      startMilliseconds: 0,
      durationMilliseconds: 100,
    })
    consumer.complete()

    expect(onFinal).not.toHaveBeenCalled()
  })
})
