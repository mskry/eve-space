import { describe, expect, test, vi } from 'vitest'
import {
  organizationOwnerEvidenceJobId,
  runOrganizationOwnerEvidencePlanner,
} from '../../src/queue/owner-evidence-planner.js'

const grantId = '98a782d2-e042-47d7-9659-03b218121a1a'

describe('organization owner evidence planner', () => {
  test('reconstructs due refresh work using only stable authority identity', async () => {
    const subject = queue()
    const selectDue = vi.fn().mockResolvedValue([{ grantId }])

    await expect(
      runOrganizationOwnerEvidencePlanner(subject as never, undefined, selectDue),
    ).resolves.toEqual({ planned: 1, reason: 'scheduled' })
    expect(subject.add).toHaveBeenCalledWith(
      'organization-owner-evidence',
      { operationId: organizationOwnerEvidenceJobId(grantId), grantId },
      expect.objectContaining({ attempts: 3 }),
    )
  })

  test('coalesces an already active grant refresh', async () => {
    const operationId = organizationOwnerEvidenceJobId(grantId)
    const subject = queue([{ data: { operationId, grantId } }])

    await expect(
      runOrganizationOwnerEvidencePlanner(subject as never, undefined, async () => [{ grantId }]),
    ).resolves.toEqual({ planned: 0, reason: 'idle' })
    expect(subject.add).not.toHaveBeenCalled()
  })
})

function queue(active: { data: unknown }[] = []) {
  const client = { del: vi.fn(), set: vi.fn() }
  return {
    add: vi.fn(),
    getBackend: () => ({ client: Promise.resolve(client) }),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, delayed: 0, prioritized: 0 }),
    getJobs: vi.fn().mockResolvedValue(active),
  }
}
