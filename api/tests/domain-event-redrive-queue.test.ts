import { describe, expect, test, vi } from 'vitest'
import { assertSelectedDomainEventJobsAbsent } from '../src/domain-event-redrive-queue.js'

const firstEventId = '98a782d2-e042-47d7-9659-03b218121a1a'
const secondEventId = '16b7570c-f6ea-43c5-9669-4692245b6667'

describe('domain-event re-drive queue guard', () => {
  test('accepts selected identities absent from BullMQ', async () => {
    const queue = { getJob: vi.fn().mockResolvedValue(undefined) }

    await expect(
      assertSelectedDomainEventJobsAbsent([firstEventId, secondEventId], queue as never),
    ).resolves.toBeUndefined()
    expect(queue.getJob).toHaveBeenCalledWith(`domain-event-${firstEventId}`)
    expect(queue.getJob).toHaveBeenCalledWith(`domain-event-${secondEventId}`)
  })

  test('rejects retained matching jobs without inspecting unrelated queue work', async () => {
    const queue = {
      getJob: vi
        .fn()
        .mockResolvedValueOnce({ id: `domain-event-${firstEventId}` })
        .mockResolvedValueOnce(undefined),
    }

    await expect(
      assertSelectedDomainEventJobsAbsent([firstEventId, secondEventId], queue as never),
    ).rejects.toThrow('1 selected domain-event jobs still exist')
    expect(queue.getJob).toHaveBeenCalledTimes(2)
  })
})
