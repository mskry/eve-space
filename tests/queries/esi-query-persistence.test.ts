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
  moduleId: 'example-module',
  routeId: 'example-route',
  authorization: 'authenticated-session',
  audience: 'member',
  requiredPermission: 'example.view',
  admissionScope: platformOrganizationAdmissionScope('example-module', {
    audience: 'member',
    requiredPermission: 'example.view',
  }),
} as const satisfies PlatformQueryAdmissionScopeDescriptor & { readonly moduleId: string }
const ownedCharacterScope = {
  ...authorizedScope,
  routeId: 'owned-character-route',
  authorization: 'owned-character',
} as const satisfies PlatformQueryAdmissionScopeDescriptor & { readonly moduleId: string }

describe('ESI query persistence declarations', () => {
  it('applies 24-hour garbage collection only to persistence-eligible classifications', () => {
    const characterOptions = defineEsiQueryOptions((characterId: number) => ({
      key: ['private', 'characters', characterId, 'skills'],
      query: async () => ({ characterId }),
      staleTime: 30_000,
      esiPersistence: characterEsiPersistence(characterId),
    }))(90_000_001)
    const publicOptions = defineEsiQueryOptions((root: 'public') => ({
      key: [root, 'characters', 90_000_001],
      query: async () => ({ characterId: 90_000_001 }),
      esiPersistence: { kind: 'public-esi' as const },
    }))('public')
    const organizationOptions = defineEsiQueryOptions((admissionScope: string) => ({
      key: ['private', 'organization', 'activities'],
      query: async () => [],
      esiPersistence: organizationEsiPersistence(admissionScope),
    }))('organization:v1:core:member:organization.activities')
    const excludedOptions = defineEsiQueryOptions((root: 'auth') => ({
      key: [root, 'session'],
      query: async () => ({ authenticated: false }),
      gcTime: 12_345,
      esiPersistence: { kind: 'none' as const },
    }))('auth')

    expect(characterOptions.gcTime).toBe(ESI_QUERY_RETENTION_MS)
    expect(publicOptions.gcTime).toBe(ESI_QUERY_RETENTION_MS)
    expect(organizationOptions.gcTime).toBe(ESI_QUERY_RETENTION_MS)
    expect(excludedOptions.gcTime).toBe(12_345)
    expect(characterOptions.meta?.esiPersistence).toEqual({
      kind: 'character-esi',
      characterId: 90_000_001,
    })
  })

  it('rejects persistence declarations that disagree with their query identity', () => {
    expect(
      isEsiPersistenceCoherent(['public', 'characters', 90_000_001], {
        kind: 'character-esi',
        characterId: 90_000_001,
      }),
    ).toBe(false)
    expect(
      isEsiPersistenceCoherent(['private', 'characters', 90_000_002, 'skills'], {
        kind: 'character-esi',
        characterId: 90_000_001,
      }),
    ).toBe(false)
    expect(
      isEsiPersistenceCoherent(['private', 'organization', 'activities'], {
        kind: 'organization-esi',
        admissionScope: 'organization:v1:core:member:organization.activities',
      }),
    ).toBe(true)
    expect(
      isEsiPersistenceCoherent(
        ['private', 'organization', 3, 'modules', 'example-module', 'summary'],
        {
          kind: 'organization-esi',
          admissionScope: 'organization:v1:another-module:member:example.view',
        },
      ),
    ).toBe(false)
    expect(
      isEsiPersistenceCoherent(['private', 'characters', 90_000_001, 'modules', 'example'], {
        kind: 'organization-esi',
        admissionScope: 'organization:v1:example:member:example.view',
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
    ).toEqual({ kind: 'organization-esi', admissionScope: authorizedScope.admissionScope })
    expect(
      resolvePlatformEsiPersistence(
        [authorizedScope],
        'example-module',
        'unknown-route',
        'authenticated-session',
      ),
    ).toEqual({ kind: 'none' })
    expect(
      resolvePlatformEsiPersistence(
        [authorizedScope, ownedCharacterScope],
        'example-module',
        'owned-character-route',
        'owned-character',
      ),
    ).toEqual({ kind: 'none' })
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

    expect(esiQueryPersistenceViolations(sources, [authorizedScope])).toEqual([
      'app/queries/missing.ts must use defineEsiQueryOptions for query definitions',
      'app/queries/missing.ts has a query without an ESI persistence declaration',
      'features/example/nuxt/src/useExample.ts uses unauthorized query admission route example-module/other-route',
    ])
  })

  it('reports generated scopes that disagree with authorization metadata', () => {
    expect(
      esiQueryPersistenceViolations([], [{ ...authorizedScope, admissionScope: 'wrong-scope' }]),
    ).toEqual(['Generated query admission scope example-module/example-route is incoherent'])
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

    expect(esiQueryPersistenceViolations(sources, [ownedCharacterScope])).toEqual([])
    expect(
      resolvePlatformEsiPersistence(
        [ownedCharacterScope],
        'example-module',
        'owned-character-route',
        'owned-character',
      ),
    ).toEqual({ kind: 'none' })
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

    expect(esiQueryPersistenceViolations(sources, [authorizedScope, ownedCharacterScope])).toEqual([
      'features/example/nuxt/src/useMissing.ts has a module query without an ESI persistence declaration',
      'features/example/nuxt/src/useDirect.ts must not define module persistence outside the platform seam',
      'features/example/nuxt/src/useOwned.ts cannot persist example-module/owned-character-route without organization authorization',
    ])
  })

  it('reserves the sole auto-refetch opt-in for system status', () => {
    const sources: EsiQuerySource[] = [
      {
        kind: 'core',
        path: 'app/queries/system-status.ts',
        source: 'const status = { autoRefetch: true }',
      },
      {
        kind: 'core',
        path: 'app/queries/characters.ts',
        source: 'const characters = { autoRefetch: true }',
      },
    ]

    expect(queryAutoRefetchViolations(sources)).toEqual([
      'app/queries/characters.ts must not enable query auto-refetch',
    ])
  })
})
