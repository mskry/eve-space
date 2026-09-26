import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import {
  corporationAuthorityFenceEquals,
  createCorporationContinuationAuthorityBinding,
  managedCollectionAuthorityEquals,
  resolveInstalledResourceEligibility,
  selectDueInstalledResources,
} from '../../src/platform/resource-eligibility.js'

const identity = {
  moduleId: 'member-audit',
  resourceId: 'character-skills',
  subjectId: '1404328063',
  subjectKind: 'character' as const,
  subjectLifecycleId: randomUUID(),
}

describe('corporation authority bindings', () => {
  test('compares complete source and role authority independently of validation time', () => {
    const fence = {
      sourceId: randomUUID(),
      organizationVersion: 4,
      corporationLifecycleId: randomUUID(),
      corporationId: 98_000_001,
      characterId: 1_404_328_063,
      characterLifecycleId: randomUUID(),
      affiliationPeriodRevision: randomUUID(),
      authorizationGeneration: 7,
      requirementsFingerprint: 'requirements-1',
      roleRevision: randomUUID(),
    }
    expect(corporationAuthorityFenceEquals(fence, { ...fence })).toBe(true)
    expect(corporationAuthorityFenceEquals(null, null)).toBe(true)
    for (const [field, value] of [
      ['sourceId', randomUUID()],
      ['organizationVersion', 5],
      ['corporationLifecycleId', randomUUID()],
      ['characterId', 1_404_328_064],
      ['characterLifecycleId', randomUUID()],
      ['affiliationPeriodRevision', randomUUID()],
      ['authorizationGeneration', 8],
      ['requirementsFingerprint', 'requirements-2'],
      ['roleRevision', randomUUID()],
    ] as const) {
      expect(corporationAuthorityFenceEquals(fence, { ...fence, [field]: value })).toBe(false)
    }
  })

  test('derives a versioned opaque continuation value from every canonical fence component', () => {
    const fence = {
      sourceId: randomUUID(),
      organizationVersion: 4,
      corporationLifecycleId: randomUUID(),
      corporationId: 98_000_001,
      characterId: 1_404_328_063,
      characterLifecycleId: randomUUID(),
      affiliationPeriodRevision: randomUUID(),
      authorizationGeneration: 7,
      requirementsFingerprint: 'requirements-1',
      roleRevision: randomUUID(),
    }
    const binding = createCorporationContinuationAuthorityBinding(fence)
    expect(binding).toMatch(/^v1:[a-f\d]{64}$/u)
    expect(binding).toBe(createCorporationContinuationAuthorityBinding({ ...fence }))
    expect(binding).not.toContain(fence.sourceId)
    expect(binding).not.toContain(fence.roleRevision)
    for (const [field, value] of [
      ['sourceId', randomUUID()],
      ['organizationVersion', 5],
      ['corporationLifecycleId', randomUUID()],
      ['corporationId', 98_000_002],
      ['characterId', 1_404_328_064],
      ['characterLifecycleId', randomUUID()],
      ['affiliationPeriodRevision', randomUUID()],
      ['authorizationGeneration', 8],
      ['requirementsFingerprint', 'requirements-2'],
      ['roleRevision', randomUUID()],
    ] as const) {
      expect(createCorporationContinuationAuthorityBinding({ ...fence, [field]: value })).not.toBe(
        binding,
      )
    }
    expect(
      createCorporationContinuationAuthorityBinding({ ...fence, roleRevision: null }),
    ).not.toBe(binding)
    expect(createCorporationContinuationAuthorityBinding({ ...fence, roleRevision: null })).toBe(
      createCorporationContinuationAuthorityBinding({ ...fence, roleRevision: null }),
    )
  })
})

describe('installed resource eligibility', () => {
  test('selects no due work or PostgreSQL rows without installed resources', async () => {
    const connection = vi.fn()

    await expect(
      selectDueInstalledResources({ connection: connection as never, limit: 10, resources: [] }),
    ).resolves.toStrictEqual([])
    expect(connection).not.toHaveBeenCalled()
  })

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid planning limit %s before PostgreSQL selection',
    async (limit) => {
      const connection = vi.fn()

      await expect(
        selectDueInstalledResources({ connection: connection as never, limit, resources: [] }),
      ).rejects.toThrow('Resource planning limit must be a positive safe integer')
      expect(connection).not.toHaveBeenCalled()
    },
  )

  test('rejects duplicate static resource identities before PostgreSQL selection', async () => {
    const descriptor = resource('skills')

    await expect(
      selectDueInstalledResources({
        connection: vi.fn() as never,
        limit: 10,
        resources: [descriptor, descriptor],
      }),
    ).rejects.toThrow('Duplicate installed resource planning identity')
  })

  test('fails closed before PostgreSQL for undeclared resources', async () => {
    const connection = vi.fn()
    await expect(
      resolveInstalledResourceEligibility(identity, { connection: connection as never }),
    ).resolves.toStrictEqual({ status: 'resource-unavailable' })
    expect(connection).not.toHaveBeenCalled()
  })

  test.each([
    [[], { status: 'obsolete' }],
    [
      [row({ dueReason: null, eligibilityStatus: 'disabled', schedulingKey: null })],
      {
        authorizationGeneration: 7,
        dueReason: null,
        lastFailureClass: null,
        managedAuthority: null,
        nextEligibleAt: null,
        schedulingKey: null,
        status: 'disabled',
        validatedAt: null,
      },
    ],
  ])('fails closed for obsolete or disabled durable state', async (rows, expected) => {
    await expect(resolve(rows)).resolves.toStrictEqual(expected)
  })

  test('derives required scope and generation from the operation catalog', async () => {
    await expect(
      resolve([
        row({
          dueReason: null,
          eligibilityStatus: 'authorization-required',
          schedulingKey: null,
        }),
      ]),
    ).resolves.toStrictEqual({
      authorizationGeneration: 7,
      dueReason: null,
      lastFailureClass: null,
      managedAuthority: null,
      nextEligibleAt: null,
      requiredScope: 'esi-skills.read_skills.v1',
      schedulingKey: null,
      status: 'authorization-required',
      validatedAt: null,
    })
  })

  test.each([
    [
      { eligibilityStatus: 'authorization-required', requiredScope: null },
      'omitted the required authorization scope',
    ],
    [{ eligibilityStatus: 'unknown' }, 'invalid eligibility unknown'],
    [{ dueReason: null }, 'invalid due reason null'],
    [{ dueReason: 'unknown' }, 'invalid due reason unknown'],
    [{ schedulingKey: null }, 'omitted the scheduling key'],
    [{ nextEligibleAt: 'not-a-date' }, 'invalid time not-a-date'],
    [{ lastFailureClass: 'unexpected' }, 'invalid failure class unexpected'],
  ])('fails closed for malformed classifier output %#', async (overrides, message) => {
    await expect(resolve([row(overrides)])).rejects.toThrow(message)
  })

  test('returns complete managed collection authority and validated failure metadata', async () => {
    await expect(
      resolve([
        row({
          authoritySectionId: 'skills',
          disclosureVersion: 2,
          lastFailureClass: 'esi-unavailable',
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
          organizationDeploymentId: 1,
          organizationVersion: '7',
          sectionActivationVersion: 3,
          targetUserId: '00000000-0000-4000-8000-000000000002',
        }),
      ]),
    ).resolves.toMatchObject({
      lastFailureClass: 'esi-unavailable',
      managedAuthority: {
        disclosureVersion: 2,
        managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
        organizationDeploymentId: 1,
        organizationVersion: 7,
        sectionActivationVersion: 3,
        sectionId: 'skills',
        targetUserId: '00000000-0000-4000-8000-000000000002',
      },
    })
  })

  test('rejects incomplete managed collection authority', async () => {
    await expect(
      resolve([
        row({
          authoritySectionId: 'skills',
          disclosureVersion: 2,
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
          organizationDeploymentId: 1,
          organizationVersion: 7,
          sectionActivationVersion: 3,
          targetUserId: null,
        }),
      ]),
    ).rejects.toThrow('incomplete managed authority')
  })

  test.each([
    ['organizationDeploymentId', 2],
    ['organizationVersion', 0],
    ['targetUserId', ''],
    ['managedMemberLifecycleId', ''],
    ['authoritySectionId', ''],
    ['disclosureVersion', 0],
    ['sectionActivationVersion', 0],
  ] as const)('rejects invalid managed authority field %s', async (field, value) => {
    await expect(
      resolve([
        row({
          organizationDeploymentId: 1,
          organizationVersion: 7,
          targetUserId: '00000000-0000-4000-8000-000000000002',
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
          authoritySectionId: 'skills',
          disclosureVersion: 2,
          sectionActivationVersion: 3,
          [field]: value,
        }),
      ]),
    ).rejects.toThrow('invalid managed authority')
  })

  test('parses corporation authorization identity from durable classifier output', async () => {
    const corporationIdentity = {
      moduleId: 'core',
      resourceId: 'corporation-members',
      subjectId: '98000001',
      subjectKind: 'corporation' as const,
      subjectLifecycleId: randomUUID(),
    }
    const connection = vi.fn().mockResolvedValue([
      row({
        ...corporationIdentity,
        authorizationCharacterId: '1404328063',
        authorizationCharacterLifecycleId: '00000000-0000-4000-8000-000000000030',
        operationId: 'corporation-members',
      }),
    ])

    await expect(
      resolveInstalledResourceEligibility(corporationIdentity, {
        connection: connection as never,
        resources: [
          {
            eligibility: { kind: 'current-managed-corporation-source' },
            implementation: {},
            materializationIntervalSeconds: 900,
            moduleId: 'core',
            operationId: 'corporation-members',
            resourceId: 'corporation-members',
            subjectKind: 'corporation',
          },
        ],
      }),
    ).resolves.toMatchObject({
      authorizationCharacterId: 1_404_328_063,
      authorizationCharacterLifecycleId: '00000000-0000-4000-8000-000000000030',
    })
  })

  test('rejects an invalid corporation authorization character', async () => {
    const corporationIdentity = {
      moduleId: 'core',
      resourceId: 'corporation-members',
      subjectId: '98000001',
      subjectKind: 'corporation' as const,
      subjectLifecycleId: randomUUID(),
    }
    const connection = vi.fn().mockResolvedValue([
      row({
        ...corporationIdentity,
        authorizationCharacterId: 'invalid',
        operationId: 'corporation-members',
      }),
    ])

    await expect(
      resolveInstalledResourceEligibility(corporationIdentity, {
        connection: connection as never,
        resources: [
          {
            eligibility: { kind: 'current-managed-corporation-source' },
            implementation: {},
            materializationIntervalSeconds: 900,
            moduleId: 'core',
            operationId: 'corporation-members',
            resourceId: 'corporation-members',
            subjectKind: 'corporation',
          },
        ],
      }),
    ).rejects.toThrow('invalid authorization character invalid')
  })

  test('sends the declared section identity to the relational classifier', async () => {
    const connection = vi
      .fn()
      .mockResolvedValue([
        row({ dueReason: null, eligibilityStatus: 'disabled', schedulingKey: null }),
      ])

    await resolveInstalledResourceEligibility(identity, {
      connection: connection as never,
      resources: [resource('skills')],
    })

    expect(JSON.parse(connection.mock.calls[0]![1] as string)).toStrictEqual([
      expect.objectContaining({ module_id: 'member-audit', section_id: 'skills' }),
    ])
  })

  test('does not require character authorization for a public operation', async () => {
    await expect(
      resolve(
        [
          row({
            dueReason: 'future',
            expectedAuthorizationGeneration: null,
            nextEligibleAt: new Date('2026-08-27T00:00:00Z'),
            requiredScope: null,
            schedulingKey: new Date('2026-08-27T00:00:00Z'),
          }),
        ],
        'status',
      ),
    ).resolves.toStrictEqual({
      authorizationGeneration: null,
      due: false,
      dueReason: 'future',
      lastFailureClass: null,
      managedAuthority: null,
      nextEligibleAt: new Date('2026-08-27T00:00:00Z'),
      schedulingKey: new Date('2026-08-27T00:00:00Z'),
      status: 'eligible',
      validatedAt: null,
    })
  })

  test.each([
    ['never-collected', null, true, epoch],
    ['authorization-changed', new Date('2026-08-27T00:00:00Z'), true, epoch],
    ['unscheduled', null, true, epoch],
    ['elapsed', new Date('2026-08-25T00:00:00Z'), true, new Date('2026-08-25T00:00:00Z')],
    ['future', new Date('2026-08-27T00:00:00Z'), false, new Date('2026-08-27T00:00:00Z')],
  ])(
    'derives due state from collection presence, generation, and eligibility time',
    async (dueReason, nextEligibleAt, due, schedulingKey) => {
      await expect(
        resolve([
          row({
            dueReason,
            nextEligibleAt,
            schedulingKey,
          }),
        ]),
      ).resolves.toStrictEqual({
        authorizationGeneration: 7,
        due,
        dueReason,
        lastFailureClass: null,
        managedAuthority: null,
        nextEligibleAt,
        schedulingKey,
        status: 'eligible',
        validatedAt: null,
      })
    },
  )

  test('compares every managed authority identity field', () => {
    const authority = {
      disclosureVersion: 2,
      managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
      organizationDeploymentId: 1 as const,
      organizationVersion: 7,
      sectionActivationVersion: 3,
      sectionId: 'skills',
      targetUserId: '00000000-0000-4000-8000-000000000002',
    }

    expect(managedCollectionAuthorityEquals(authority, { ...authority })).toBe(true)
    expect(managedCollectionAuthorityEquals(authority, { ...authority, sectionId: 'assets' })).toBe(
      false,
    )
    expect(
      managedCollectionAuthorityEquals(authority, { ...authority, disclosureVersion: 4 }),
    ).toBe(false)
    expect(
      managedCollectionAuthorityEquals(authority, { ...authority, sectionActivationVersion: 4 }),
    ).toBe(false)
  })
})

function resolve(rows: unknown[], operationId = 'skills') {
  const connection = Object.assign(vi.fn().mockResolvedValue(rows), {
    json: vi.fn((value) => value),
  })
  return resolveInstalledResourceEligibility(identity, {
    connection: connection as never,
    now: new Date('2026-08-26T00:00:00Z'),
    resources: [resource(operationId)],
  })
}

function resource(operationId: string) {
  return {
    eligibility: { kind: 'current-owned-character' as const },
    implementation: {},
    materializationIntervalSeconds: 900,
    moduleId: identity.moduleId,
    operationId,
    resourceId: identity.resourceId,
    sectionId: 'skills',
    subjectKind: 'character' as const,
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    ...identity,
    authoritySectionId: null,
    disclosureVersion: null,
    dueReason: 'never-collected',
    eligibilityStatus: 'eligible',
    expectedAuthorizationGeneration: 7,
    lastFailureClass: null,
    managedMemberLifecycleId: null,
    nextEligibleAt: null,
    operationId: 'skills',
    organizationDeploymentId: null,
    organizationVersion: null,
    requiredScope: 'esi-skills.read_skills.v1',
    schedulingKey: epoch,
    sectionActivationVersion: null,
    targetUserId: null,
    validatedAt: null,
    ...overrides,
  }
}

const epoch = new Date(0)
