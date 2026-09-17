import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  appendOrganizationAuditEvent,
  appendOrganizationAuditEvents,
  organizationAuditInputSchema,
} from '../../src/organization/audit.js'

const validAuditEvent = {
  organizationVersion: 1,
  policyVersion: 1,
  eventType: 'compliance.transitioned',
  actorType: 'system',
  actorId: null,
  subjectType: 'compliance',
  subjectId: 'd88b6873-6d42-45b5-96f7-b4ecb9c99032',
  reason: 'Fresh policy evidence changed the compliance state.',
  outcome: 'transitioned',
} as const

describe('organization audit schema', () => {
  beforeEach(() => vi.clearAllMocks())

  test('accepts only the intentional audit contract', () => {
    expect(organizationAuditInputSchema.parse(validAuditEvent)).toMatchObject(validAuditEvent)
  })

  test.each(['accessToken', 'refreshToken', 'sessionBearer', 'rawEsiResponse'])(
    'rejects secret or raw private field %s',
    (field) => {
      expect(() =>
        organizationAuditInputSchema.parse({ ...validAuditEvent, [field]: 'not-allowed' }),
      ).toThrow('Unrecognized key')
    },
  )

  test.each([
    'Authorization: Bearer private-value',
    'refresh_token=private-value',
    'postgres://user:password@private-host/eve_space',
    'TOKEN_ENCRYPTION_KEY=private-value',
  ])('rejects sensitive text in intentional audit fields', (reason) => {
    expect(() => organizationAuditInputSchema.parse({ ...validAuditEvent, reason })).toThrow(
      'Sensitive data is not allowed',
    )
  })

  test('requires identities for human actors and none for system actors', () => {
    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        actorType: 'user',
        actorId: null,
      }),
    ).toThrow('Actor ID is required')
    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        actorId: 'd88b6873-6d42-45b5-96f7-b4ecb9c99032',
      }),
    ).toThrow('System actor has no ID')
  })

  test('requires bounded group assignment context for group audit events', () => {
    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        eventType: 'group.assigned',
        subjectType: 'group',
      }),
    ).toThrow('Group assignment audit context is required')

    expect(
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        eventType: 'group.assigned',
        subjectType: 'group',
        groupId: '108866b8-b2e4-47f8-8310-2c29f574bf3c',
        assignmentId: '51fdf619-118a-4b4a-a089-6a8078f74bc1',
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
        assignmentSource: 'compliance',
        complianceSource: 'core.registration',
        entitlementExpiresAt: null,
      }),
    ).toMatchObject({
      assignmentSource: 'compliance',
      complianceSource: 'core.registration',
    })

    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        eventType: 'group.assigned',
        subjectType: 'group',
        groupId: '108866b8-b2e4-47f8-8310-2c29f574bf3c',
        assignmentId: '51fdf619-118a-4b4a-a089-6a8078f74bc1',
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
        assignmentSource: 'compliance',
      }),
    ).toThrow('Compliance source is required')
    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        eventType: 'group.revoked',
        subjectType: 'group',
        groupId: '108866b8-b2e4-47f8-8310-2c29f574bf3c',
        assignmentId: '51fdf619-118a-4b4a-a089-6a8078f74bc1',
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
        assignmentSource: 'manual',
        complianceSource: 'core.registration',
      }),
    ).toThrow('Manual assignment has no compliance source')
    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        eventType: 'group.assigned',
        subjectType: 'group',
        groupId: '108866b8-b2e4-47f8-8310-2c29f574bf3c',
        assignmentId: '51fdf619-118a-4b4a-a089-6a8078f74bc1',
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
        assignmentSource: 'manual',
        sectionId: 'skills',
      }),
    ).toThrow('Sensitive access context is not allowed')
  })

  test('accepts member block decisions without grant restoration metadata', () => {
    expect(
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        eventType: 'member.unblocked',
        actorType: 'user',
        actorId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        subjectType: 'user',
        reason: 'Review completed against current grants.',
        outcome: 'transitioned',
      }),
    ).toMatchObject({ eventType: 'member.unblocked', outcome: 'transitioned' })
  })

  test('rejects an untrusted identity on unresolved sensitive access', () => {
    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        eventType: 'sensitive-access.decided',
        actorType: 'user',
        actorId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        subjectType: 'user',
        subjectId: '439b0628-0380-4527-96c2-314c6ee0db64',
        reason: 'target-not-authorized',
        outcome: 'denied',
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
        targetCharacterId: null,
        sectionId: 'mail',
        disclosureVersion: 1,
      }),
    ).toThrow('Sensitive access audit context is invalid')
  })

  test('validates bounded sensitive access correlations', () => {
    const sensitiveEvent = {
      ...validAuditEvent,
      eventType: 'sensitive-access.decided',
      actorType: 'user',
      actorId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      subjectType: 'user',
      subjectId: '439b0628-0380-4527-96c2-314c6ee0db64',
      reason: 'authorized',
      outcome: 'granted',
      targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
      targetCharacterId: 90_000_001,
      sectionId: 'assets',
      disclosureVersion: 2,
    } as const

    expect(organizationAuditInputSchema.parse(sensitiveEvent)).toMatchObject(sensitiveEvent)
    expect(
      organizationAuditInputSchema.parse({
        ...sensitiveEvent,
        subjectType: 'deployment',
        subjectId: '1',
        reason: 'reviewer-blocked',
        outcome: 'denied',
        targetUserId: null,
        targetCharacterId: null,
      }),
    ).toMatchObject({ reason: 'reviewer-blocked', outcome: 'denied' })

    for (const invalid of [
      { ...sensitiveEvent, actorType: 'system', actorId: null },
      { ...sensitiveEvent, sectionId: null },
      { ...sensitiveEvent, disclosureVersion: null },
      { ...sensitiveEvent, groupId: '108866b8-b2e4-47f8-8310-2c29f574bf3c' },
      { ...sensitiveEvent, targetUserId: null },
      { ...sensitiveEvent, subjectId: 'deployment' },
      { ...sensitiveEvent, reason: 'reviewer-blocked' },
    ])
      expect(() => organizationAuditInputSchema.parse(invalid)).toThrow(
        'Sensitive access audit context is invalid',
      )
  })

  test('rejects event-specific context on unrelated events', () => {
    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
      }),
    ).toThrow('Event-specific audit context is not allowed')
  })

  test('appends validated events and validates stored rows', async () => {
    const stored = {
      ...validAuditEvent,
      auditId: '35acd527-9539-44ad-aacf-9f8e45232267',
      auditSequence: 1n,
      deploymentId: 1,
      groupId: null,
      assignmentId: null,
      targetUserId: null,
      sectionId: null,
      targetCharacterId: null,
      disclosureVersion: null,
      assignmentSource: null,
      complianceSource: null,
      entitlementExpiresAt: null,
      causationAuditId: null,
      occurredAt: new Date('2026-09-18T12:00:00.000Z'),
    }
    const returning = vi.fn().mockResolvedValue([stored])
    const values = vi.fn(() => ({ returning }))
    const insert = vi.fn(() => ({ values }))
    const transaction = { insert } as never

    await expect(appendOrganizationAuditEvent(transaction, validAuditEvent)).resolves.toEqual(
      stored,
    )
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ deploymentId: 1, eventType: 'compliance.transitioned' }),
    ])
    await expect(appendOrganizationAuditEvents(transaction, [])).resolves.toEqual([])
  })

  test('rejects missing and invalid stored audit rows', async () => {
    const returning = vi.fn().mockResolvedValue([])
    const transaction = {
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning })) })),
    } as never

    await expect(appendOrganizationAuditEvent(transaction, validAuditEvent)).rejects.toThrow(
      'Failed to append organization audit event',
    )

    returning.mockResolvedValue([{ invalid: true }])
    await expect(
      appendOrganizationAuditEvents(transaction, [validAuditEvent]),
    ).rejects.toBeInstanceOf(Error)
  })
})
