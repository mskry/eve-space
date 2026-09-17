import { expect, test } from 'vitest'
import { writeSkillSnapshotOperation } from '../src/persistence.js'

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
  dtoRevision: 1,
  validatedAt: '2026-09-17T10:00:00Z',
  snapshot: { kind: 'skill-queue', entries: [] },
} as const

test('requires every authority revision when persisting sensitive evidence', () => {
  expect(writeSkillSnapshotOperation.inputSchema.safeParse(validInput).success).toBe(true)
  const { disclosureVersion: _, ...withoutDisclosureVersion } = validInput
  expect(writeSkillSnapshotOperation.inputSchema.safeParse(withoutDisclosureVersion).success).toBe(
    false,
  )
})

test('rejects oversized and malformed skill evidence', () => {
  expect(
    writeSkillSnapshotOperation.inputSchema.safeParse({
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
