import { describe, expect, it } from 'vitest'
import { inventoryAccessAuditSchema } from '../../src/organization/inventory-access-audit.js'

const decision = {
  actorUserId: '11111111-1111-4111-8111-111111111111',
  organizationVersion: 1,
  policyVersion: 1,
  corporationId: 98,
  accessKind: 'aggregate',
  decision: 'allowed',
  reason: 'authorized',
  disclosureRevision: 1,
  sectionActivationRevision: 2,
  subjects: [],
}

describe('content-free inventory audit input', () => {
  it.each(['quantities', 'query', 'cursor', 'tokens', 'filters', 'assetRows'])(
    'rejects %s rather than stripping or storing it',
    (field) => {
      expect(
        inventoryAccessAuditSchema.safeParse({ ...decision, [field]: 'private' }).success,
      ).toBe(false)
    },
  )

  it('rejects identity enrichment of denied requests and oversized target batches', () => {
    expect(
      inventoryAccessAuditSchema.safeParse({
        ...decision,
        decision: 'denied',
        reason: 'scope-denied',
      }).success,
    ).toBe(false)
    expect(
      inventoryAccessAuditSchema.safeParse({
        ...decision,
        decision: 'denied',
        reason: 'scope-denied',
        corporationId: null,
      }).success,
    ).toBe(true)
    expect(
      inventoryAccessAuditSchema.safeParse({
        ...decision,
        subjects: Array.from({ length: 251 }, () => ({})),
      }).success,
    ).toBe(false)
  })
})
