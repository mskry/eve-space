import { describe, expect, it } from 'vitest'
import { platformOrganizationAdmissionScope } from '@eve-space/platform-module-contract/server'
import type { PlatformQueryAdmissionScopeDescriptor } from '@eve-space/platform-module-contract/nuxt'
import {
  ESI_QUERY_RETENTION_MS,
  characterEsiPersistence,
  defineEsiQueryOptions,
  isEsiPersistenceCoherent,
  organizationEsiPersistence,
  resolvePlatformEsiPersistence,
} from '../../packages/platform-module-nuxt/src/runtime/esi-query-persistence'
import {
  esiQueryPersistenceViolations,
  queryAutoRefetchViolations,
  type EsiQuerySource,
} from '../../scripts/verify-esi-query-persistence'

const authorizedScope = {
  admissionScope: platformOrganizationAdmissionScope('example-module', {
    audience: 'member',
    requiredPermission: 'example.view',
  }),
  audience: 'member',
  authorization: 'authenticated-session',
  moduleId: 'example-module',
  requiredPermission: 'example.view',
  routeId: 'example-route',
} as const satisfies PlatformQueryAdmissionScopeDescriptor & { readonly moduleId: string }
const ownedCharacterScope = {
  ...authorizedScope,
  authorization: 'owned-character',
  routeId: 'owned-character-route',
} as const satisfies PlatformQueryAdmissionScopeDescriptor & { readonly moduleId: string }

describe('ESI query persistence declarations', () => {
  it('applies 24-hour garbage collection only to persistence-eligible classifications', () => {
    const characterOptions = defineEsiQueryOptions((characterId: number) => ({
      esiPersistence: characterEsiPersistence(characterId),
      key: ['private', 'characters', characterId, 'skills'],
      query: async () => ({ characterId }),
      staleTime: 30_000,
    }))(90_000_001)
    const publicOptions = defineEsiQueryOptions((root: 'public') => ({
      esiPersistence: { kind: 'public-esi' as const },
      key: [root, 'characters', 90_000_001],
      query: async () => ({ characterId: 90_000_001 }),
    }))('public')
    const organizationOptions = defineEsiQueryOptions((admissionScope: string) => ({
      esiPersistence: organizationEsiPersistence(admissionScope),
      key: ['private', 'organization', 'activities'],
      query: async () => [],
    }))('organization:v1:core:member:organization.activities')
    const excludedOptions = defineEsiQueryOptions((root: 'auth') => ({
      esiPersistence: { kind: 'none' as const },
      gcTime: 12_345,
      key: [root, 'session'],
      query: async () => ({ authenticated: false }),
    }))('auth')

    expect(characterOptions.gcTime).toBe(ESI_QUERY_RETENTION_MS)
    expect(publicOptions.gcTime).toBe(ESI_QUERY_RETENTION_MS)
    expect(organizationOptions.gcTime).toBe(ESI_QUERY_RETENTION_MS)
    expect(excludedOptions.gcTime).toBe(12_345)
    expect(characterOptions.meta?.esiPersistence).toStrictEqual({
      characterId: 90_000_001,
      kind: 'character-esi',
    })
  })

  it('rejects persistence declarations that disagree with their query identity', () => {
    expect(
      isEsiPersistenceCoherent(['public', 'characters', 90_000_001], {
        characterId: 90_000_001,
        kind: 'character-esi',
      }),
    ).toBe(false)
    expect(
      isEsiPersistenceCoherent(['private', 'characters', 90_000_002, 'skills'], {
        characterId: 90_000_001,
        kind: 'character-esi',
      }),
    ).toBe(false)
    expect(
      isEsiPersistenceCoherent(['private', 'organization', 'activities'], {
        admissionScope: 'organization:v1:core:member:organization.activities',
        kind: 'organization-esi',
      }),
    ).toBe(true)
    expect(
      isEsiPersistenceCoherent(
        ['private', 'organization', 3, 'modules', 'example-module', 'summary'],
        {
          admissionScope: 'organization:v1:another-module:member:example.view',
          kind: 'organization-esi',
        },
      ),
    ).toBe(false)
    expect(
      isEsiPersistenceCoherent(['private', 'characters', 90_000_001, 'modules', 'example'], {
        admissionScope: 'organization:v1:example:member:example.view',
        kind: 'organization-esi',
      }),
    ).toBe(false)
  })

  it('admits only generated module route and authorization pairs', () => {
    expect(
      resolvePlatformEsiPersistence(
        [authorizedScope],
        'example-module',
        'example-route',
        'authenticated-session',
      ),
    ).toStrictEqual({ admissionScope: authorizedScope.admissionScope, kind: 'organization-esi' })
    expect(
      resolvePlatformEsiPersistence(
        [authorizedScope],
        'example-module',
        'unknown-route',
        'authenticated-session',
      ),
    ).toStrictEqual({ kind: 'none' })
    expect(
      resolvePlatformEsiPersistence(
        [authorizedScope, ownedCharacterScope],
        'example-module',
        'owned-character-route',
        'owned-character',
      ),
    ).toStrictEqual({ kind: 'none' })
  })
})

describe('ESI query persistence verifier', () => {
  it('reports missing core declarations and unauthorized module routes', () => {
    const sources: EsiQuerySource[] = [
      {
        kind: 'core',
        path: 'app/queries/missing.ts',
        source:
          "const first = defineQueryOptions(() => ({ key: ['public'], query: async () => 1 }))\nconst second = defineEsiQueryOptions(() => ({ key: ['public'], query: async () => 2 }))",
      },
      {
        kind: 'module',
        path: 'features/example/nuxt/src/useExample.ts',
        source:
          "usePlatformProtectedQuery(() => ({ esiPersistence: { kind: 'none' }, moduleId: 'example-module', routeId: 'other-route', subject: { kind: 'character', characterId: 7 }, query: async () => 1 }))",
      },
    ]

    expect(esiQueryPersistenceViolations(sources, [authorizedScope])).toStrictEqual([
      'app/queries/missing.ts must use defineEsiQueryOptions for query definitions',
      'app/queries/missing.ts has a query without an ESI persistence declaration',
      'features/example/nuxt/src/useExample.ts uses unauthorized query admission route example-module/other-route',
    ])
  })

  it('reports generated scopes that disagree with authorization metadata', () => {
    expect(
      esiQueryPersistenceViolations([], [{ ...authorizedScope, admissionScope: 'wrong-scope' }]),
    ).toStrictEqual(['Generated query admission scope example-module/example-route is incoherent'])
  })

  it('accepts owned-character query routes without treating them as persistable', () => {
    const sources: EsiQuerySource[] = [
      {
        kind: 'module',
        path: 'features/example/nuxt/src/useExample.ts',
        source:
          "usePlatformProtectedQuery(() => ({ esiPersistence: { kind: 'none' }, moduleId: 'example-module', routeId: 'owned-character-route', subject: { kind: 'character', characterId: 7 }, query: async () => 1 }))",
      },
    ]

    expect(esiQueryPersistenceViolations(sources, [ownedCharacterScope])).toStrictEqual([])
    expect(
      resolvePlatformEsiPersistence(
        [ownedCharacterScope],
        'example-module',
        'owned-character-route',
        'owned-character',
      ),
    ).toStrictEqual({ kind: 'none' })
  })

  it('requires explicit module intent and rejects persistence outside the platform seam', () => {
    const sources: EsiQuerySource[] = [
      {
        kind: 'module',
        path: 'features/example/nuxt/src/useMissing.ts',
        source:
          "usePlatformProtectedQuery(() => ({ moduleId: 'example-module', routeId: 'example-route', subject: { kind: 'organization', organizationVersion: 3 }, query: async () => 1 }))",
      },
      {
        kind: 'module',
        path: 'features/example/nuxt/src/useDirect.ts',
        source:
          "useQuery({ key: ['private'], meta: { esiPersistence: { kind: 'public-esi' } }, query: async () => 1 })",
      },
      {
        kind: 'module',
        path: 'features/example/nuxt/src/useOwned.ts',
        source:
          "usePlatformProtectedQuery(() => ({ esiPersistence: { kind: 'organization-esi' }, moduleId: 'example-module', routeId: 'owned-character-route', subject: { kind: 'character', characterId: 7 }, query: async () => 1 }))",
      },
    ]

    expect(
      esiQueryPersistenceViolations(sources, [authorizedScope, ownedCharacterScope]),
    ).toStrictEqual([
      'features/example/nuxt/src/useMissing.ts has a module query without an ESI persistence declaration',
      'features/example/nuxt/src/useDirect.ts must not define module persistence outside the platform seam',
      'features/example/nuxt/src/useOwned.ts cannot persist example-module/owned-character-route without organization authorization',
    ])
  })

  it('reserves conditional auto-refetch for system status', () => {
    const sources: EsiQuerySource[] = [
      {
        kind: 'core',
        path: 'app/queries/system-status.ts',
        source: 'const status = { autoRefetch: (state) => state.data ? 60_000 : false }',
      },
      {
        kind: 'core',
        path: 'app/queries/characters.ts',
        source: 'const characters = { autoRefetch: true }',
      },
    ]

    expect(queryAutoRefetchViolations(sources)).toStrictEqual([
      'app/queries/characters.ts must not enable query auto-refetch',
    ])

    expect(
      queryAutoRefetchViolations([
        {
          kind: 'core',
          path: 'app/queries/system-status.ts',
          source: 'const status = { autoRefetch: true }',
        },
      ]),
    ).toStrictEqual(['app/queries/system-status.ts must use conditional auto-refetch'])
  })
})
