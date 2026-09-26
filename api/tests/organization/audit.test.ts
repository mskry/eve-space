import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  appendOrganizationAuditEvent,
  appendOrganizationAuditEvents,
  organizationAuditInputSchema,
} from '../../src/organization/audit.js'

const validAuditEvent = {
  actorId: null,
  actorType: 'system',
  eventType: 'compliance.transitioned',
  organizationVersion: 1,
  outcome: 'transitioned',
  policyVersion: 1,
  reason: 'Fresh policy evidence changed the compliance state.',
  subjectId: 'd88b6873-6d42-45b5-96f7-b4ecb9c99032',
  subjectType: 'compliance',
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
        actorId: null,
        actorType: 'user',
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
        assignmentId: '51fdf619-118a-4b4a-a089-6a8078f74bc1',
        assignmentSource: 'compliance',
        complianceSource: 'core.registration',
        entitlementExpiresAt: null,
        eventType: 'group.assigned',
        groupId: '108866b8-b2e4-47f8-8310-2c29f574bf3c',
        subjectType: 'group',
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
      }),
    ).toMatchObject({
      assignmentSource: 'compliance',
      complianceSource: 'core.registration',
    })

    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        assignmentId: '51fdf619-118a-4b4a-a089-6a8078f74bc1',
        assignmentSource: 'compliance',
        eventType: 'group.assigned',
        groupId: '108866b8-b2e4-47f8-8310-2c29f574bf3c',
        subjectType: 'group',
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
      }),
    ).toThrow('Compliance source is required')
    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        assignmentId: '51fdf619-118a-4b4a-a089-6a8078f74bc1',
        assignmentSource: 'manual',
        complianceSource: 'core.registration',
        eventType: 'group.revoked',
        groupId: '108866b8-b2e4-47f8-8310-2c29f574bf3c',
        subjectType: 'group',
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
      }),
    ).toThrow('Manual assignment has no compliance source')
    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        assignmentId: '51fdf619-118a-4b4a-a089-6a8078f74bc1',
        assignmentSource: 'manual',
        eventType: 'group.assigned',
        groupId: '108866b8-b2e4-47f8-8310-2c29f574bf3c',
        sectionId: 'skills',
        subjectType: 'group',
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
      }),
    ).toThrow('Sensitive access context is not allowed')
  })

  test('keeps rule decisions attributable without accepting raw role evidence', () => {
    const groupId = '108866b8-b2e4-47f8-8310-2c29f574bf3c'
    const ruleDecision = {
      ...validAuditEvent,
      actorId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      actorType: 'user',
      eventType: 'group-rule.created',
      groupId,
      outcome: 'transitioned',
      resultingPermissions: ['module.read'],
      ruleRevision: 1,
      subjectId: groupId,
      subjectType: 'group',
    } as const
    expect(organizationAuditInputSchema.parse(ruleDecision)).toMatchObject(ruleDecision)
    expect(() =>
      organizationAuditInputSchema.parse({ ...ruleDecision, roles: ['Director'] }),
    ).toThrow('Unrecognized key')
    expect(() =>
      organizationAuditInputSchema.parse({
        ...ruleDecision,
        resultingPermissions: ['refresh_token=secret'],
      }),
    ).toThrow('Sensitive data is not allowed')
    expect(() =>
      organizationAuditInputSchema.parse({ ...ruleDecision, ruleRevision: null }),
    ).toThrow('Invalid rule mutation audit context')

    const assignmentDecision = {
      ...validAuditEvent,
      assignmentId: '51fdf619-118a-4b4a-a089-6a8078f74bc1',
      assignmentSource: 'rule',
      eventType: 'group.assigned',
      groupId,
      outcome: 'granted',
      resultingPermissions: ['module.read'],
      ruleRevision: 1,
      subjectId: groupId,
      subjectType: 'group',
      targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
    } as const
    expect(organizationAuditInputSchema.parse(assignmentDecision)).toMatchObject(assignmentDecision)
    expect(() =>
      organizationAuditInputSchema.parse({ ...assignmentDecision, resultingPermissions: null }),
    ).toThrow('Invalid rule assignment audit context')
  })

  test('accepts member block decisions without grant restoration metadata', () => {
    expect(
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        actorId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        actorType: 'user',
        eventType: 'member.unblocked',
        outcome: 'transitioned',
        reason: 'Review completed against current grants.',
        subjectType: 'user',
      }),
    ).toMatchObject({ eventType: 'member.unblocked', outcome: 'transitioned' })
  })

  test('rejects an untrusted identity on unresolved sensitive access', () => {
    expect(() =>
      organizationAuditInputSchema.parse({
        ...validAuditEvent,
        actorId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        actorType: 'user',
        disclosureVersion: 1,
        eventType: 'sensitive-access.decided',
        outcome: 'denied',
        reason: 'target-not-authorized',
        sectionId: 'mail',
        subjectId: '439b0628-0380-4527-96c2-314c6ee0db64',
        subjectType: 'user',
        targetCharacterId: null,
        targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
      }),
    ).toThrow('Sensitive access audit context is invalid')
  })

  test('validates bounded sensitive access correlations', () => {
    const sensitiveEvent = {
      ...validAuditEvent,
      actorId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      actorType: 'user',
      disclosureVersion: 2,
      eventType: 'sensitive-access.decided',
      outcome: 'granted',
      reason: 'authorized',
      sectionId: 'assets',
      subjectId: '439b0628-0380-4527-96c2-314c6ee0db64',
      subjectType: 'user',
      targetCharacterId: 90_000_001,
      targetUserId: '439b0628-0380-4527-96c2-314c6ee0db64',
    } as const

    expect(organizationAuditInputSchema.parse(sensitiveEvent)).toMatchObject(sensitiveEvent)
    expect(
      organizationAuditInputSchema.parse({
        ...sensitiveEvent,
        outcome: 'denied',
        reason: 'reviewer-blocked',
        subjectId: '1',
        subjectType: 'deployment',
        targetCharacterId: null,
        targetUserId: null,
      }),
    ).toMatchObject({ outcome: 'denied', reason: 'reviewer-blocked' })

    for (const invalid of [
      { ...sensitiveEvent, actorId: null, actorType: 'system' },
      { ...sensitiveEvent, sectionId: null },
      { ...sensitiveEvent, disclosureVersion: null },
      { ...sensitiveEvent, groupId: '108866b8-b2e4-47f8-8310-2c29f574bf3c' },
      { ...sensitiveEvent, targetUserId: null },
      { ...sensitiveEvent, subjectId: 'deployment' },
      { ...sensitiveEvent, reason: 'reviewer-blocked' },
    ]) {
      expect(() => organizationAuditInputSchema.parse(invalid)).toThrow(
        'Sensitive access audit context is invalid',
      )
    }
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
      assignmentId: null,
      assignmentSource: null,
      auditId: '35acd527-9539-44ad-aacf-9f8e45232267',
      auditSequence: 1n,
      causationAuditId: null,
      complianceSource: null,
      deploymentId: 1,
      disclosureVersion: null,
      entitlementExpiresAt: null,
      groupId: null,
      occurredAt: new Date('2026-09-18T12:00:00.000Z'),
      resultingPermissions: null,
      ruleRevision: null,
      sectionId: null,
      targetCharacterId: null,
      targetUserId: null,
    }
    const returning = vi.fn().mockResolvedValue([stored])
    const values = vi.fn(() => ({ returning }))
    const insert = vi.fn(() => ({ values }))
    const transaction = { insert } as never

    await expect(appendOrganizationAuditEvent(transaction, validAuditEvent)).resolves.toStrictEqual(
      stored,
    )
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ deploymentId: 1, eventType: 'compliance.transitioned' }),
    ])
    await expect(appendOrganizationAuditEvents(transaction, [])).resolves.toStrictEqual([])
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
