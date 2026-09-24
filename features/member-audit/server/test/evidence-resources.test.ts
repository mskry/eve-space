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
  disclosureVersion: 2,
  managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
  organizationDeploymentId: 1 as const,
  organizationVersion: 4,
  sectionActivationVersion: 3,
  sectionId: 'assets',
  targetUserId: '22222222-2222-4222-8222-222222222222',
}
const emptyRevision = {
  buildNumber: 1,
  ingestVersion: 1,
  ingestedAt: '2026-09-17T10:00:00Z',
}

describe('member-audit evidence resources', () => {
  test('declares exact execution modes and binds single requests to the character', () => {
    expect(walletBalanceResource).toMatchObject({ mode: 'single-request' })
    expect(walletBalanceResource.request(subject)).toStrictEqual({
      path: { character_id: subject.characterId },
    })
    for (const resource of [
      assetsResource,
      walletJournalResource,
      walletTransactionsResource,
      mailHeadersResource,
      mailDetailsResource,
    ]) {
      expect(resource.mode).toBe('bounded-collection')
      expect(resource).not.toHaveProperty('request')
      expect(resource).not.toHaveProperty('map')
    }
  })

  test('stages each asset page atomically before advancing its continuation', async () => {
    const pages = [Array.from({ length: 501 }, (_, index) => asset(index + 1)), [asset(502)]]
    const execute = vi.fn(async (_operationId: string, inputs: { query: { page: number } }) => ({
      data: pages[inputs.query.page - 1],
      pagination: { pages: 2 },
      validatedAt: '2026-09-17T10:00:00Z',
    }))
    const first = await assetsResource.collect(collectionContext({ execute }))
    expect(first).toMatchObject({
      complete: false,
      data: { checkpoint: { page: 2 }, expectedRevision: 0, records: { length: 501 } },
    })

    const second = await assetsResource.collect(
      collectionContext({
        continuation: {
          checkpoint: first.data.checkpoint,
          observationId: first.data.observationId,
          revision: 1,
        },
        execute,
      }),
    )
    expect(second).toMatchObject({
      complete: true,
      data: { checkpoint: { complete: true }, expectedRevision: 1, records: { length: 1 } },
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
    const fullPage = Array.from({ length: 1000 }, (_, index) => asset(index + 1))
    const collected = await assetsResource.collect(
      collectionContext({
        execute: vi.fn().mockResolvedValue({
          data: fullPage,
          pagination: { pages: 1 },
          validatedAt: '2026-09-17T10:00:00Z',
        }),
      }),
    )
    expect(collected).toMatchObject({
      complete: true,
      data: { checkpoint: { complete: true, page: 1 }, records: { length: 1000 } },
    })

    await expect(
      assetsResource.collect(
        collectionContext({
          execute: vi.fn().mockResolvedValue({
            data: [],
            pagination: { pages: 11 },
            validatedAt: '2026-09-17T10:00:00Z',
          }),
        }),
      ),
    ).rejects.toThrow('exceeded the reviewed page bound')
  })

  test('does not submit unsupported asset locations to PostUniverseNames', async () => {
    const execute = vi.fn(async (operationId: string) => {
      if (operationId !== 'character-assets-page') {
        throw new Error(`Unexpected operation ${operationId}`)
      }
      return {
        data: [{ ...asset(1), location_id: 1_000_000_000_001, location_type: 'other' }],
        pagination: { pages: 1 },
        validatedAt: '2026-09-17T10:00:00Z',
      }
    })

    await expect(assetsResource.collect(collectionContext({ execute }))).resolves.toMatchObject({
      complete: true,
      data: { records: { length: 1 } },
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  test('promotes a complete empty asset observation atomically', async () => {
    const collected = await assetsResource.collect(collectionContext())
    expect(collected).toMatchObject({
      complete: true,
      data: { checkpoint: { complete: true }, records: [] },
    })

    const writeEvidenceContinuation = vi
      .fn()
      .mockResolvedValue({ outcome: 'applied' as const, revision: 1 })
    const promoteEvidenceObservation = vi.fn().mockResolvedValue({ outcome: 'applied' as const })
    const persistence: EvidenceMaterializationPersistence = {
      promoteEvidenceObservation,
      writeEvidenceContinuation,
    }
    await assetsResource.materialize(
      evidenceMaterializationContext(collected.data, persistence, 'assets'),
    )

    expect(writeEvidenceContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: expect.objectContaining({ complete: true }),
        records: [],
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
        promoteEvidenceObservation,
        writeEvidenceContinuation,
      }

      await materializeEvidenceObservation(
        evidenceMaterializationContext(observation, persistence, observation.sectionId),
      )

      expect(writeEvidenceContinuation).toHaveBeenCalledWith(
        expect.objectContaining({
          records: [
            expect.objectContaining({ evidence: { label: 'record', identifiers: ['one', 'two'] } }),
          ],
          resourceId: observation.resourceId,
          sectionId: observation.sectionId,
        }),
      )
      expect(promoteEvidenceObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedRevision: 1,
          resourceId: observation.resourceId,
          sectionId: observation.sectionId,
        }),
      )
    }
  })

  test('projects wallet balance and bounded journal evidence', async () => {
    expect(
      walletBalanceResource.map({ capabilities: { coreData: {} }, data: 42.5, subject }),
    ).toStrictEqual({ balance: 42.5, kind: 'wallet-balance' })

    const journal = await walletJournalResource.collect(
      collectionContext({
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
        sectionId: 'wallet',
      }),
    )
    expect(journal).toMatchObject({
      complete: true,
      data: {
        records: [
          {
            evidence: { contextId: null, contextType: null, journalId: 7 },
            sourceId: '7',
          },
        ],
      },
    })
  })

  test('uses X-Pages for an exact-full final wallet journal page', async () => {
    const data = Array.from({ length: 2500 }, (_, index) => ({
      date: '2026-09-17T09:00:00Z',
      description: 'Donation',
      id: index + 1,
      ref_type: 'player_donation',
    }))
    const result = await walletJournalResource.collect(
      collectionContext({
        execute: vi.fn().mockResolvedValue({
          data,
          validatedAt: '2026-09-17T10:00:00Z',
          pagination: { pages: 1 },
        }),
        sectionId: 'wallet',
      }),
    )
    expect(result).toMatchObject({
      complete: true,
      data: { checkpoint: { complete: true, page: 1 }, records: { length: 2500 } },
    })
  })

  test('advances the opaque transaction cursor only after the full page is staged', async () => {
    const data = Array.from({ length: 2500 }, (_, index) => ({
      date: '2026-09-17T09:00:00Z',
      is_buy: true,
      is_personal: true,
      journal_ref_id: 20_000 + index,
      location_id: 60_000_001,
      quantity: 1,
      transaction_id: 10_000 - index,
      type_id: 34,
      unit_price: 2,
    }))
    const result = await walletTransactionsResource.collect(
      collectionContext({
        continuation: {
          checkpoint: { complete: false, fromId: null },
          observationId: '44444444-4444-4444-8444-444444444444',
          revision: 4,
        },
        execute: vi.fn().mockResolvedValue({
          data,
          validatedAt: '2026-09-17T10:00:00Z',
        }),
        sectionId: 'wallet',
      }),
    )
    expect(result).toMatchObject({
      complete: false,
      data: {
        checkpoint: { complete: false, fromId: 7501 },
        expectedRevision: 4,
        records: { length: 2500 },
      },
    })
  })

  test('keeps valid-but-unresolvable mail parties as unknown names', async () => {
    const execute = vi.fn(async (operationId: string) => {
      if (operationId === 'mail-headers') {
        return {
          data: [
            {
              from: 90_666_561,
              mail_id: 9,
              timestamp: '2026-09-17T09:00:00Z',
            },
          ],
          validatedAt: '2026-09-17T10:00:00Z',
        }
      }
      throw Object.assign(new Error('Ensure all IDs are valid before resolving'), { status: 404 })
    })
    const result = await mailHeadersResource.collect(
      collectionContext({ execute, sectionId: 'mail' }),
    )

    expect(result.data.records[0]?.evidence).toMatchObject({
      senderId: 90_666_561,
      senderName: null,
    })
  })

  test('resolves mail parties and sanitizes detail content', async () => {
    const header = {
      from: 90_000_002,
      mail_id: 9,
      recipients: [{ recipient_id: 55, recipient_type: 'mailing_list' }],
      subject: 'Subject',
      timestamp: '2026-09-17T09:00:00Z',
    }
    const headerExecute = vi.fn(async (operationId: string) => {
      if (operationId === 'mail-headers') {
        return { data: [header], validatedAt: '2026-09-17T10:00:00Z' }
      }
      if (operationId === 'universe-resolve-names') {
        return {
          data: [{ category: 'character', id: 90_000_002, name: 'Sender' }],
          validatedAt: '2026-09-17T10:00:00Z',
        }
      }
      return {
        data: [{ mailing_list_id: 55, name: 'List' }],
        validatedAt: '2026-09-17T10:00:00Z',
      }
    })
    const headers = await mailHeadersResource.collect(
      collectionContext({ execute: headerExecute, sectionId: 'mail' }),
    )
    expect(headers.data.records[0]?.evidence).toMatchObject({
      body: null,
      recipientNames: ['List'],
      senderName: 'Sender',
    })

    const detailExecute = vi.fn(async (operationId: string) => {
      if (operationId === 'mail-headers') {
        return { data: [header], validatedAt: '2026-09-17T10:00:00Z' }
      }
      if (operationId === 'mail-message') {
        return {
          data: { ...header, body: '<p>Hello <b>pilot</b></p>', read: true },
          validatedAt: '2026-09-17T10:00:01Z',
        }
      }
      if (operationId === 'universe-resolve-names') {
        return {
          data: [{ category: 'character', id: 90_000_002, name: 'Sender' }],
          validatedAt: '2026-09-17T10:00:00Z',
        }
      }
      return {
        data: [{ mailing_list_id: 55, name: 'List' }],
        validatedAt: '2026-09-17T10:00:00Z',
      }
    })
    const details = await mailDetailsResource.collect(
      collectionContext({ execute: detailExecute, sectionId: 'mail' }),
    )
    expect(details).toMatchObject({
      complete: true,
      data: { records: [{ evidence: { body: 'Hello pilot' }, sourceId: '9' }] },
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
    const result = await mailDetailsResource.collect(
      collectionContext({ execute, sectionId: 'mail' }),
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
      { balance: 10, kind: 'wallet-balance' as const },
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
    ]) {
      await resource.maintain?.(context)
    }

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
    authorizationGeneration: 8,
    capabilities: {
      coreData: {
        publishedTypeDetails: vi
          .fn()
          .mockResolvedValue({ rows: [], revision: emptyRevision, complete: true }),
        staticLocationLabels: vi
          .fn()
          .mockResolvedValue({ rows: [], revision: emptyRevision, complete: true }),
      },
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      persistence: {
        readActiveEvidenceContinuation: vi.fn().mockResolvedValue(options.continuation ?? null),
      },
    },
    corporationId: 98_000_001,
    managedAuthority: { ...authority, sectionId: options.sectionId ?? 'assets' },
    operations: operationMethods(
      options.execute ??
        vi.fn().mockResolvedValue({
          data: [],
          validatedAt: '2026-09-17T10:00:00Z',
          pagination: { pages: 1 },
        }),
    ),
    organizationVersion: 4,
    requestBudget: 32,
    subject,
  } as never
}

function operationMethods(execute: ReturnType<typeof vi.fn>) {
  return new Proxy(
    {},
    { get: (_target, operationId) => (inputs: unknown) => execute(operationId, inputs) },
  )
}

function asset(itemId: number) {
  return {
    is_singleton: false,
    item_id: itemId,
    location_flag: 'Hangar',
    location_id: 10_000 + itemId,
    location_type: 'item' as const,
    quantity: 1,
    type_id: 34,
  }
}

function evidenceObservation<Observation extends EvidenceObservation>(
  sectionId: Observation['sectionId'],
  resourceId: Observation['resourceId'],
  recordKind: Observation['records'][number]['recordKind'],
): EvidenceObservation {
  return {
    checkpoint: { complete: true },
    expectedRevision: 0,
    observationId: '44444444-4444-4444-8444-444444444444',
    records: [
      {
        recordKind,
        sourceId: '1',
        sourceTimestamp: '2026-09-17T09:00:00Z',
        evidence: { label: 'record', identifiers: ['one', 'two'] },
        validatedAt: '2026-09-17T10:00:00Z',
      },
    ],
    resourceId,
    sectionId,
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
