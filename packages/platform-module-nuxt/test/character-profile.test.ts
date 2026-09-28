import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ inject: vi.fn(), provide: vi.fn() }))
vi.mock('vue', () => ({ inject: mocks.inject, provide: mocks.provide }))

import {
  providePlatformCharacterProfile,
  usePlatformCharacterProfile,
} from '../src/runtime/character-profile.js'

beforeEach(() => vi.clearAllMocks())

test('supplies one host-owned read-only profile presenter', () => {
  // SAFETY: The fixture only exercises identity of the injected presenter, not Vue rendering.
  const presenter = { name: 'FixtureCharacterProfile' } as never
  providePlatformCharacterProfile(presenter)
  const [key, supplied] = mocks.provide.mock.calls[0]!
  expect(supplied).toBe(presenter)
  mocks.inject.mockImplementation((candidate) => (candidate === key ? presenter : undefined))
  expect(usePlatformCharacterProfile()).toBe(presenter)
})

test('requires the host presenter without exposing a client or action registry', () => {
  mocks.inject.mockReturnValue(undefined)
  expect(() => usePlatformCharacterProfile()).toThrow('presenter is unavailable')
})
