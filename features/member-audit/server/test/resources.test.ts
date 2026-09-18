import { describe, expect, test, vi } from 'vitest'
import {
  assetsResource,
  mailDetailsResource,
  mailHeadersResource,
  skillQueueResource,
  trainedSkillsResource,
  walletBalanceResource,
  walletJournalResource,
  walletTransactionsResource,
} from '../src/resources.js'

const subject = {
  kind: 'character' as const,
  characterId: 90_000_001,
  lifecycleId: '11111111-1111-4111-8111-111111111111',
}
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
    const materializeCurrentSnapshot = vi.fn().mockResolvedValue({ outcome: 'applied' })
    const context = {
      subject,
      data: {
        kind: 'skill-queue' as const,
        entries: [],
      },
      validatedAt: '2026-09-17T10:00:00Z',
      authorizationGeneration: 8,
      organizationVersion: 4,
      managedAuthority: {
        organizationDeploymentId: 1 as const,
        organizationVersion: 4,
        targetUserId: '22222222-2222-4222-8222-222222222222',
        managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
        sectionId: 'skills',
        disclosureVersion: 2,
        sectionActivationVersion: 3,
      },
      capabilities: {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        persistence: { materializeCurrentSnapshot },
      },
    }

    await skillQueueResource.materialize(context as never)
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

    await skillQueueResource.materialize({
      ...context,
      organizationVersion: 5,
    } as never)
    expect(materializeCurrentSnapshot).toHaveBeenCalledOnce()

    materializeCurrentSnapshot.mockResolvedValueOnce({ outcome: 'obsolete' })
    await expect(
      trainedSkillsResource.materialize({
        ...context,
        data: {
          kind: 'trained-skills',
          totalSp: 0,
          unallocatedSp: 0,
          injectedSkillCount: 0,
          groups: [],
        },
      } as never),
    ).resolves.toEqual({ outcome: 'obsolete' })
  })

  test('purges expired and invalid-authority evidence in bounded batches', async () => {
    const purgeEvidence = vi.fn().mockResolvedValue({ deleted: 0, remaining: false })
    const invalidAuthority = {
      organizationVersion: 4,
      targetUserId: '22222222-2222-4222-8222-222222222222',
      managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
      characterId: subject.characterId,
      characterLifecycleId: subject.lifecycleId,
      authorizationGeneration: 8,
      disclosureVersion: 2,
      sectionActivationVersion: 3,
    }
    const context = {
      now: '2026-09-18T10:00:00.000Z',
      purgeAccountIds: [],
      invalidAuthorities: [invalidAuthority],
      purgeRetention: true,
      capabilities: {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        persistence: { purgeEvidence },
      },
    }

    await trainedSkillsResource.maintain(context as never)

    expect(purgeEvidence).toHaveBeenCalledTimes(10)
    expect(purgeEvidence).toHaveBeenCalledWith({
      mode: 'retention',
      store: 'legacy-skills',
      cutoff: '2026-06-20T10:00:00.000Z',
      limit: 1_000,
    })
    expect(purgeEvidence).toHaveBeenCalledWith({
      mode: 'retention',
      store: 'continuations',
      cutoff: '2026-09-17T10:00:00.000Z',
      limit: 1_000,
    })
    expect(purgeEvidence).toHaveBeenCalledWith({
      mode: 'authority',
      store: 'trained-skills',
      ...invalidAuthority,
      limit: 1_000,
    })
    expect(purgeEvidence).toHaveBeenCalledWith({
      mode: 'authority',
      store: 'legacy-skills',
      ...invalidAuthority,
      limit: 1_000,
    })

    purgeEvidence.mockClear()
    await walletBalanceResource.maintain(context as never)
    expect(purgeEvidence).toHaveBeenCalledOnce()
    expect(purgeEvidence).toHaveBeenCalledWith({
      mode: 'authority',
      store: 'wallet-balance',
      ...invalidAuthority,
      limit: 1_000,
    })

    purgeEvidence.mockClear()
    await trainedSkillsResource.maintain({
      ...context,
      purgeAccountIds: [invalidAuthority.targetUserId],
      invalidAuthorities: [],
      purgeRetention: false,
    } as never)
    expect(purgeEvidence).toHaveBeenCalledTimes(2)
    expect(purgeEvidence).toHaveBeenCalledWith({
      mode: 'account',
      store: 'trained-skills',
      targetUserId: invalidAuthority.targetUserId,
      limit: 1_000,
    })
    expect(purgeEvidence).toHaveBeenCalledWith({
      mode: 'account',
      store: 'legacy-skills',
      targetUserId: invalidAuthority.targetUserId,
      limit: 1_000,
    })
  })
})

describe('member-audit evidence resources', () => {
  const directlyCollectedResources = [
    assetsResource,
    walletBalanceResource,
    walletJournalResource,
    walletTransactionsResource,
    mailHeadersResource,
  ] as const
  const evidenceResources = [...directlyCollectedResources, mailDetailsResource] as const

  test('binds direct collection requests to the exact character', () => {
    for (const resource of directlyCollectedResources)
      expect(resource.request(subject)).toEqual({ path: { character_id: subject.characterId } })

    expect(() => mailDetailsResource.request()).toThrow(
      'Mail detail collection requires a continuation checkpoint',
    )
  })

  test('passes staged evidence through until persistence promotion is implemented', async () => {
    const data = { sourceId: 'evidence-1' }

    for (const resource of evidenceResources) {
      expect(resource.map({ data } as never)).toBe(data)
      await expect(resource.materialize()).resolves.toEqual({ outcome: 'obsolete' })
    }
  })

  test('runs maintenance for every evidence store', async () => {
    const purgeEvidence = vi.fn()
    const context = {
      now: '2026-09-18T10:00:00.000Z',
      purgeAccountIds: [],
      invalidAuthorities: [],
      purgeRetention: false,
      capabilities: {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        persistence: { purgeEvidence },
      },
    }

    for (const resource of [...evidenceResources, skillQueueResource])
      await resource.maintain(context as never)

    expect(purgeEvidence).not.toHaveBeenCalled()
  })
})
