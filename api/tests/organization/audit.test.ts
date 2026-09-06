import { describe, expect, test } from 'vitest'
import { organizationAuditInputSchema } from '../../src/organization/audit.js'

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
})
