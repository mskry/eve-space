import { expect, test } from 'vitest'
import {
  materializeCurrentSnapshotOperation,
  purgeEvidenceOperation,
  writeEvidenceContinuationOperation,
} from '../src/persistence.js'

const validInput = {
  authorizationGeneration: 8,
  characterId: 90_000_001,
  characterLifecycleId: '11111111-1111-4111-8111-111111111111',
  disclosureVersion: 2,
  dtoRevision: 1,
  managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
  observationId: '44444444-4444-4444-8444-444444444444',
  organizationVersion: 4,
  resourceId: 'trained-skills',
  sectionActivationVersion: 3,
  snapshot: {
    groups: [],
    injectedSkillCount: 0,
    kind: 'trained-skills',
    totalSp: 0,
    unallocatedSp: 0,
  },
  targetUserId: '22222222-2222-4222-8222-222222222222',
  validatedAt: '2026-09-17T10:00:00Z',
} as const

test('requires every authority revision when persisting sensitive evidence', () => {
  expect(materializeCurrentSnapshotOperation.inputSchema.safeParse(validInput).success).toBe(true)
  const { disclosureVersion: _, ...withoutDisclosureVersion } = validInput
  expect(
    materializeCurrentSnapshotOperation.inputSchema.safeParse(withoutDisclosureVersion).success,
  ).toBe(false)
})

test('rejects oversized and malformed trained-skill evidence', () => {
  expect(
    materializeCurrentSnapshotOperation.inputSchema.safeParse({
      ...validInput,
      snapshot: {
        groups: [
          {
            groupId: 1,
            name: 'Skills',
            trainedSp: 0,
            skills: Array.from({ length: 10_001 }, (_, index) => ({
              typeId: index + 1,
              name: 'Skill',
              injected: true,
              activeLevel: 0,
              trainedLevel: 0,
              skillpoints: 0,
              rank: null,
              primaryAttribute: null,
              secondaryAttribute: null,
            })),
          },
        ],
        injectedSkillCount: 10_001,
        kind: 'trained-skills',
        totalSp: 0,
        unallocatedSp: 0,
      },
    }).success,
  ).toBe(false)
})

test('binds each staged record kind to its continuation resource', () => {
  const continuation = {
    authorizationGeneration: 8,
    characterId: 90_000_001,
    characterLifecycleId: '11111111-1111-4111-8111-111111111111',
    checkpoint: { complete: true },
    disclosureVersion: 2,
    expectedRevision: 0,
    managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
    observationId: '44444444-4444-4444-8444-444444444444',
    operationContractRevision: 1,
    organizationVersion: 4,
    records: [
      {
        recordKind: 'wallet-transaction',
        sourceId: '1',
        sourceTimestamp: '2026-09-17T10:00:00Z',
        evidence: { amount: 1 },
        validatedAt: '2026-09-17T10:00:00Z',
      },
    ],
    resourceId: 'wallet-transactions',
    resourceRevision: 1,
    sectionActivationVersion: 3,
    sectionId: 'wallet',
    targetUserId: '22222222-2222-4222-8222-222222222222',
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

test('accepts one complete finance page but rejects a larger staging write', () => {
  const record = {
    evidence: { amount: 1 },
    recordKind: 'wallet-journal',
    sourceId: '1',
    sourceTimestamp: '2026-09-17T10:00:00Z',
    validatedAt: '2026-09-17T10:00:00Z',
  } as const
  const input = {
    authorizationGeneration: 8,
    characterId: 90_000_001,
    characterLifecycleId: '11111111-1111-4111-8111-111111111111',
    checkpoint: { complete: true },
    disclosureVersion: 2,
    expectedRevision: 0,
    managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
    observationId: '44444444-4444-4444-8444-444444444444',
    operationContractRevision: 1,
    organizationVersion: 4,
    resourceId: 'wallet-journal',
    resourceRevision: 1,
    sectionActivationVersion: 3,
    sectionId: 'wallet',
    targetUserId: '22222222-2222-4222-8222-222222222222',
    updatedAt: '2026-09-17T10:00:00Z',
  } as const

  expect(
    writeEvidenceContinuationOperation.inputSchema.safeParse({
      ...input,
      records: Array.from({ length: 2500 }, (_, index) => ({
        ...record,
        sourceId: String(index + 1),
      })),
    }).success,
  ).toBe(true)
  expect(
    writeEvidenceContinuationOperation.inputSchema.safeParse({
      ...input,
      records: Array.from({ length: 2501 }, (_, index) => ({
        ...record,
        sourceId: String(index + 1),
      })),
    }).success,
  ).toBe(false)
})

test('purges an account without narrowing deletion to one organization version', () => {
  expect(
    purgeEvidenceOperation.inputSchema.safeParse({
      limit: 100,
      mode: 'account',
      store: 'assets',
      targetUserId: '22222222-2222-4222-8222-222222222222',
    }).success,
  ).toBe(true)
  expect(
    purgeEvidenceOperation.inputSchema.safeParse({
      limit: 100,
      mode: 'account',
      organizationVersion: 4,
      store: 'assets',
      targetUserId: '22222222-2222-4222-8222-222222222222',
    }).success,
  ).toBe(false)
})
