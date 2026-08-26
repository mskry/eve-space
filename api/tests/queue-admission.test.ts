import { describe, expect, test, vi } from 'vitest'
import {
  QueueAdmissionError,
  admitQueueWork,
  getQueueAdmissionCapacity,
} from '../src/queue/admission.js'

function queue({
  waiting = 0,
  delayed = 0,
  prioritized = 0,
  jobs = [] as Array<{ data: { operationId: string } }>,
} = {}) {
  const client = { del: vi.fn(), set: vi.fn() }
  return {
    getJobCounts: vi.fn().mockResolvedValue({ waiting, delayed, prioritized }),
    getJobs: vi.fn().mockResolvedValue(jobs),
    getBackend: () => ({ client: Promise.resolve(client) }),
    client,
  }
}

describe('queue admission control', () => {
  test('pauses planner production at the waiting, delayed, and prioritized high-water mark', async () => {
    const subject = queue({ waiting: 1, delayed: 1, prioritized: 1 })

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

  test('pauses outbox relay independently without rejecting committed work', async () => {
    const subject = queue({ waiting: 2 })

    await expect(admitQueueWork(subject as never, 'domain-event', 'outbox', 2)).resolves.toEqual({
      admitted: false,
      depth: 2,
      reason: 'outbox-paused',
    })
    expect(subject.client.set).toHaveBeenCalledWith('eve-space:v1:outbox-relay:state', 'paused')
    expect(subject.client.set).not.toHaveBeenCalledWith(
      'eve-space:v1:planner:state',
      expect.anything(),
    )
  })

  test('coalesces planner work already active, waiting, delayed, or prioritized', async () => {
    const subject = queue({ jobs: [{ data: { operationId: 'diagnostic' } }] })

    await expect(admitQueueWork(subject as never, 'diagnostic', 'planner')).resolves.toEqual({
      admitted: false,
      depth: 0,
      reason: 'coalesced',
    })
    expect(subject.getJobs).toHaveBeenCalledWith(['active', 'waiting', 'delayed', 'prioritized'])
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

  test('resumes only outbox relay after queue depth recovers', async () => {
    const subject = queue()

    await expect(admitQueueWork(subject as never, 'domain-event', 'outbox')).resolves.toMatchObject(
      { admitted: true },
    )
    expect(subject.client.del).toHaveBeenCalledWith('eve-space:v1:outbox-relay:state')
    expect(subject.client.del).not.toHaveBeenCalledWith('eve-space:v1:planner:state')
    expect(subject.getJobs).not.toHaveBeenCalled()
  })

  test('reports remaining ready and delayed capacity without counting active work', async () => {
    const subject = queue({ waiting: 2, delayed: 1, prioritized: 1 })

    await expect(getQueueAdmissionCapacity(subject as never, 'planner', 5)).resolves.toEqual({
      admitted: true,
      depth: 4,
      remainingCapacity: 1,
    })
    expect(subject.getJobCounts).toHaveBeenCalledWith('waiting', 'delayed', 'prioritized')
    expect(subject.getJobs).not.toHaveBeenCalled()
  })

  test('can inspect recovered planner capacity without erasing an earlier pause', async () => {
    const subject = queue()

    await expect(
      getQueueAdmissionCapacity(subject as never, 'planner', 5, {
        preservePausedState: true,
      }),
    ).resolves.toMatchObject({ admitted: true, remainingCapacity: 5 })
    expect(subject.client.del).not.toHaveBeenCalled()
  })
})
