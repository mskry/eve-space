import { describe, expect, test, vi } from 'vitest'
import { assetsResource } from '../src/asset-resource.js'
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

describe('member-audit evidence resources', () => {
  test('binds direct collection requests to the exact character', () => {
    for (const resource of [
      assetsResource,
      walletBalanceResource,
      walletJournalResource,
      walletTransactionsResource,
      mailHeadersResource,
    ])
      expect(resource.request(subject)).toEqual({ path: { character_id: subject.characterId } })

    expect(() => mailDetailsResource.request(subject)).toThrow(
      'Mail detail collection requires a continuation checkpoint',
    )
  })

  test('passes staged evidence through until persistence promotion is implemented', async () => {
    const data = { sourceId: 'evidence-1' }
    const noProductsContext = { subject, data, capabilities: { coreData: {} } }
    const assetContext = {
      subject,
      data,
      capabilities: {
        coreData: {
          publishedTypeDetails: vi.fn(),
          staticLocationLabels: vi.fn(),
        },
      },
    }
    expect(assetsResource.map(assetContext)).toBe(data)
    for (const resource of [
      walletBalanceResource,
      walletJournalResource,
      walletTransactionsResource,
      mailHeadersResource,
      mailDetailsResource,
    ])
      expect(resource.map(noProductsContext)).toBe(data)

    const evidencePersistence: EvidenceMaterializationPersistence = {
      writeEvidenceContinuation: vi.fn(),
      promoteEvidenceObservation: vi.fn(),
    }
    for (const resource of [
      assetsResource,
      walletJournalResource,
      walletTransactionsResource,
      mailHeadersResource,
      mailDetailsResource,
    ])
      await expect(
        resource.materialize(materializationContext(data, evidencePersistence)),
      ).resolves.toEqual({ outcome: 'obsolete' })

    const currentSnapshotPersistence: CurrentSnapshotPersistence = {
      materializeCurrentSnapshot: vi.fn(),
    }
    await expect(
      walletBalanceResource.materialize(materializationContext(data, currentSnapshotPersistence)),
    ).resolves.toEqual({ outcome: 'obsolete' })
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
