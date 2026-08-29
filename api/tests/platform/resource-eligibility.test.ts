import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import {
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
    })
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
      })
    },
  )
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
    dueReason: 'never-collected',
    schedulingKey: epoch,
    nextEligibleAt: null,
    validatedAt: null,
    lastFailureClass: null,
    ...overrides,
  }
}

const epoch = new Date(0)
