// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConsciousnessStore } from './modules/consciousness'
import { useOnboardingStore } from './onboarding'
import { useProviderConfigStore } from './providers/config'

vi.mock('./auth', async () => {
  const { defineStore } = await import('pinia')

  return {
    useAuthStore: defineStore('auth', {
      state: () => ({
        isAuthenticated: false,
        token: null,
      }),
    }),
  }
})

vi.mock('./providers/config', async () => {
  const { defineStore } = await import('pinia')

  return {
    useProviderConfigStore: defineStore('provider-config', {
      state: () => ({
        configuredProviders: {},
        providers: {},
      }),
      actions: {
        getProviderConfig: () => undefined,
      },
    }),
  }
})

vi.mock('./modules/consciousness', async () => {
  const { defineStore } = await import('pinia')

  return {
    useConsciousnessStore: defineStore('consciousness', {
      state: () => ({
        activeProvider: '',
        activeModel: '',
      }),
    }),
  }
})

describe('onboarding store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  // ROOT CAUSE:
  //
  // The standalone onboarding renderer previously depended on a localStorage
  // event to discover that another renderer had completed authentication. Once
  // storage stopped acting as a state bus, the BrowserWindow stayed open.
  //
  // The authenticated command now persists completion and publishes a
  // monotonic close request through synchronized Pinia state.
  it('publishes a close request after authentication', () => {
    const store = useOnboardingStore()

    store.closeAfterAuthentication()

    expect(store.hasCompletedSetup).toBe(true)
    expect(store.hasSkippedSetup).toBe(false)
    expect(store.closeRequestId).toBe(1)
    expect(store.$state).not.toHaveProperty('closeRequestId')
    expect(store.$state).not.toHaveProperty('hasCompletedSetup')
    expect(localStorage.getItem('onboarding/completed')).toBe('true')
    expect(localStorage.getItem('onboarding/skipped')).toBe('false')
  })

  it('keeps a fresh profile in onboarding when no provider is configured', () => {
    const store = useOnboardingStore()

    expect(store.hasConfiguredOwnProvider).toBe(false)
    expect(store.needsOnboarding).toBe(true)
    expect(localStorage.getItem('onboarding/completed')).toBeNull()
  })

  it('recovers completion for a configured user-owned provider and active model', () => {
    const providerStore = useProviderConfigStore()
    const consciousnessStore = useConsciousnessStore()

    consciousnessStore.activeProvider = 'deepseek'
    consciousnessStore.activeModel = 'deepseek-v4-flash'
    providerStore.providers = {
      deepseek: {
        id: 'deepseek',
        definitionId: 'deepseek',
        config: {},
        status: 'configured',
        configuredBy: 'user',
      },
    }

    const store = useOnboardingStore()

    expect(store.hasConfiguredOwnProvider).toBe(true)
    expect(store.hasCompletedSetup).toBe(true)
    expect(store.needsOnboarding).toBe(false)
    expect(localStorage.getItem('onboarding/completed')).toBe('true')

    setActivePinia(createPinia())
    const restartedStore = useOnboardingStore()
    expect(restartedStore.hasCompletedSetup).toBe(true)
    expect(restartedStore.needsOnboarding).toBe(false)
  })

  it('does not recover for an incomplete provider record', () => {
    const providerStore = useProviderConfigStore()
    const consciousnessStore = useConsciousnessStore()

    consciousnessStore.activeProvider = 'deepseek'
    consciousnessStore.activeModel = 'deepseek-v4-flash'
    providerStore.providers = {
      deepseek: {
        id: 'deepseek',
        definitionId: 'deepseek',
        config: {},
        status: 'unconfigured',
        configuredBy: 'user',
      },
    }

    const store = useOnboardingStore()

    expect(store.hasConfiguredOwnProvider).toBe(false)
    expect(store.needsOnboarding).toBe(true)
    expect(localStorage.getItem('onboarding/completed')).toBeNull()
  })

  it('does not recover for a provider whose validation was bypassed', () => {
    const providerStore = useProviderConfigStore()
    const consciousnessStore = useConsciousnessStore()

    consciousnessStore.activeProvider = 'deepseek'
    consciousnessStore.activeModel = 'deepseek-v4-flash'
    providerStore.providers = {
      deepseek: {
        id: 'deepseek',
        definitionId: 'deepseek',
        config: {},
        status: 'bypassed',
        configuredBy: 'user',
      },
    }

    const store = useOnboardingStore()

    expect(store.hasConfiguredOwnProvider).toBe(false)
    expect(store.needsOnboarding).toBe(true)
    expect(localStorage.getItem('onboarding/completed')).toBeNull()
  })

  it('does not recover an auth-owned provider while signed out', () => {
    const providerStore = useProviderConfigStore()
    const consciousnessStore = useConsciousnessStore()

    consciousnessStore.activeProvider = 'official-provider'
    consciousnessStore.activeModel = 'auto'
    providerStore.providers = {
      'official-provider': {
        id: 'official-provider',
        definitionId: 'official-provider',
        config: {},
        status: 'configured',
        configuredBy: 'authentication',
      },
    }

    const store = useOnboardingStore()

    expect(store.hasConfiguredOwnProvider).toBe(false)
    expect(store.needsOnboarding).toBe(true)
    expect(localStorage.getItem('onboarding/completed')).toBeNull()
  })
})
