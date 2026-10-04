import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadAdmissionWork } from '../../src/auth/read-work.js'

interface FixtureInventoryProvider {
  readonly moduleId: string
  readonly sectionId: string
  readonly requiredPermission: string
  readonly contractVersion: number
}

const boundary = vi.hoisted(() => ({
  enabled: vi.fn(),
  scope: vi.fn(),
  sources: vi.fn(),
  audit: vi.fn(),
  providers: new Array<FixtureInventoryProvider>(),
}))
vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: boundary.enabled,
}))
vi.mock('../../src/organization/inventory-admission.js', () => ({
  admitCorporationInventoryScope: boundary.scope,
}))
vi.mock('../../src/platform/inventory-source-admission.js', () => ({
  loadCorporationInventorySourceSubjects: boundary.sources,
}))
vi.mock('../../src/platform/inventory-access-audit.js', () => ({
  recordInventoryAccessDecision: boundary.audit,
}))
vi.mock('../../src/generated/platform/installed-module-inventory-providers.js', () => ({
  installedInventoryProviders: boundary.providers,
}))
vi.mock('../../src/auth/inventory-subject-store.js', () => ({
  loadPersonalInventorySubjects: vi.fn(),
}))
vi.mock('../../src/auth/tokens.js', () => ({ schedulePendingCharacterTokenRecovery: vi.fn() }))

import {
  admitInventory,
  createInventoryReadGuard,
  corporationInventoryEvidenceAdmission,
  type CorporationInventoryBinding,
} from '../../src/platform/inventory-admission.js'
import { GraphQLRequestState } from '../../src/graphql/request-state.js'
import { immediateReadWork } from '../../src/auth/read-work.js'
import { ReadAdmissionError } from '../../src/auth/read-policy.js'

const session = {
  userId: 'actor',
  mainCharacter: { characterId: 1, name: 'Actor', corporationId: 98, allianceId: null },
}
const declaration = {
  moduleId: 'trading',
  publisherPackage: '@eve-space/trading-manifest',
  audience: 'hr' as const,
  requiredPermission: 'trading.inventory.corporation.read',
  additionalRequiredPermissions: ['member-audit.assets.read'],
}
const request = { scope: 'corporation' as const, corporationId: 98, declaration }
const subject = {
  characterId: 1,
  characterName: 'Target',
  userId: 'target',
  characterLifecycle: 'life',
  memberLifecycle: 'member',
  corporationId: 98,
  affiliationPeriodRevision: 'period',
  authorizationRevision: 7,
  authorizationGeneration: 7,
  disclosureRevision: 2,
  sectionActivationRevision: 3,
  evidenceReadable: true,
  coverage: null,
  pendingAttemptId: null,
  observationId: null,
}
const scope = {
  actorUserId: 'actor',
  corporationId: 98,
  selection: undefined,
  declaration,
  organization: {
    organizationVersion: 3,
    audience: 'hr',
    requiredPermission: declaration.requiredPermission,
    additionalRequiredPermissions: declaration.additionalRequiredPermissions,
    entitlementScope: 'all',
  },
  viewerFingerprint: 'viewer',
  policyVersion: 4,
  subjects: [subject, { ...subject, characterId: 2 }],
}

beforeEach(() => {
  boundary.enabled.mockResolvedValue(true)
  boundary.scope.mockResolvedValue({ admitted: true, binding: scope })
  boundary.sources.mockResolvedValue([
    Object.freeze({ ...subject }),
    Object.freeze({
      ...subject,
      characterId: 2,
      evidenceReadable: false,
      coverage: 'authorization-required',
    }),
  ])
  boundary.audit.mockResolvedValue(undefined)
  boundary.providers.splice(0, boundary.providers.length, {
    moduleId: 'member-audit',
    sectionId: 'assets',
    requiredPermission: 'member-audit.assets.read',
    contractVersion: 1,
  })
})

const admitted = async (): Promise<CorporationInventoryBinding> => {
  const result = await admitInventory(session, request)
  if (!result.admitted || result.binding.scope !== 'corporation')
    throw new Error('Expected corporation admission')
  return result.binding
}

describe('inventory authority fencing and content-free access', () => {
  it('separates coverage-only subjects from the provider evidence capability', async () => {
    const binding = await admitted()
    expect(binding.subjects.map((row) => row.characterId)).toEqual([1, 2])
    const grant = corporationInventoryEvidenceAdmission(binding)
    expect(grant.subjects.map((row) => row.characterId)).toEqual([1])
    expect(Object.isFrozen(grant.subjects)).toBe(true)
    const guard = createInventoryReadGuard(binding, async () => session)
    expect(
      await guard.runSource(async (subjects) => subjects.map((row) => row.characterId)),
    ).toEqual([1])
  })

  it.each([
    'authorizationRevision',
    'disclosureRevision',
    'sectionActivationRevision',
    'characterLifecycle',
    'memberLifecycle',
    'affiliationPeriodRevision',
  ])('refuses release and reuse after %s changes', async (property) => {
    const binding = await admitted()
    const guard = createInventoryReadGuard(binding, async () => session)
    const result = await guard
      .runSource(async () => {
        boundary.sources.mockResolvedValue([{ ...subject, [property]: 'changed' }])
        return 'private-result'
      })
      .catch((error) => error)
    expect(result).toBeInstanceOf(ReadAdmissionError)
    await expect(guard.assertCurrent()).rejects.toBeInstanceOf(ReadAdmissionError)
    expect(boundary.audit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'denied', subjects: [], corporationId: null }),
    )
  })

  it.each(['permission', 'departure', 'organization', 'enablement', 'owner'])(
    'refuses asynchronous results after %s changes',
    async (change) => {
      const binding = await admitted()
      let live = session
      const guard = createInventoryReadGuard(binding, async () => live)
      await expect(
        guard.runSource(async () => {
          if (change === 'permission')
            boundary.scope.mockResolvedValue({
              admitted: false,
              status: 403,
              body: { code: 'ORGANIZATION_PERMISSION_REQUIRED', message: 'Denied' },
            })
          if (change === 'departure') {
            boundary.scope.mockResolvedValue({
              admitted: true,
              binding: { ...scope, subjects: [] },
            })
            boundary.sources.mockResolvedValue([])
          }
          if (change === 'organization')
            boundary.scope.mockResolvedValue({
              admitted: true,
              binding: {
                ...scope,
                organization: { ...scope.organization, organizationVersion: 4 },
              },
            })
          if (change === 'enablement') boundary.enabled.mockResolvedValue(false)
          if (change === 'owner') live = { ...session, userId: 'other' }
          return 'private-result'
        }),
      ).rejects.toBeInstanceOf(ReadAdmissionError)
    },
  )

  it('rechecks queued slots and never starts source work after authority loss', async () => {
    const state = new GraphQLRequestState(new AbortController().signal)
    const binding = await admitted()
    let runCount = 0
    let unblock!: () => void
    let blockers: Promise<void>[] = []
    const work: ReadAdmissionWork = {
      run: async (load) => {
        runCount += 1
        if (runCount === 2) {
          const barrier = new Promise<void>((resolve) => {
            unblock = resolve
          })
          blockers = Array.from({ length: 4 }, () => state.run(async () => barrier))
          await Promise.resolve()
          boundary.enabled.mockResolvedValue(false)
          queueMicrotask(unblock)
        }
        return state.run(() => load(immediateReadWork))
      },
    }
    const guard = createInventoryReadGuard(
      binding,
      async (slot = work) => slot.run(async () => session),
      work,
    )
    const load = vi.fn(async () => 'private')
    await expect(guard.runSource(load)).rejects.toBeInstanceOf(ReadAdmissionError)
    await Promise.all(blockers)
    expect(load).not.toHaveBeenCalled()
  })

  it('runs four concurrent guarded reads without nested slot deadlock', async () => {
    const binding = await admitted()
    const state = new GraphQLRequestState(new AbortController().signal)
    const guard = createInventoryReadGuard(
      binding,
      async (slot = state) => slot.run(async () => session),
      state,
    )
    expect(
      await Promise.all(Array.from({ length: 4 }, () => guard.runSource(async () => 'readable'))),
    ).toEqual(['readable', 'readable', 'readable', 'readable'])
  })

  it('requires persistence of aggregate and bounded holder attribution before release', async () => {
    const binding = await admitted()
    const guard = createInventoryReadGuard(binding, async () => session)
    expect(await guard.release('private')).toBe('private')
    expect(boundary.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accessKind: 'aggregate',
        decision: 'allowed',
        subjects: expect.arrayContaining([
          expect.objectContaining({ characterId: 2, evidenceReadable: false }),
        ]),
      }),
    )
    await guard.release('private-holder', 'holders', [1])
    expect(
      boundary.audit.mock.lastCall?.[0].subjects.map(
        (row: { characterId: number }) => row.characterId,
      ),
    ).toEqual([1])
    await expect(guard.release('forbidden', 'holders', [999])).rejects.toThrow('holder scope')
    boundary.audit.mockRejectedValue(new Error('Audit unavailable'))
    await expect(guard.release('private')).rejects.toThrow('Audit unavailable')
  })

  it('does not enumerate sources when the optional provider is absent or actor admission fails', async () => {
    boundary.providers.splice(0)
    expect(await admitInventory(session, request)).toMatchObject({ admitted: false })
    expect(boundary.sources).not.toHaveBeenCalled()
    expect(boundary.audit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'denied', subjects: [], corporationId: null }),
    )
  })
})
