import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audioDeviceMock = vi.hoisted(() => ({
  audioInputsRef: undefined as unknown as { value: MediaDeviceInfo[] },
  ensurePermissions: vi.fn(),
  startStream: vi.fn(),
  stopStream: vi.fn(),
  trackMicrophonePermissionDenied: vi.fn(),
  userMediaOptions: undefined as unknown as { constraints: unknown, enabled: boolean, autoSwitch: boolean },
}))

vi.mock('@vueuse/core', async () => {
  const { ref } = await import('vue')

  audioDeviceMock.audioInputsRef = ref([])

  return {
    useDevicesList: () => ({
      audioInputs: audioDeviceMock.audioInputsRef,
      permissionGranted: ref(false),
      ensurePermissions: audioDeviceMock.ensurePermissions,
    }),
    useUserMedia: (options: typeof audioDeviceMock.userMediaOptions) => {
      audioDeviceMock.userMediaOptions = options
      return ({
        stream: ref(undefined),
        stop: audioDeviceMock.stopStream,
        start: audioDeviceMock.startStream,
      })
    },
  }
})

vi.mock('../use-analytics', () => ({
  useAnalytics: () => ({
    trackMicrophonePermissionDenied: audioDeviceMock.trackMicrophonePermissionDenied,
  }),
}))

describe('useAudioDevice analytics lifecycle', () => {
  beforeEach(() => {
    if (audioDeviceMock.audioInputsRef)
      audioDeviceMock.audioInputsRef.value = []
    audioDeviceMock.ensurePermissions.mockReset()
    audioDeviceMock.trackMicrophonePermissionDenied.mockReset()
    audioDeviceMock.userMediaOptions = undefined as unknown as typeof audioDeviceMock.userMediaOptions
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * @example
   * await expect(askPermission()).rejects.toThrow()
   */
  it('tracks microphone permission denial without exposing browser error text', async () => {
    const { useAudioDevice } = await import('./audio-device')
    const permissionError = new DOMException('User denied microphone', 'NotAllowedError')
    audioDeviceMock.ensurePermissions.mockRejectedValue(permissionError)

    const { askPermission } = useAudioDevice()

    await expect(askPermission()).rejects.toThrow(permissionError)

    expect(audioDeviceMock.trackMicrophonePermissionDenied).toHaveBeenCalledWith({
      stt_provider_id: 'unknown',
      error_code: 'permission_denied',
    })
  })

  it('does not turn an empty device list into a product event', async () => {
    const { useAudioDevice } = await import('./audio-device')
    audioDeviceMock.ensurePermissions.mockResolvedValue(undefined)

    const { askPermission } = useAudioDevice()

    await askPermission()

    expect(audioDeviceMock.trackMicrophonePermissionDenied).not.toHaveBeenCalled()
  })

  it('requests browser AEC, noise suppression, and AGC for the microphone stream', async () => {
    const { useAudioDevice } = await import('./audio-device')
    const audioDevice = useAudioDevice()
    const audioConstraints = audioDevice.deviceConstraints.value.audio

    expect(audioDeviceMock.userMediaOptions).toMatchObject({
      enabled: false,
      autoSwitch: true,
    })
    expect(audioConstraints).toMatchObject({
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    })
  })
})
