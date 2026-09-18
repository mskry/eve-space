import { expect, test } from 'vitest'
import {
  materializeCurrentSnapshotOperation,
  purgeEvidenceOperation,
  writeEvidenceContinuationOperation,
} from '../src/persistence.js'

const validInput = {
  resourceId: 'skill-queue',
  organizationVersion: 4,
  targetUserId: '22222222-2222-4222-8222-222222222222',
  managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
  characterId: 90_000_001,
  characterLifecycleId: '11111111-1111-4111-8111-111111111111',
  authorizationGeneration: 8,
  disclosureVersion: 2,
  sectionActivationVersion: 3,
  observationId: '44444444-4444-4444-8444-444444444444',
  dtoRevision: 1,
  validatedAt: '2026-09-17T10:00:00Z',
  snapshot: { kind: 'skill-queue', entries: [] },
} as const

test('requires every authority revision when persisting sensitive evidence', () => {
  expect(materializeCurrentSnapshotOperation.inputSchema.safeParse(validInput).success).toBe(true)
  const { disclosureVersion: _, ...withoutDisclosureVersion } = validInput
  expect(
    materializeCurrentSnapshotOperation.inputSchema.safeParse(withoutDisclosureVersion).success,
  ).toBe(false)
})

test('rejects oversized and malformed skill evidence', () => {
  expect(
    materializeCurrentSnapshotOperation.inputSchema.safeParse({
      ...validInput,
      snapshot: {
        kind: 'skill-queue',
        entries: Array.from({ length: 10_001 }, (_, queuePosition) => ({
          queuePosition,
          typeId: queuePosition + 1,
          name: 'Skill',
          groupId: null,
          groupName: 'Unknown',
          finishedLevel: 1,
          levelStartSp: null,
          levelEndSp: null,
          trainingStartSp: null,
          startDate: null,
          finishDate: null,
          primaryAttribute: null,
          secondaryAttribute: null,
        })),
      },
    }).success,
  ).toBe(false)
})

test('binds each staged record kind to its continuation resource', () => {
  const continuation = {
    sectionId: 'wallet',
    resourceId: 'wallet-transactions',
    operationContractRevision: 1,
    resourceRevision: 1,
    organizationVersion: 4,
    targetUserId: '22222222-2222-4222-8222-222222222222',
    managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
    characterId: 90_000_001,
    characterLifecycleId: '11111111-1111-4111-8111-111111111111',
    authorizationGeneration: 8,
    disclosureVersion: 2,
    sectionActivationVersion: 3,
    observationId: '44444444-4444-4444-8444-444444444444',
    expectedRevision: 0,
    checkpoint: { complete: true },
    records: [
      {
        recordKind: 'wallet-transaction',
        sourceId: '1',
        sourceTimestamp: '2026-09-17T10:00:00Z',
        evidence: { amount: 1 },
        validatedAt: '2026-09-17T10:00:00Z',
      },
    ],
    updatedAt: '2026-09-17T10:00:00Z',
  } as const

  expect(writeEvidenceContinuationOperation.inputSchema.safeParse(continuation).success).toBe(true)
  expect(
    writeEvidenceContinuationOperation.inputSchema.safeParse({
      ...continuation,
      records: [{ ...continuation.records[0], recordKind: 'wallet-transactions' }],
    }).success,
  ).toBe(false)
})

test('purges an account without narrowing deletion to one organization version', () => {
  expect(
    purgeEvidenceOperation.inputSchema.safeParse({
      mode: 'account',
      store: 'assets',
      targetUserId: '22222222-2222-4222-8222-222222222222',
      limit: 100,
    }).success,
  ).toBe(true)
  expect(
    purgeEvidenceOperation.inputSchema.safeParse({
      mode: 'account',
      store: 'assets',
      organizationVersion: 4,
      targetUserId: '22222222-2222-4222-8222-222222222222',
      limit: 100,
    }).success,
  ).toBe(false)
})
