import { describe, expect, test, vi } from 'vitest'
import { QueueAdmissionError, admitQueueWork } from '../src/queue/admission.js'

function queue({
  waiting = 0,
  delayed = 0,
  jobs = [] as Array<{ data: { operationId: string } }>,
} = {}) {
  const client = { del: vi.fn(), set: vi.fn() }
  return {
    getJobCounts: vi.fn().mockResolvedValue({ waiting, delayed }),
    getJobs: vi.fn().mockResolvedValue(jobs),
    getBackend: () => ({ client: Promise.resolve(client) }),
    client,
  }
}

describe('queue admission control', () => {
  test('pauses planner production at the waiting plus delayed high-water mark', async () => {
    const subject = queue({ waiting: 2, delayed: 1 })

    await expect(admitQueueWork(subject as never, 'diagnostic', 'planner', 3)).resolves.toEqual({
      admitted: false,
      depth: 3,
      reason: 'planner-paused',
    })
    expect(subject.client.set).toHaveBeenCalledWith('eve-space:v1:planner:state', 'paused')
  })

  test('explicitly rejects on-demand production above the high-water mark', async () => {
    await expect(
      admitQueueWork(queue({ waiting: 1 }) as never, 'diagnostic', 'on-demand', 1),
    ).rejects.toBeInstanceOf(QueueAdmissionError)
  })

  test('coalesces planner work already active, waiting, or delayed', async () => {
    const subject = queue({ jobs: [{ data: { operationId: 'diagnostic' } }] })

    await expect(admitQueueWork(subject as never, 'diagnostic', 'planner')).resolves.toEqual({
      admitted: false,
      depth: 0,
      reason: 'coalesced',
    })
  })

  test('admits available work and clears a previous paused marker', async () => {
    const subject = queue()

    await expect(admitQueueWork(subject as never, 'diagnostic', 'planner')).resolves.toEqual({
      admitted: true,
      depth: 0,
    })
    expect(subject.client.del).toHaveBeenCalledWith('eve-space:v1:planner:state')
  })

  test('does not let on-demand admission erase planner pause state', async () => {
    const subject = queue()

    await expect(
      admitQueueWork(subject as never, 'diagnostic', 'on-demand'),
    ).resolves.toMatchObject({
      admitted: true,
    })
    expect(subject.client.del).not.toHaveBeenCalled()
  })
})
