import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ appendAudit: vi.fn() }))

vi.mock('../../src/organization/audit.js', () => ({
  appendOrganizationAuditEvent: mocks.appendAudit,
}))

import {
  appendOrganizationSensitiveAccessDecision,
  organizationSensitiveAccessInputSchema,
} from '../../src/organization/sensitive-access-audit.js'

const actorUserId = '00000000-0000-4000-8000-000000000001'
const targetUserId = '00000000-0000-4000-8000-000000000002'
const occurredAt = new Date('2026-09-18T12:00:00.000Z')

describe('sensitive access audit', () => {
  test('maps one bounded allowed decision to the fixed content-free event', async () => {
    mocks.appendAudit.mockResolvedValue({ auditId: 'audit-1' })
    const transaction = {} as never

    await expect(
      appendOrganizationSensitiveAccessDecision(transaction, {
        actorUserId,
        decision: 'allowed',
        disclosureVersion: 3,
        occurredAt,
        organizationVersion: 7,
        policyVersion: 4,
        reason: 'authorized',
        sectionId: 'wallet',
        targetCharacterId: 90_000_001,
        targetUserId,
      }),
    ).resolves.toStrictEqual({ auditId: 'audit-1' })
    expect(mocks.appendAudit).toHaveBeenCalledWith(transaction, {
      actorId: actorUserId,
      actorType: 'user',
      deploymentId: 1,
      disclosureVersion: 3,
      eventType: 'sensitive-access.decided',
      occurredAt,
      organizationVersion: 7,
      outcome: 'granted',
      policyVersion: 4,
      reason: 'authorized',
      sectionId: 'wallet',
      subjectId: targetUserId,
      subjectType: 'user',
      targetCharacterId: 90_000_001,
      targetUserId,
    })
  })

  test('records unresolved denials without copying untrusted target identities', async () => {
    mocks.appendAudit.mockResolvedValue({ auditId: 'audit-2' })

    await appendOrganizationSensitiveAccessDecision({} as never, {
      actorUserId,
      decision: 'denied',
      disclosureVersion: 2,
      occurredAt,
      organizationVersion: 7,
      policyVersion: 4,
      reason: 'target-not-authorized',
      sectionId: 'mail',
      targetCharacterId: null,
      targetUserId: null,
    })

    expect(mocks.appendAudit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        outcome: 'denied',
        subjectId: '1',
        subjectType: 'deployment',
        targetCharacterId: null,
        targetUserId: null,
      }),
    )
  })

  test.each(['eventType', 'payload', 'evidence', 'query', 'accessToken'])(
    'rejects undeclared %s input',
    (field) => {
      const input = {
        actorUserId,
        targetUserId,
        targetCharacterId: null,
        sectionId: 'skills',
        decision: 'allowed',
        reason: 'authorized',
        organizationVersion: 7,
        policyVersion: 4,
        disclosureVersion: 1,
        occurredAt,
        [field]: 'private-content',
      }
      expect(() => organizationSensitiveAccessInputSchema.parse(input)).toThrow('Unrecognized key')
    },
  )

  test('rejects incoherent decisions and character-only targets', () => {
    expect(() =>
      organizationSensitiveAccessInputSchema.parse({
        actorUserId,
        decision: 'denied',
        disclosureVersion: 1,
        occurredAt,
        organizationVersion: 7,
        policyVersion: 4,
        reason: 'authorized',
        sectionId: 'assets',
        targetCharacterId: null,
        targetUserId,
      }),
    ).toThrow('Sensitive access decision and reason do not match')
    expect(() =>
      organizationSensitiveAccessInputSchema.parse({
        actorUserId,
        decision: 'denied',
        disclosureVersion: 1,
        occurredAt,
        organizationVersion: 7,
        policyVersion: 4,
        reason: 'target-not-authorized',
        sectionId: 'assets',
        targetCharacterId: 90_000_001,
        targetUserId: null,
      }),
    ).toThrow('A character target requires an account target')
    expect(() =>
      organizationSensitiveAccessInputSchema.parse({
        actorUserId,
        decision: 'denied',
        disclosureVersion: 1,
        occurredAt,
        organizationVersion: 7,
        policyVersion: 4,
        reason: 'target-not-authorized',
        sectionId: 'assets',
        targetCharacterId: null,
        targetUserId,
      }),
    ).toThrow('unauthorized target identity')
  })
})
