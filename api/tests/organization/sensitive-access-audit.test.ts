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
        targetUserId,
        targetCharacterId: 90_000_001,
        sectionId: 'wallet',
        decision: 'allowed',
        reason: 'authorized',
        organizationVersion: 7,
        policyVersion: 4,
        disclosureVersion: 3,
        occurredAt,
      }),
    ).resolves.toEqual({ auditId: 'audit-1' })
    expect(mocks.appendAudit).toHaveBeenCalledWith(transaction, {
      deploymentId: 1,
      organizationVersion: 7,
      policyVersion: 4,
      eventType: 'sensitive-access.decided',
      actorType: 'user',
      actorId: actorUserId,
      subjectType: 'user',
      subjectId: targetUserId,
      reason: 'authorized',
      outcome: 'granted',
      targetUserId,
      sectionId: 'wallet',
      targetCharacterId: 90_000_001,
      disclosureVersion: 3,
      occurredAt,
    })
  })

  test('records unresolved denials without copying untrusted target identities', async () => {
    mocks.appendAudit.mockResolvedValue({ auditId: 'audit-2' })

    await appendOrganizationSensitiveAccessDecision({} as never, {
      actorUserId,
      targetUserId: null,
      targetCharacterId: null,
      sectionId: 'mail',
      decision: 'denied',
      reason: 'target-not-authorized',
      organizationVersion: 7,
      policyVersion: 4,
      disclosureVersion: 2,
      occurredAt,
    })

    expect(mocks.appendAudit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        subjectType: 'deployment',
        subjectId: '1',
        targetUserId: null,
        targetCharacterId: null,
        outcome: 'denied',
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
        targetUserId,
        targetCharacterId: null,
        sectionId: 'assets',
        decision: 'denied',
        reason: 'authorized',
        organizationVersion: 7,
        policyVersion: 4,
        disclosureVersion: 1,
        occurredAt,
      }),
    ).toThrow('Sensitive access decision and reason do not match')
    expect(() =>
      organizationSensitiveAccessInputSchema.parse({
        actorUserId,
        targetUserId: null,
        targetCharacterId: 90_000_001,
        sectionId: 'assets',
        decision: 'denied',
        reason: 'target-not-authorized',
        organizationVersion: 7,
        policyVersion: 4,
        disclosureVersion: 1,
        occurredAt,
      }),
    ).toThrow('A character target requires an account target')
    expect(() =>
      organizationSensitiveAccessInputSchema.parse({
        actorUserId,
        targetUserId,
        targetCharacterId: null,
        sectionId: 'assets',
        decision: 'denied',
        reason: 'target-not-authorized',
        organizationVersion: 7,
        policyVersion: 4,
        disclosureVersion: 1,
        occurredAt,
      }),
    ).toThrow('unauthorized target identity')
  })
})
