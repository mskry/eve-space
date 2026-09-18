import { describe, expect, test, vi } from 'vitest'
import { assetsResource } from '../src/asset-resource.js'
import {
  materializeEvidenceObservation,
  type EvidenceObservation,
} from '../src/evidence-collection.js'
import { mailDetailsResource, mailHeadersResource } from '../src/mail-resources.js'
import type {
  CurrentSnapshotPersistence,
  EvidenceMaintenancePersistence,
  EvidenceMaterializationPersistence,
} from '../src/persistence.js'
import {
  walletBalanceResource,
  walletJournalResource,
  walletTransactionsResource,
} from '../src/wallet-resources.js'
import { maintenanceContext, materializationContext, subject } from './resource-test-fixtures.js'

const authority = {
  organizationDeploymentId: 1 as const,
  organizationVersion: 4,
  targetUserId: '22222222-2222-4222-8222-222222222222',
  managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
  sectionId: 'assets',
  disclosureVersion: 2,
  sectionActivationVersion: 3,
}
const emptyRevision = {
  buildNumber: 1,
  ingestVersion: 1,
  ingestedAt: '2026-09-17T10:00:00Z',
}

describe('member-audit evidence resources', () => {
  test('binds root collection requests to the exact character', () => {
    expect(assetsResource.request(subject)).toEqual({
      path: { character_id: subject.characterId },
      query: { page: 1 },
    })
    expect(walletBalanceResource.request(subject)).toEqual({
      path: { character_id: subject.characterId },
    })
    expect(walletJournalResource.request(subject)).toEqual({
      path: { character_id: subject.characterId },
      query: { page: 1 },
    })
    expect(walletTransactionsResource.request(subject)).toEqual({
      path: { character_id: subject.characterId },
    })
    expect(mailHeadersResource.request(subject)).toEqual({
      path: { character_id: subject.characterId },
    })
    expect(mailDetailsResource.request(subject)).toEqual({
      path: { character_id: subject.characterId },
    })
  })

  test('stages each asset page atomically before advancing its continuation', async () => {
    const pages = [Array.from({ length: 501 }, (_, index) => asset(index + 1)), [asset(502)]]
    const execute = vi.fn(async (_operationId: string, inputs: { query: { page: number } }) => ({
      data: pages[inputs.query.page - 1],
      validatedAt: '2026-09-17T10:00:00Z',
      pagination: { pages: 2 },
    }))
    const first = await assetsResource.collect!(collectionContext({ execute }))
    expect(first).toMatchObject({
      complete: false,
      data: { expectedRevision: 0, checkpoint: { page: 2 }, records: { length: 501 } },
    })

    const second = await assetsResource.collect!(
      collectionContext({
        execute,
        continuation: {
          observationId: first.data.observationId,
          revision: 1,
          checkpoint: first.data.checkpoint,
        },
      }),
    )
    expect(second).toMatchObject({
      complete: true,
      data: { expectedRevision: 1, checkpoint: { complete: true }, records: { length: 1 } },
    })
    expect(execute).toHaveBeenNthCalledWith(1, 'character-assets-page', {
      path: { character_id: subject.characterId },
      query: { page: 1 },
    })
    expect(execute).toHaveBeenNthCalledWith(2, 'character-assets-page', {
      path: { character_id: subject.characterId },
      query: { page: 2 },
    })
  })

  test('uses X-Pages for an exact-full final asset page and enforces the readable bound', async () => {
    const fullPage = Array.from({ length: 1_000 }, (_, index) => asset(index + 1))
    const collected = await assetsResource.collect!(
      collectionContext({
        execute: vi.fn().mockResolvedValue({
          data: fullPage,
          validatedAt: '2026-09-17T10:00:00Z',
          pagination: { pages: 1 },
        }),
      }),
    )
    expect(collected).toMatchObject({
      complete: true,
      data: { checkpoint: { complete: true, page: 1 }, records: { length: 1_000 } },
    })

    await expect(
      assetsResource.collect!(
        collectionContext({
          execute: vi.fn().mockResolvedValue({
            data: [],
            validatedAt: '2026-09-17T10:00:00Z',
            pagination: { pages: 11 },
          }),
        }),
      ),
    ).rejects.toThrow('exceeded the reviewed page bound')
  })

  test('does not submit unsupported asset locations to PostUniverseNames', async () => {
    const execute = vi.fn(async (operationId: string) => {
      if (operationId !== 'character-assets-page')
        throw new Error(`Unexpected operation ${operationId}`)
      return {
        data: [{ ...asset(1), location_id: 1_000_000_000_001, location_type: 'other' }],
        validatedAt: '2026-09-17T10:00:00Z',
        pagination: { pages: 1 },
      }
    })

    await expect(assetsResource.collect!(collectionContext({ execute }))).resolves.toMatchObject({
      complete: true,
      data: { records: { length: 1 } },
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  test('promotes a complete empty asset observation atomically', async () => {
    const collected = await assetsResource.collect!(collectionContext())
    expect(collected).toMatchObject({
      complete: true,
      data: { checkpoint: { complete: true }, records: [] },
    })

    const writeEvidenceContinuation = vi
      .fn()
      .mockResolvedValue({ outcome: 'applied' as const, revision: 1 })
    const promoteEvidenceObservation = vi.fn().mockResolvedValue({ outcome: 'applied' as const })
    const persistence: EvidenceMaterializationPersistence = {
      writeEvidenceContinuation,
      promoteEvidenceObservation,
    }
    await assetsResource.materialize(
      evidenceMaterializationContext(collected.data, persistence, 'assets'),
    )

    expect(writeEvidenceContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        records: [],
        checkpoint: expect.objectContaining({ complete: true }),
      }),
    )
    expect(promoteEvidenceObservation).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 1, resourceId: 'assets' }),
    )
  })

  test('atomically promotes every continued wallet and mail evidence kind', async () => {
    const observations: EvidenceObservation[] = [
      evidenceObservation('wallet', 'wallet-journal', 'wallet-journal'),
      evidenceObservation('wallet', 'wallet-transactions', 'wallet-transaction'),
      evidenceObservation('mail', 'mail-headers', 'mail-header'),
      evidenceObservation('mail', 'mail-details', 'mail-content'),
    ]

    for (const observation of observations) {
      const writeEvidenceContinuation = vi
        .fn()
        .mockResolvedValue({ outcome: 'applied' as const, revision: 1 })
      const promoteEvidenceObservation = vi.fn().mockResolvedValue({ outcome: 'applied' as const })
      const persistence: EvidenceMaterializationPersistence = {
        writeEvidenceContinuation,
        promoteEvidenceObservation,
      }

      await materializeEvidenceObservation(
        evidenceMaterializationContext(observation, persistence, observation.sectionId),
      )

      expect(writeEvidenceContinuation).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionId: observation.sectionId,
          resourceId: observation.resourceId,
          records: [
            expect.objectContaining({ evidence: { label: 'record', identifiers: ['one', 'two'] } }),
          ],
        }),
      )
      expect(promoteEvidenceObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionId: observation.sectionId,
          resourceId: observation.resourceId,
          expectedRevision: 1,
        }),
      )
    }
  })

  test('projects wallet balance and bounded journal evidence', async () => {
    expect(
      walletBalanceResource.map({ subject, data: 42.5, capabilities: { coreData: {} } }),
    ).toEqual({ kind: 'wallet-balance', balance: 42.5 })

    const journal = await walletJournalResource.collect!(
      collectionContext({
        sectionId: 'wallet',
        execute: vi.fn().mockResolvedValue({
          data: [
            {
              id: 7,
              date: '2026-09-17T09:00:00Z',
              amount: 5,
              ref_type: 'player_donation',
              description: 'Donation',
              context_id: 99,
              context_id_type: 'unsafe_type',
            },
          ],
          validatedAt: '2026-09-17T10:00:00Z',
          pagination: { pages: 1 },
        }),
      }),
    )
    expect(journal).toMatchObject({
      complete: true,
      data: {
        records: [
          {
            sourceId: '7',
            evidence: { journalId: 7, contextId: null, contextType: null },
          },
        ],
      },
    })
  })

  test('uses X-Pages for an exact-full final wallet journal page', async () => {
    const data = Array.from({ length: 2_500 }, (_, index) => ({
      id: index + 1,
      date: '2026-09-17T09:00:00Z',
      ref_type: 'player_donation',
      description: 'Donation',
    }))
    const result = await walletJournalResource.collect!(
      collectionContext({
        sectionId: 'wallet',
        execute: vi.fn().mockResolvedValue({
          data,
          validatedAt: '2026-09-17T10:00:00Z',
          pagination: { pages: 1 },
        }),
      }),
    )
    expect(result).toMatchObject({
      complete: true,
      data: { checkpoint: { complete: true, page: 1 }, records: { length: 2_500 } },
    })
  })

  test('advances the opaque transaction cursor only after the full page is staged', async () => {
    const data = Array.from({ length: 2_500 }, (_, index) => ({
      transaction_id: 10_000 - index,
      journal_ref_id: 20_000 + index,
      date: '2026-09-17T09:00:00Z',
      type_id: 34,
      quantity: 1,
      unit_price: 2,
      is_buy: true,
      is_personal: true,
      location_id: 60_000_001,
    }))
    const result = await walletTransactionsResource.collect!(
      collectionContext({
        sectionId: 'wallet',
        continuation: {
          observationId: '44444444-4444-4444-8444-444444444444',
          revision: 4,
          checkpoint: { complete: false, fromId: null },
        },
        execute: vi.fn().mockResolvedValue({
          data,
          validatedAt: '2026-09-17T10:00:00Z',
        }),
      }),
    )
    expect(result).toMatchObject({
      complete: false,
      data: {
        expectedRevision: 4,
        checkpoint: { complete: false, fromId: 7_501 },
        records: { length: 2_500 },
      },
    })
  })

  test('keeps valid-but-unresolvable mail parties as unknown names', async () => {
    const execute = vi.fn(async (operationId: string) => {
      if (operationId === 'mail-headers')
        return {
          data: [
            {
              mail_id: 9,
              from: 90_666_561,
              timestamp: '2026-09-17T09:00:00Z',
            },
          ],
          validatedAt: '2026-09-17T10:00:00Z',
        }
      throw Object.assign(new Error('Ensure all IDs are valid before resolving'), { status: 404 })
    })
    const result = await mailHeadersResource.collect!(
      collectionContext({ sectionId: 'mail', execute }),
    )

    expect(result.data.records[0]?.evidence).toMatchObject({
      senderId: 90_666_561,
      senderName: null,
    })
  })

  test('resolves mail parties and sanitizes detail content', async () => {
    const header = {
      mail_id: 9,
      from: 90_000_002,
      recipients: [{ recipient_id: 55, recipient_type: 'mailing_list' }],
      subject: 'Subject',
      timestamp: '2026-09-17T09:00:00Z',
    }
    const headerExecute = vi.fn(async (operationId: string) => {
      if (operationId === 'mail-headers')
        return { data: [header], validatedAt: '2026-09-17T10:00:00Z' }
      if (operationId === 'universe-resolve-names')
        return {
          data: [{ id: 90_000_002, name: 'Sender', category: 'character' }],
          validatedAt: '2026-09-17T10:00:00Z',
        }
      return {
        data: [{ mailing_list_id: 55, name: 'List' }],
        validatedAt: '2026-09-17T10:00:00Z',
      }
    })
    const headers = await mailHeadersResource.collect!(
      collectionContext({ sectionId: 'mail', execute: headerExecute }),
    )
    expect(headers.data.records[0]?.evidence).toMatchObject({
      senderName: 'Sender',
      recipientNames: ['List'],
      body: null,
    })

    const detailExecute = vi.fn(async (operationId: string) => {
      if (operationId === 'mail-headers')
        return { data: [header], validatedAt: '2026-09-17T10:00:00Z' }
      if (operationId === 'mail-message')
        return {
          data: { ...header, body: '<p>Hello <b>pilot</b></p>', read: true },
          validatedAt: '2026-09-17T10:00:01Z',
        }
      if (operationId === 'universe-resolve-names')
        return {
          data: [{ id: 90_000_002, name: 'Sender', category: 'character' }],
          validatedAt: '2026-09-17T10:00:00Z',
        }
      return {
        data: [{ mailing_list_id: 55, name: 'List' }],
        validatedAt: '2026-09-17T10:00:00Z',
      }
    })
    const details = await mailDetailsResource.collect!(
      collectionContext({ sectionId: 'mail', execute: detailExecute }),
    )
    expect(details).toMatchObject({
      complete: true,
      data: { records: [{ sourceId: '9', evidence: { body: 'Hello pilot' } }] },
    })
  })

  test('continues bounded mail detail fan-out with the returned mail ID cursor', async () => {
    const headers = Array.from({ length: 50 }, (_, index) => ({
      mail_id: 100 - index,
      timestamp: '2026-09-17T09:00:00Z',
    }))
    const execute = vi.fn(async (operationId: string) => ({
      data:
        operationId === 'mail-headers'
          ? headers
          : { body: '<p>Body</p>', timestamp: '2026-09-17T09:00:00Z' },
      validatedAt: '2026-09-17T10:00:00Z',
    }))
    const result = await mailDetailsResource.collect!(
      collectionContext({ sectionId: 'mail', execute }),
    )

    expect(result).toMatchObject({
      complete: false,
      data: {
        checkpoint: { complete: false, lastMailId: 72 },
        records: { length: 29 },
      },
    })
    expect(
      execute.mock.calls.filter(([operationId]) => operationId === 'mail-message'),
    ).toHaveLength(29)
  })

  test('materializes wallet balance only for current wallet authority', async () => {
    const materializeCurrentSnapshot = vi.fn().mockResolvedValue({ outcome: 'applied' as const })
    const persistence: CurrentSnapshotPersistence = { materializeCurrentSnapshot }
    const context = evidenceMaterializationContext(
      { kind: 'wallet-balance' as const, balance: 10 },
      persistence,
      'wallet',
    )
    await walletBalanceResource.materialize(context)
    expect(materializeCurrentSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'wallet-balance',
        snapshot: expect.objectContaining({ balance: 10 }),
      }),
    )
    await walletBalanceResource.materialize({ ...context, organizationVersion: 5 })
    expect(materializeCurrentSnapshot).toHaveBeenCalledOnce()
  })

  test('runs maintenance for every evidence store', async () => {
    const purgeEvidence = vi.fn()
    const persistence: EvidenceMaintenancePersistence = { purgeEvidence }
    const context = maintenanceContext(persistence)

    for (const resource of [
      assetsResource,
      walletBalanceResource,
      walletJournalResource,
      walletTransactionsResource,
      mailHeadersResource,
      mailDetailsResource,
    ])
      await resource.maintain?.(context)

    expect(purgeEvidence).not.toHaveBeenCalled()
  })
})

function collectionContext(
  options: {
    readonly sectionId?: 'assets' | 'wallet' | 'mail'
    readonly continuation?: {
      readonly observationId: string
      readonly revision: number
      readonly checkpoint: Readonly<Record<string, unknown>>
    } | null
    readonly execute?: ReturnType<typeof vi.fn>
  } = {},
) {
  return {
    subject,
    organizationVersion: 4,
    corporationId: 98_000_001,
    authorizationGeneration: 8,
    managedAuthority: { ...authority, sectionId: options.sectionId ?? 'assets' },
    requestBudget: 32,
    execute:
      options.execute ??
      vi.fn().mockResolvedValue({
        data: [],
        validatedAt: '2026-09-17T10:00:00Z',
        pagination: { pages: 1 },
      }),
    capabilities: {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      persistence: {
        readActiveEvidenceContinuation: vi.fn().mockResolvedValue(options.continuation ?? null),
      },
      coreData: {
        publishedTypeDetails: vi
          .fn()
          .mockResolvedValue({ rows: [], revision: emptyRevision, complete: true }),
        staticLocationLabels: vi
          .fn()
          .mockResolvedValue({ rows: [], revision: emptyRevision, complete: true }),
      },
    },
  } as never
}

function asset(itemId: number) {
  return {
    item_id: itemId,
    type_id: 34,
    quantity: 1,
    is_singleton: false,
    location_id: 10_000 + itemId,
    location_type: 'item' as const,
    location_flag: 'Hangar',
  }
}

function evidenceObservation<Observation extends EvidenceObservation>(
  sectionId: Observation['sectionId'],
  resourceId: Observation['resourceId'],
  recordKind: Observation['records'][number]['recordKind'],
): EvidenceObservation {
  return {
    sectionId,
    resourceId,
    observationId: '44444444-4444-4444-8444-444444444444',
    expectedRevision: 0,
    checkpoint: { complete: true },
    records: [
      {
        recordKind,
        sourceId: '1',
        sourceTimestamp: '2026-09-17T09:00:00Z',
        evidence: { label: 'record', identifiers: ['one', 'two'] },
        validatedAt: '2026-09-17T10:00:00Z',
      },
    ],
  } as EvidenceObservation
}

function evidenceMaterializationContext<Data, Persistence extends object>(
  data: Data,
  persistence: Persistence,
  sectionId: 'assets' | 'wallet' | 'mail',
) {
  const context = materializationContext(data, persistence)
  return {
    ...context,
    managedAuthority: { ...context.managedAuthority!, sectionId },
  }
}
