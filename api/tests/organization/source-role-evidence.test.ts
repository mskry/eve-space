import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ evaluateCorporationRoleEvidence: vi.fn() }))

vi.mock('../../src/characters/corporation-role-evidence.js', () => ({
  corporationRoleObservationRequiredScope: 'esi-characters.read_corporation_roles.v1',
  evaluateCorporationRoleEvidence: mocks.evaluateCorporationRoleEvidence,
}))

const { resolveSourceRoleEvidenceState, weakestAuthorityEvidenceState } =
  await import('../../src/organization/source-role-evidence.js')

const now = new Date('2026-09-25T12:00:00.000Z')
const roleRevision = '6f4a6f1e-3b1b-4f2f-9b41-6a6c1a7d9c55'
const source = {
  affiliationPeriodRevision: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
  authorityCorporationId: 98_000_001,
  authorizationGeneration: 7,
  characterId: 1_404_328_063,
  legacyRoleContinuityUntil: null,
  organizationVersion: 4,
  roleEvidenceRevision: roleRevision,
  sourceSubjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
  userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
}
const evidence = (overrides: Record<string, unknown> = {}) => ({
  roleRevision,
  state: 'fresh',
  status: 'fresh',
  ...overrides,
})

beforeEach(() => {
  mocks.evaluateCorporationRoleEvidence.mockReset()
})

describe('source role evidence', () => {
  test('uses the current matching revision and its clock state', async () => {
    mocks.evaluateCorporationRoleEvidence.mockResolvedValue({
      bindingCurrent: true,
      evidence: evidence(),
      outcome: 'satisfied',
    })

    await expect(resolveSourceRoleEvidenceState({} as never, source, now)).resolves.toBe('fresh')
    expect(mocks.evaluateCorporationRoleEvidence).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        binding: expect.objectContaining({
          affiliationPeriodRevision: source.affiliationPeriodRevision,
          authorizationGeneration: 7,
          subjectLifecycleId: source.sourceSubjectLifecycleId,
        }),
        predicate: 'director',
      }),
    )

    mocks.evaluateCorporationRoleEvidence.mockResolvedValue({
      bindingCurrent: true,
      evidence: evidence({ state: 'degraded', status: 'degraded' }),
      outcome: 'satisfied',
    })
    await expect(resolveSourceRoleEvidenceState({} as never, source, now)).resolves.toBe('degraded')
  })

  test('fails closed when a projection references a superseded revision', async () => {
    mocks.evaluateCorporationRoleEvidence.mockResolvedValue({
      bindingCurrent: true,
      evidence: evidence({ roleRevision: '0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6' }),
      outcome: 'satisfied',
    })

    await expect(resolveSourceRoleEvidenceState({} as never, source, now)).resolves.toBe('invalid')
  })

  test('fails closed on confirmed role loss and on a replaced binding', async () => {
    mocks.evaluateCorporationRoleEvidence.mockResolvedValueOnce({
      bindingCurrent: true,
      evidence: evidence(),
      outcome: 'unsatisfied',
    })
    await expect(resolveSourceRoleEvidenceState({} as never, source, now)).resolves.toBe('invalid')

    mocks.evaluateCorporationRoleEvidence.mockResolvedValueOnce({
      bindingCurrent: false,
      evidence: null,
      outcome: 'unavailable',
    })
    await expect(
      resolveSourceRoleEvidenceState(
        {} as never,
        { ...source, legacyRoleContinuityUntil: new Date('2026-09-25T12:30:00.000Z') },
        now,
      ),
    ).resolves.toBe('invalid')
    await expect(
      resolveSourceRoleEvidenceState(
        {} as never,
        { ...source, affiliationPeriodRevision: null },
        now,
      ),
    ).resolves.toBe('invalid')
  })

  test('honors bounded legacy continuity only until a new observation or its original deadline', async () => {
    const legacy = { ...source, legacyRoleContinuityUntil: new Date('2026-09-25T12:30:00.000Z') }
    mocks.evaluateCorporationRoleEvidence.mockResolvedValue({
      bindingCurrent: true,
      evidence: null,
      outcome: 'unavailable',
    })
    await expect(resolveSourceRoleEvidenceState({} as never, legacy, now)).resolves.toBe('fresh')
    await expect(
      resolveSourceRoleEvidenceState({} as never, legacy, new Date('2026-09-25T12:30:00.000Z')),
    ).resolves.toBe('invalid')

    mocks.evaluateCorporationRoleEvidence.mockResolvedValue({
      bindingCurrent: true,
      evidence: evidence({ roleRevision: null, state: 'pending', status: 'pending' }),
      outcome: 'unavailable',
    })
    await expect(resolveSourceRoleEvidenceState({} as never, legacy, now)).resolves.toBe('fresh')

    mocks.evaluateCorporationRoleEvidence.mockResolvedValue({
      bindingCurrent: true,
      evidence: evidence({ state: 'invalid', status: 'invalid' }),
      outcome: 'unavailable',
    })
    await expect(resolveSourceRoleEvidenceState({} as never, legacy, now)).resolves.toBe('invalid')
  })

  test('combines source and evidence states by their weakest guarantee', () => {
    expect(weakestAuthorityEvidenceState('fresh', 'degraded')).toBe('degraded')
    expect(weakestAuthorityEvidenceState('degraded', 'invalid')).toBe('invalid')
    expect(weakestAuthorityEvidenceState('fresh', 'fresh')).toBe('fresh')
  })
})
