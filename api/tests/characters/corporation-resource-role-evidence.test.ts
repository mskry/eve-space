import { describe, expect, test, vi } from 'vitest'
import {
  corporationRoleObservationRequiredScope,
  evaluateCorporationResourceRoles,
  lockCorporationResourceRolesInTransaction,
  type CorporationResourceRoleRequest,
} from '../../src/characters/corporation-role-evidence.js'

const now = new Date('2026-09-26T12:00:00.000Z')
const roleRevision = '6f4a6f1e-3b1b-4f2f-9b41-6a6c1a7d9c55'
const request: CorporationResourceRoleRequest = {
  sourceId: 'f4a2e41c-8a8e-4fc4-8ea3-4bb3974e0935',
  corporationLifecycleId: '1cfba895-359c-4a48-b21a-177d351c87a6',
  binding: {
    affiliationPeriodRevision: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
    authorityCorporationId: 98_000_001,
    authorizationGeneration: 7,
    characterId: 1_404_328_063,
    organizationVersion: 4,
    subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
    userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
  },
  requiredScopes: ['esi-corporations.read_freelance_jobs.v1'],
  predicates: ['project-manager'],
}

type EvidenceRowOverride = Partial<{
  roles: readonly string[]
  observationStatus: 'fresh' | 'degraded'
  observationFreshUntil: Date
  sourceRoleRevision: string
  tokenGeneration: number
  registeredCharacterId: number | null
  tokenScopes: readonly string[]
}>

const evidenceRow = (overrides: EvidenceRowOverride = {}) => ({
  sourceId: request.sourceId,
  registeredCharacterId: request.binding.characterId,
  organizationVersion: request.binding.organizationVersion,
  sourceUserId: request.binding.userId,
  characterId: request.binding.characterId,
  corporationId: request.binding.authorityCorporationId,
  sourceLifecycleId: request.binding.subjectLifecycleId,
  affiliationPeriodRevision: request.binding.affiliationPeriodRevision,
  authorizationGeneration: request.binding.authorizationGeneration,
  corporationLifecycleId: request.corporationLifecycleId,
  sourceRoleRevision: roleRevision,
  characterUserId: request.binding.userId,
  characterCorporationId: request.binding.authorityCorporationId,
  characterAffiliationRevision: request.binding.affiliationPeriodRevision,
  characterLifecycleId: request.binding.subjectLifecycleId,
  tokenGeneration: request.binding.authorizationGeneration,
  tokenScopes: [corporationRoleObservationRequiredScope, ...request.requiredScopes],
  observationStatus: 'fresh',
  observationRevision: roleRevision,
  observationFreshUntil: new Date('2026-09-26T12:10:00.000Z'),
  roles: ['Director', 'Project_Manager'],
  rolesAtBase: [],
  rolesAtHeadquarters: [],
  rolesAtOther: [],
  ...overrides,
})

const mockDatabase = (rows: readonly ReturnType<typeof evidenceRow>[]) => {
  const query = Object.assign(Promise.resolve(rows), {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    for: vi.fn().mockResolvedValue(rows),
  })
  const select = vi.fn(() => ({ from: vi.fn(() => query) }))
  // SAFETY: the mock supplies only the select chain exercised by this bounded query.
  return { database: { select } as never, select, query }
}

describe('bounded corporation resource role evidence', () => {
  test('evaluates one fresh exact source with one database batch and opaque revision', async () => {
    const { database, select, query } = mockDatabase([evidenceRow()])
    const [result] = await lockCorporationResourceRolesInTransaction(
      // SAFETY: this test doubles only the transaction's select chain; lock behavior is verified with PostgreSQL separately.
      database as never,
      [request],
      now,
    )
    expect(result).toEqual({
      binding: request.binding,
      corporationLifecycleId: request.corporationLifecycleId,
      freshUntil: new Date('2026-09-26T12:10:00.000Z'),
      outcome: 'satisfied',
      predicateOutcomes: { 'project-manager': true },
      revision: roleRevision,
      sourceId: request.sourceId,
    })
    expect(select).toHaveBeenCalledTimes(1)
    expect(query.for).toHaveBeenCalledWith('share', expect.any(Object))
  })

  test('distinguishes fresh negative from unavailable evidence without leaking roles', async () => {
    const cases = [
      [evidenceRow({ roles: ['Director'] }), 'unsatisfied'],
      [evidenceRow({ observationStatus: 'degraded' }), 'unavailable'],
      [evidenceRow({ observationFreshUntil: now }), 'unavailable'],
      [evidenceRow({ sourceRoleRevision: 'replaced' }), 'unavailable'],
      [evidenceRow({ tokenGeneration: 8 }), 'unavailable'],
      [evidenceRow({ registeredCharacterId: 99 }), 'unavailable'],
      [evidenceRow({ tokenScopes: [corporationRoleObservationRequiredScope] }), 'unavailable'],
    ] as const
    for (const [row, expected] of cases) {
      const { database } = mockDatabase([row])
      const [result] = await evaluateCorporationResourceRoles(database, [request], now)
      expect(result?.outcome).toBe(expected)
      expect(JSON.stringify(result)).not.toContain('Director')
      expect(JSON.stringify(result)).not.toContain('Project_Manager')
    }
  })

  test('limits batch cardinality and never substitutes another source', async () => {
    const { database, select } = mockDatabase([evidenceRow()])
    await expect(
      evaluateCorporationResourceRoles(
        database,
        Array.from({ length: 65 }, () => ({ ...request })),
        now,
      ),
    ).rejects.toThrow('exceeds reviewed bounds')
    expect(select).not.toHaveBeenCalled()
    const [result] = await evaluateCorporationResourceRoles(
      database,
      [{ ...request, sourceId: 'different' }],
      now,
    )
    expect(result?.outcome).toBe('unavailable')
  })

  test('evaluates multiple reviewed predicates for one source in a single bounded read', async () => {
    const { database, select } = mockDatabase([evidenceRow()])
    const results = await evaluateCorporationResourceRoles(
      database,
      [request, { ...request, predicates: ['station-manager', 'project-manager'] }],
      now,
    )
    expect(results.map(({ outcome }) => outcome)).toEqual(['satisfied', 'unsatisfied'])
    expect(results[1]?.predicateOutcomes).toEqual({
      'station-manager': false,
      'project-manager': true,
    })
    expect(select).toHaveBeenCalledTimes(1)
  })
})
