import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import {
  managedCollectionAuthorityEquals,
  resolveInstalledResourceEligibility,
  selectDueInstalledResources,
} from '../../src/platform/resource-eligibility.js'

const identity = {
  moduleId: 'member-audit',
  resourceId: 'character-skills',
  subjectKind: 'character' as const,
  subjectLifecycleId: randomUUID(),
  subjectId: '1404328063',
}

describe('installed resource eligibility', () => {
  test('selects no due work or PostgreSQL rows without installed resources', async () => {
    const connection = vi.fn()

    await expect(
      selectDueInstalledResources({ limit: 10, resources: [], connection: connection as never }),
    ).resolves.toEqual([])
    expect(connection).not.toHaveBeenCalled()
  })

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid planning limit %s before PostgreSQL selection',
    async (limit) => {
      const connection = vi.fn()

      await expect(
        selectDueInstalledResources({ limit, resources: [], connection: connection as never }),
      ).rejects.toThrow('Resource planning limit must be a positive safe integer')
      expect(connection).not.toHaveBeenCalled()
    },
  )

  test('rejects duplicate static resource identities before PostgreSQL selection', async () => {
    const descriptor = resource('skills')

    await expect(
      selectDueInstalledResources({
        limit: 10,
        resources: [descriptor, descriptor],
        connection: vi.fn() as never,
      }),
    ).rejects.toThrow('Duplicate installed resource planning identity')
  })

  test('fails closed before PostgreSQL for undeclared resources', async () => {
    const connection = vi.fn()
    await expect(
      resolveInstalledResourceEligibility(identity, { connection: connection as never }),
    ).resolves.toEqual({ status: 'resource-unavailable' })
    expect(connection).not.toHaveBeenCalled()
  })

  test.each([
    [[], { status: 'obsolete' }],
    [
      [row({ eligibilityStatus: 'disabled', dueReason: null, schedulingKey: null })],
      {
        status: 'disabled',
        authorizationGeneration: 7,
        dueReason: null,
        schedulingKey: null,
        nextEligibleAt: null,
        validatedAt: null,
        lastFailureClass: null,
        managedAuthority: null,
      },
    ],
  ])('fails closed for obsolete or disabled durable state', async (rows, expected) => {
    await expect(resolve(rows)).resolves.toEqual(expected)
  })

  test('derives required scope and generation from the operation catalog', async () => {
    await expect(
      resolve([
        row({
          eligibilityStatus: 'authorization-required',
          dueReason: null,
          schedulingKey: null,
        }),
      ]),
    ).resolves.toEqual({
      status: 'authorization-required',
      authorizationGeneration: 7,
      requiredScope: 'esi-skills.read_skills.v1',
      dueReason: null,
      schedulingKey: null,
      nextEligibleAt: null,
      validatedAt: null,
      lastFailureClass: null,
      managedAuthority: null,
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
          organizationDeploymentId: 1,
          organizationVersion: '7',
          targetUserId: '00000000-0000-4000-8000-000000000002',
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
          authoritySectionId: 'skills',
          disclosureVersion: 2,
          sectionActivationVersion: 3,
          lastFailureClass: 'esi-unavailable',
        }),
      ]),
    ).resolves.toMatchObject({
      lastFailureClass: 'esi-unavailable',
      managedAuthority: {
        organizationDeploymentId: 1,
        organizationVersion: 7,
        targetUserId: '00000000-0000-4000-8000-000000000002',
        managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
        sectionId: 'skills',
        disclosureVersion: 2,
        sectionActivationVersion: 3,
      },
    })
  })

  test('rejects incomplete managed collection authority', async () => {
    await expect(
      resolve([
        row({
          organizationDeploymentId: 1,
          organizationVersion: 7,
          targetUserId: null,
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
          authoritySectionId: 'skills',
          disclosureVersion: 2,
          sectionActivationVersion: 3,
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
      subjectKind: 'corporation' as const,
      subjectLifecycleId: randomUUID(),
      subjectId: '98000001',
    }
    const connection = vi.fn().mockResolvedValue([
      row({
        ...corporationIdentity,
        operationId: 'corporation-members',
        authorizationCharacterId: '1404328063',
        authorizationCharacterLifecycleId: '00000000-0000-4000-8000-000000000030',
      }),
    ])

    await expect(
      resolveInstalledResourceEligibility(corporationIdentity, {
        connection: connection as never,
        resources: [
          {
            moduleId: 'core',
            resourceId: 'corporation-members',
            operationId: 'corporation-members',
            subjectKind: 'corporation',
            materializationIntervalSeconds: 900,
            eligibility: { kind: 'current-managed-corporation-source' },
            implementation: {},
          },
        ],
      }),
    ).resolves.toMatchObject({
      authorizationCharacterId: 1404328063,
      authorizationCharacterLifecycleId: '00000000-0000-4000-8000-000000000030',
    })
  })

  test('rejects an invalid corporation authorization character', async () => {
    const corporationIdentity = {
      moduleId: 'core',
      resourceId: 'corporation-members',
      subjectKind: 'corporation' as const,
      subjectLifecycleId: randomUUID(),
      subjectId: '98000001',
    }
    const connection = vi.fn().mockResolvedValue([
      row({
        ...corporationIdentity,
        operationId: 'corporation-members',
        authorizationCharacterId: 'invalid',
      }),
    ])

    await expect(
      resolveInstalledResourceEligibility(corporationIdentity, {
        connection: connection as never,
        resources: [
          {
            moduleId: 'core',
            resourceId: 'corporation-members',
            operationId: 'corporation-members',
            subjectKind: 'corporation',
            materializationIntervalSeconds: 900,
            eligibility: { kind: 'current-managed-corporation-source' },
            implementation: {},
          },
        ],
      }),
    ).rejects.toThrow('invalid authorization character invalid')
  })

  test('sends the declared section identity to the relational classifier', async () => {
    const connection = vi
      .fn()
      .mockResolvedValue([
        row({ eligibilityStatus: 'disabled', dueReason: null, schedulingKey: null }),
      ])

    await resolveInstalledResourceEligibility(identity, {
      connection: connection as never,
      resources: [resource('skills')],
    })

    expect(JSON.parse(connection.mock.calls[0]![1] as string)).toEqual([
      expect.objectContaining({ module_id: 'member-audit', section_id: 'skills' }),
    ])
  })

  test('does not require character authorization for a public operation', async () => {
    await expect(
      resolve(
        [
          row({
            expectedAuthorizationGeneration: null,
            requiredScope: null,
            dueReason: 'future',
            schedulingKey: new Date('2026-08-27T00:00:00Z'),
            nextEligibleAt: new Date('2026-08-27T00:00:00Z'),
          }),
        ],
        'status',
      ),
    ).resolves.toEqual({
      status: 'eligible',
      due: false,
      dueReason: 'future',
      schedulingKey: new Date('2026-08-27T00:00:00Z'),
      authorizationGeneration: null,
      nextEligibleAt: new Date('2026-08-27T00:00:00Z'),
      validatedAt: null,
      lastFailureClass: null,
      managedAuthority: null,
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
            schedulingKey,
            nextEligibleAt,
          }),
        ]),
      ).resolves.toEqual({
        status: 'eligible',
        due,
        dueReason,
        schedulingKey,
        authorizationGeneration: 7,
        nextEligibleAt,
        validatedAt: null,
        lastFailureClass: null,
        managedAuthority: null,
      })
    },
  )

  test('compares every managed authority identity field', () => {
    const authority = {
      organizationDeploymentId: 1 as const,
      organizationVersion: 7,
      targetUserId: '00000000-0000-4000-8000-000000000002',
      managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
      sectionId: 'skills',
      disclosureVersion: 2,
      sectionActivationVersion: 3,
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
    moduleId: identity.moduleId,
    sectionId: 'skills',
    resourceId: identity.resourceId,
    operationId,
    subjectKind: 'character' as const,
    materializationIntervalSeconds: 900,
    eligibility: { kind: 'current-owned-character' as const },
    implementation: {},
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    ...identity,
    operationId: 'skills',
    eligibilityStatus: 'eligible',
    expectedAuthorizationGeneration: 7,
    requiredScope: 'esi-skills.read_skills.v1',
    organizationDeploymentId: null,
    organizationVersion: null,
    targetUserId: null,
    managedMemberLifecycleId: null,
    authoritySectionId: null,
    disclosureVersion: null,
    sectionActivationVersion: null,
    dueReason: 'never-collected',
    schedulingKey: epoch,
    nextEligibleAt: null,
    validatedAt: null,
    lastFailureClass: null,
    ...overrides,
  }
}

const epoch = new Date(0)
