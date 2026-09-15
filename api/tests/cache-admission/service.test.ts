import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  coreOrganizationAdmissionScopes,
  platformOrganizationAdmissionScope,
} from '@eve-space/platform-module-contract'
import {
  loadCacheAdmissionContext,
  type CacheAdmissionServiceOptions,
} from '../../src/cache-admission/service.js'
import type {
  CharacterAdmissionFact,
  OrganizationAdmissionFoundation,
  OrganizationRevisionFacts,
} from '../../src/cache-admission/store.js'

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const now = new Date('2026-09-14T12:00:00.000Z')
const accessValidUntil = new Date('2026-09-14T14:00:00.000Z')
const moduleScope = platformOrganizationAdmissionScope('alpha', {
  audience: 'member',
  requiredPermission: 'alpha.view',
})
const moduleAdmission = {
  moduleId: 'alpha',
  admissionScope: moduleScope,
  audience: 'member' as const,
  requiredPermission: 'alpha.view',
}
const foundation: OrganizationAdmissionFoundation = {
  context: {
    organizationVersion: 7,
    state: 'compliant' as const,
    evidenceFreshness: 'fresh' as const,
    reviewDeadline: null,
    accessValidUntil,
    blocked: false,
  },
  registrationPolicyVersion: 3,
  modules: [
    {
      moduleId: 'alpha',
      enabled: true,
      updatedAt: new Date('2026-09-14T10:00:00.000Z'),
    },
  ],
}
const revisionFacts: OrganizationRevisionFacts = {
  latestAuditSequence: '42',
  roles: [
    {
      grantId: '35acd527-9539-44ad-aacf-9f8e45232267',
      role: 'hr_auditor',
      grantedAt: '2026-09-01T09:00:00.000Z',
      evidenceStatus: null,
      evidenceReviewDeadline: '2026-09-14T13:00:00.000Z',
    },
  ],
  groups: [
    {
      assignmentId: '7643fd73-6350-4307-b7cd-041b74c41ad6',
      groupId: '81974469-fdfe-4327-9f87-1df6e23badc4',
      assignedAt: '2026-09-01T09:00:00.000Z',
      expiresAt: '2026-09-14T12:45:00.000Z',
      bundleId: '345697a4-df0b-44e7-bf19-f10912c53a27',
      permissionType: 'module',
      permissionKey: 'alpha.view',
      reviewAllowed: true,
    },
  ],
}
const permissions: { modules: string[]; services: string[] } = {
  modules: ['alpha.view'],
  services: [],
}
const characters: readonly CharacterAdmissionFact[] = [
  {
    characterId: 90_000_002,
    subjectLifecycleId: '614247fe-7206-4a65-8783-30670002d833',
    tokenCharacterId: 90_000_002,
    tokenVersion: 4,
    scopes: ['scope.b', 'scope.a', 'scope.a'],
  },
]

afterEach(() => vi.unstubAllGlobals())

describe('cache admission service', () => {
  test('creates canonical character revisions and denies missing or mismatched authorization', async () => {
    const facts = [
      { ...characters[0]!, scopes: ['scope.a', 'scope.b'] },
      {
        characterId: 90_000_001,
        subjectLifecycleId: 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011',
        tokenCharacterId: null,
        tokenVersion: null,
        scopes: null,
      },
      {
        characterId: 90_000_003,
        subjectLifecycleId: null,
        tokenCharacterId: 90_000_003,
        tokenVersion: 1,
        scopes: [],
      },
    ]
    const first = await loadCacheAdmissionContext(userId, characterOnlyOptions(facts))
    const reordered = await loadCacheAdmissionContext(
      userId,
      characterOnlyOptions([{ ...characters[0]!, scopes: ['scope.b', 'scope.a', 'scope.a'] }]),
    )

    expect(first.characters).toEqual([
      { characterId: 90_000_001, admissionRevision: null },
      {
        characterId: 90_000_002,
        admissionRevision: expect.stringMatching(/^character-admission:v1:sha256:[a-f0-9]{64}$/),
      },
      { characterId: 90_000_003, admissionRevision: null },
    ])
    expect(reordered.characters[0]?.admissionRevision).toBe(first.characters[1]?.admissionRevision)
    expect(first.organization).toBeNull()
  })

  test('changes a character revision for lifecycle, token generation, and scope changes', async () => {
    const baseline = await characterRevision(characters[0]!)
    const variants = [
      { ...characters[0]!, subjectLifecycleId: 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011' },
      { ...characters[0]!, tokenVersion: 5 },
      { ...characters[0]!, scopes: ['scope.a'] },
    ]

    for (const variant of variants) expect(await characterRevision(variant)).not.toBe(baseline)
  })

  test('returns authorized core and deduplicated module scopes with bounded validity', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const authorize = vi.fn(createAuthorizer(revisionFacts.roles, permissions))
    const loadPermissions = vi.fn(async () => permissions)
    const result = await loadCacheAdmissionContext(
      userId,
      organizationOptions({ authorize, loadPermissions }),
    )

    expect(result).toEqual({
      userId,
      characters: [
        {
          characterId: 90_000_002,
          admissionRevision: expect.stringMatching(/^character-admission:v1:sha256:[a-f0-9]{64}$/),
        },
      ],
      organization: {
        organizationVersion: 7,
        admissionRevision: expect.stringMatching(/^organization-admission:v1:sha256:[a-f0-9]{64}$/),
        validUntil: '2026-09-14T12:45:00.000Z',
        admissionScopes: [
          moduleScope,
          coreOrganizationAdmissionScopes.rosterCoverage,
          coreOrganizationAdmissionScopes.activities,
        ].toSorted(),
      },
    })
    expect(loadPermissions).toHaveBeenCalledOnce()
    expect(authorize).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  })

  test('changes or removes organization admission for every current authorization input', async () => {
    const baseline = (await loadCacheAdmissionContext(userId, organizationOptions())).organization!
    const changedContexts = await Promise.all([
      loadCacheAdmissionContext(
        userId,
        organizationOptions({
          foundation: {
            ...foundation,
            context: { ...foundation.context, organizationVersion: 8 },
          },
        }),
      ),
      loadCacheAdmissionContext(
        userId,
        organizationOptions({ revision: { ...revisionFacts, latestAuditSequence: '43' } }),
      ),
      loadCacheAdmissionContext(
        userId,
        organizationOptions({
          permissions: {
            ...permissions,
            modules: permissions.modules.filter((permission) => permission !== 'alpha.view'),
          },
        }),
      ),
      loadCacheAdmissionContext(
        userId,
        organizationOptions({
          foundation: {
            ...foundation,
            context: {
              ...foundation.context,
              state: 'review_required',
              reviewDeadline: new Date('2026-09-14T12:30:00.000Z'),
            },
          },
        }),
      ),
      loadCacheAdmissionContext(
        userId,
        organizationOptions({
          foundation: {
            ...foundation,
            modules: [{ ...foundation.modules[0]!, enabled: false }],
          },
        }),
      ),
      loadCacheAdmissionContext(
        userId,
        organizationOptions({
          revision: {
            ...revisionFacts,
            roles: [{ ...revisionFacts.roles[0]!, role: 'director' }],
          },
        }),
      ),
      loadCacheAdmissionContext(
        userId,
        organizationOptions({
          revision: {
            ...revisionFacts,
            groups: [{ ...revisionFacts.groups[0]!, expiresAt: null }],
          },
        }),
      ),
    ])

    for (const context of changedContexts)
      expect(context.organization?.admissionRevision).not.toBe(baseline.admissionRevision)
    expect(changedContexts[2]?.organization?.admissionScopes).not.toContain(moduleScope)
    expect(changedContexts[3]?.organization?.validUntil).toBe('2026-09-14T12:30:00.000Z')
    expect(changedContexts[3]?.organization?.admissionScopes).not.toContain(
      coreOrganizationAdmissionScopes.rosterCoverage,
    )
    expect(changedContexts[4]?.organization?.admissionScopes).not.toContain(moduleScope)

    const suspended = await loadCacheAdmissionContext(
      userId,
      organizationOptions({
        foundation: {
          ...foundation,
          context: {
            ...foundation.context,
            state: 'suspended',
            accessValidUntil: null,
          },
        },
      }),
    )
    const blocked = await loadCacheAdmissionContext(
      userId,
      organizationOptions({
        foundation: { ...foundation, context: { ...foundation.context, blocked: true } },
      }),
    )
    expect(suspended.organization).toBeNull()
    expect(blocked.organization).toBeNull()
  })

  test('returns no organization admission when deployment setup is absent', async () => {
    const result = await loadCacheAdmissionContext(userId, {
      now,
      loadCharacters: async () => characters,
      loadOrganization: async () => null,
    })

    expect(result.organization).toBeNull()
  })
})

function characterOnlyOptions(
  facts: readonly CharacterAdmissionFact[],
): CacheAdmissionServiceOptions {
  return {
    now,
    loadCharacters: async () => facts,
    loadOrganization: async () => ({
      ...foundation,
      context: { ...foundation.context, blocked: true },
    }),
  }
}

async function characterRevision(fact: CharacterAdmissionFact) {
  const context = await loadCacheAdmissionContext(userId, characterOnlyOptions([fact]))
  return context.characters[0]?.admissionRevision
}

function organizationOptions(
  overrides: {
    readonly foundation?: typeof foundation
    readonly revision?: typeof revisionFacts
    readonly permissions?: typeof permissions
    readonly authorize?: NonNullable<CacheAdmissionServiceOptions['authorize']>
    readonly loadPermissions?: NonNullable<CacheAdmissionServiceOptions['loadPermissions']>
  } = {},
): CacheAdmissionServiceOptions {
  const selectedFoundation = overrides.foundation ?? foundation
  const selectedRevision = overrides.revision ?? revisionFacts
  const selectedPermissions = overrides.permissions ?? permissions
  return {
    now,
    loadCharacters: async () => characters,
    loadOrganization: async () => selectedFoundation,
    loadOrganizationRevision: async () => selectedRevision,
    loadPermissions: overrides.loadPermissions ?? (async () => selectedPermissions),
    authorize: overrides.authorize ?? createAuthorizer(selectedRevision.roles, selectedPermissions),
    moduleAdmissionScopes: [moduleAdmission, moduleAdmission],
  }
}

function createAuthorizer(
  roles: OrganizationRevisionFacts['roles'],
  selectedPermissions: { modules: string[]; services: string[] },
) {
  const hasHrRole = roles.some(({ role }) => role === 'hr_auditor')
  const authorize: NonNullable<CacheAdmissionServiceOptions['authorize']> = async (
    _userId,
    organization,
    declaration,
    _now,
  ) => {
    if (
      !selectedPermissions.modules.includes(declaration.requiredPermission) ||
      (declaration.audience === 'hr' && !hasHrRole)
    )
      return { authorized: false, reason: 'permission' }
    return {
      authorized: true,
      context: {
        organizationVersion: organization.organizationVersion,
        audience: declaration.audience,
        requiredPermission: declaration.requiredPermission,
        entitlementScope: organization.state === 'review_required' ? 'review' : 'all',
      },
    }
  }
  return authorize
}
