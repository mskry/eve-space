import { describe, expect, test, vi } from 'vitest'
import { createQueueOutcomeRecorder } from '../../src/queue/outcome-recorder.js'
import {
  decodeAffiliationPlannerOutcome,
  decodeOutboxRelayOutcome,
} from '../../src/queue/outcomes.js'

const recordedAt = '2026-09-10T12:00:00.000Z'

describe('queue outcome recorder', () => {
  test('writes each strict representation to its owned Redis key', async () => {
    const set = vi.fn().mockResolvedValue('OK')
    const recorder = createQueueOutcomeRecorder({ set } as never)
    const affiliation = { outcome: 'scheduled', planned: 2, recordedAt } as const
    const outbox = { outcome: 'published', category: null, recordedAt } as const

    await recorder.recordAffiliation(affiliation)
    await recorder.recordOutbox(outbox)

    expect(set.mock.calls[0]?.[0]).toBe('eve-space:v1:planner:affiliation:outcome')
    expect(decodeAffiliationPlannerOutcome(set.mock.calls[0]?.[1])).toEqual(affiliation)
    expect(set.mock.calls[1]?.[0]).toBe('eve-space:v1:outbox-relay:outcome')
    expect(decodeOutboxRelayOutcome(set.mock.calls[1]?.[1])).toEqual(outbox)
  })

  test('rejects invalid values before writing and propagates Redis failures', async () => {
    const failure = new Error('redis://private-host unavailable')
    const set = vi.fn().mockRejectedValue(failure)
    const recorder = createQueueOutcomeRecorder({ set } as never)

    await expect(
      recorder.recordAffiliation({ outcome: 'idle', planned: 1, recordedAt } as never),
    ).rejects.toThrow('Affiliation outcome and planned count must correspond')
    expect(set).not.toHaveBeenCalled()

    await expect(
      recorder.recordOutbox({ outcome: 'published', category: null, recordedAt }),
    ).rejects.toBe(failure)
  })
})
