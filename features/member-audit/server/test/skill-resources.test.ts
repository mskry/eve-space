import { describe, expect, test, vi } from 'vitest'
import type {
  CurrentSnapshotPersistence,
  EvidenceMaintenancePersistence,
} from '../src/persistence.js'
import { skillQueueResource, trainedSkillsResource } from '../src/skill-resources.js'
import { maintenanceContext, materializationContext, subject } from './resource-test-fixtures.js'

const catalogue = {
  rows: [
    {
      typeId: 34,
      typeName: 'Spaceship Command',
      groupId: 257,
      groupName: 'Spaceship Command',
      rank: 1,
      primaryAttribute: 'perception' as const,
      secondaryAttribute: 'willpower' as const,
    },
  ],
  revision: { buildNumber: 1, ingestVersion: 1, ingestedAt: '2026-09-17T10:00:00Z' },
  complete: true as const,
}

describe('member-audit skill resources', () => {
  test('binds both resource requests to the exact character', () => {
    expect(trainedSkillsResource.request(subject)).toEqual({
      path: { character_id: subject.characterId },
    })
    expect(skillQueueResource.request(subject)).toEqual({
      path: { character_id: subject.characterId },
    })
  })

  test('projects trained skills with the published skill catalogue', async () => {
    const publishedSkillCatalogue = vi.fn().mockResolvedValue(catalogue)
    const result = await trainedSkillsResource.map({
      subject,
      data: {
        total_sp: 1_000,
        skills: [
          {
            skill_id: 34,
            active_skill_level: 3,
            trained_skill_level: 4,
            skillpoints_in_skill: 1_000,
          },
        ],
      },
      capabilities: { coreData: { publishedSkillCatalogue } },
    })

    expect(result).toMatchObject({
      kind: 'trained-skills',
      totalSp: 1_000,
      injectedSkillCount: 1,
      groups: [{ name: 'Spaceship Command', skills: [{ name: 'Spaceship Command', rank: 1 }] }],
    })
    expect(publishedSkillCatalogue).toHaveBeenCalledOnce()
  })

  test('projects ordered queue entries and deterministic unknown labels', async () => {
    const result = await skillQueueResource.map({
      subject,
      data: [
        { queue_position: 2, skill_id: 99, finished_level: 2 },
        { queue_position: 1, skill_id: 34, finished_level: 5 },
      ],
      capabilities: {
        coreData: { publishedSkillCatalogue: vi.fn().mockResolvedValue(catalogue) },
      },
    })

    expect(result.entries.map(({ typeId, name }) => ({ typeId, name }))).toEqual([
      { typeId: 34, name: 'Spaceship Command' },
      { typeId: 99, name: 'Unknown skill 99' },
    ])
  })

  test('persists snapshots only with the exact managed authority binding', async () => {
    const materializeCurrentSnapshot = vi.fn().mockResolvedValue({ outcome: 'applied' as const })
    const persistence: CurrentSnapshotPersistence = { materializeCurrentSnapshot }
    const context = materializationContext(
      { kind: 'skill-queue' as const, entries: [] },
      persistence,
    )

    await skillQueueResource.materialize(context)
    expect(materializeCurrentSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationVersion: 4,
        targetUserId: '22222222-2222-4222-8222-222222222222',
        managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
        characterLifecycleId: subject.lifecycleId,
        authorizationGeneration: 8,
        disclosureVersion: 2,
        sectionActivationVersion: 3,
      }),
    )

    await skillQueueResource.materialize({ ...context, organizationVersion: 5 })
    expect(materializeCurrentSnapshot).toHaveBeenCalledOnce()

    materializeCurrentSnapshot.mockResolvedValueOnce({ outcome: 'obsolete' })
    await expect(
      trainedSkillsResource.materialize(
        materializationContext(
          {
            kind: 'trained-skills' as const,
            totalSp: 0,
            unallocatedSp: 0,
            injectedSkillCount: 0,
            groups: [],
          },
          persistence,
        ),
      ),
    ).resolves.toEqual({ outcome: 'obsolete' })
  })

  test('retains skill-queue maintenance without a purge when no work is planned', async () => {
    const purgeEvidence = vi.fn()
    const persistence: EvidenceMaintenancePersistence = { purgeEvidence }

    await skillQueueResource.maintain?.(maintenanceContext(persistence))

    expect(purgeEvidence).not.toHaveBeenCalled()
  })
})
