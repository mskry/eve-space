import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  organizationOwnerEvidenceJobId,
  runOrganizationOwnerEvidencePlanner,
} from '../../src/queue/owner-evidence-planner.js'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'

const grantId = '98a782d2-e042-47d7-9659-03b218121a1a'
const selectDue = vi.hoisted(() => vi.fn())

vi.mock('../../src/organization/owner-evidence.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/organization/owner-evidence.js')>()),
  selectDueOrganizationOwnerEvidence: selectDue,
}))

beforeEach(() => {
  selectDue.mockReset().mockResolvedValue([])
})

describe('organization owner evidence planner', () => {
  test('reconstructs due refresh work using only stable authority identity', async () => {
    const subject = context()
    selectDue.mockResolvedValue([{ grantId }])

    await expect(runOrganizationOwnerEvidencePlanner(subject)).resolves.toEqual({
      planned: 1,
      reason: 'scheduled',
    })
    expect(subject.producer.commands).toEqual([
      {
        name: 'organization-owner-evidence',
        payload: { operationId: organizationOwnerEvidenceJobId(grantId), grantId },
        source: 'planner',
      },
    ])
  })

  test('coalesces an already active grant refresh', async () => {
    const subject = context()
    selectDue.mockResolvedValue([{ grantId }])
    await subject.producer.enqueue({
      name: 'organization-owner-evidence',
      payload: { operationId: organizationOwnerEvidenceJobId(grantId), grantId },
      source: 'planner',
    })

    await expect(runOrganizationOwnerEvidencePlanner(subject)).resolves.toEqual({
      planned: 0,
      reason: 'idle',
    })
    expect(subject.producer.commands).toHaveLength(1)
  })
})

function context() {
  return {
    producer: createInMemoryQueueProducer(),
    outcomes: {
      recordAffiliation: vi.fn().mockResolvedValue(undefined),
      recordOutbox: vi.fn().mockResolvedValue(undefined),
    },
  }
}
