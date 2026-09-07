import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ inject: vi.fn(), provide: vi.fn() }))

vi.mock('vue', () => ({ inject: mocks.inject, provide: mocks.provide }))

import { providePlatformIdentity, usePlatformIdentity } from '../src/runtime/identity.js'

beforeEach(() => {
  vi.clearAllMocks()
})

test('provides and resolves the host identity factory', () => {
  const identity = { authenticated: true }
  const factory = () => identity as never

  providePlatformIdentity(factory)

  const [key, providedFactory] = mocks.provide.mock.calls[0]!
  expect(providedFactory).toBe(factory)
  mocks.inject.mockImplementation((injectedKey) => (injectedKey === key ? factory : undefined))
  expect(usePlatformIdentity()).toBe(identity)
})

test('requires the host to provide an identity factory', () => {
  mocks.inject.mockReturnValue(undefined)

  expect(() => usePlatformIdentity()).toThrow('Platform identity has not been provided by the host')
})
