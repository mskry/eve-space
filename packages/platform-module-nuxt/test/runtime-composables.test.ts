import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, toValue } from 'vue'
import { usePlatformApi } from '../src/runtime/app/composables/usePlatformApi.js'
import { usePlatformEveImages } from '../src/runtime/app/composables/usePlatformEveImages.js'
import { usePlatformMutationAnnouncement } from '../src/runtime/app/composables/usePlatformMutationAnnouncement.js'
import { usePlatformProtectedQuery } from '../src/runtime/app/composables/usePlatformProtectedQuery.js'
import { readPlatformApiResponse } from '../src/runtime.js'

const mocks = vi.hoisted(() => ({
  polite: vi.fn(),
  assertive: vi.fn(),
  getEntries: vi.fn(() => []),
  cancelQueries: vi.fn(),
  remove: vi.fn(),
  useQuery: vi.fn(),
}))
vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    public: { apiBase: 'https://api.example.test', eveImageBase: 'https://images.example.test' },
  }),
  useAnnouncer: () => ({ polite: mocks.polite, assertive: mocks.assertive }),
}))
vi.mock('@pinia/colada', () => ({
  useQueryCache: () => mocks,
  useQuery: mocks.useQuery,
}))
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', {})
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.unstubAllGlobals()
})

describe('runtime adapters', () => {
  it('uses the configured API origin and browser credentials', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    const client = usePlatformApi()
    await (client as any).api.status.$get()
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/status',
      expect.objectContaining({ credentials: 'include' }),
    )
  })
  it('reads success bodies and preserves API refusal details', async () => {
    await expect(readPlatformApiResponse(Response.json({ value: 7 }), 'Failed')).resolves.toEqual({
      value: 7,
    })
    await expect(
      readPlatformApiResponse(
        Response.json({ message: 'Authorize', code: 'scope-required' }, { status: 403 }),
        'Failed',
      ),
    ).rejects.toMatchObject({ message: 'Authorize', status: 403, code: 'scope-required' })
    await expect(
      readPlatformApiResponse(new Response('invalid', { status: 503 }), 'Unavailable'),
    ).rejects.toMatchObject({ message: 'Unavailable', status: 503 })
  })
  it('builds images from runtime configuration', () => {
    expect(usePlatformEveImages().characterPortrait(7)).toBe(
      'https://images.example.test/characters/7/portrait?size=128&tenant=tranquility',
    )
  })
  it('announces errors assertively and successes politely', () => {
    const announcements = usePlatformMutationAnnouncement()
    announcements.announceError('Failed')
    announcements.announceSuccess('Saved')
    expect(mocks.assertive).toHaveBeenCalledWith('Failed')
    expect(mocks.polite).toHaveBeenCalledWith('Saved')
  })
})

describe('protected query lifecycle', () => {
  function setup() {
    const options = ref({
      moduleId: 'mail',
      resource: ['headers'],
      subject: { kind: 'character' as const, characterId: 7 },
      access: { authenticated: true, moduleEnabled: true, ownsCharacter: true },
      query: vi.fn(),
    })
    const scope = effectScope()
    scopes.push(scope)
    scope.run(() => usePlatformProtectedQuery(options))
    const current = () => toValue(mocks.useQuery.mock.calls[0]![0])
    return { options, current }
  }
  it('blocks SSR and removes retained private results', () => {
    vi.stubGlobal('window', undefined)
    const { current } = setup()
    expect(current().enabled).toBe(false)
    expect(mocks.getEntries).toHaveBeenCalledWith({
      key: ['private', 'characters', 7, 'modules', 'mail', 'headers'],
      exact: true,
    })
  })
  it('tracks ownership, authentication, and module enablement reactively', () => {
    const { options, current } = setup()
    expect(current().enabled).toBe(true)
    expect(current().query).toBe(options.value.query)
    for (const gate of ['ownsCharacter', 'authenticated', 'moduleEnabled'] as const) {
      options.value.access[gate] = false
      expect(current().enabled).toBe(false)
      options.value.access[gate] = true
      expect(current().enabled).toBe(true)
    }
    expect(mocks.getEntries).toHaveBeenCalledTimes(3)
  })
  it('removes the previous character query on subject changes', () => {
    const { options, current } = setup()
    options.value.subject.characterId = 8
    expect(current().key).toEqual(['private', 'characters', 8, 'modules', 'mail', 'headers'])
    expect(mocks.getEntries).toHaveBeenCalledWith({
      key: ['private', 'characters', 7, 'modules', 'mail', 'headers'],
      exact: true,
    })
    options.value.subject.characterId = 0
    expect(current().enabled).toBe(false)
    expect(current().key).toEqual(['private', 'inactive-module-query', 'mail', 'headers'])
    options.value.moduleId = ''
    expect(current().enabled).toBe(false)
    expect(current().key).toEqual(['private', 'inactive-module-query', '', 'headers'])
  })
})
