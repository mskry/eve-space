import { describe, expect, test, vi } from 'vitest'
import { runQueuePlanner } from '../src/queue/planner.js'

describe('queue planner composition', () => {
  test('retains existing responsibilities before generic resource planning', async () => {
    const calls: string[] = []
    const queue = { marker: 'operations' }
    const signal = new AbortController().signal
    const enqueueDiagnostic = vi.fn(async () => calls.push('diagnostic'))
    const planAffiliations = vi.fn(async () => calls.push('affiliation'))
    const repairCollectionState = vi.fn(async () => calls.push('repair'))
    const planResources = vi.fn(async () => calls.push('resources'))

    await runQueuePlanner(queue as never, signal, {
      enqueueDiagnostic,
      planAffiliations,
      repairCollectionState,
      planResources,
    })

    expect(calls).toEqual(['diagnostic', 'affiliation', 'repair', 'resources'])
    expect(enqueueDiagnostic).toHaveBeenCalledWith('planner', signal)
    expect(planAffiliations).toHaveBeenCalledWith(queue, signal)
    expect(repairCollectionState).toHaveBeenCalledWith({ signal })
    expect(planResources).toHaveBeenCalledWith(queue, signal)
  })

  test('does not let a coalesced existing work class suppress later planner responsibilities', async () => {
    const planAffiliations = vi.fn().mockResolvedValue({ reason: 'coalesced' })
    const repairCollectionState = vi.fn().mockResolvedValue({ repairedResources: 0 })
    const planResources = vi.fn().mockResolvedValue({ reason: 'idle' })

    await runQueuePlanner({} as never, undefined, {
      enqueueDiagnostic: vi.fn().mockResolvedValue({ reason: 'coalesced' }),
      planAffiliations,
      repairCollectionState,
      planResources,
    })

    expect(planAffiliations).toHaveBeenCalledOnce()
    expect(repairCollectionState).toHaveBeenCalledOnce()
    expect(planResources).toHaveBeenCalledOnce()
  })

  test('stops the pass when an existing responsibility fails', async () => {
    const failure = new Error('affiliation planning failed')
    const repairCollectionState = vi.fn()
    const planResources = vi.fn()

    await expect(
      runQueuePlanner({} as never, undefined, {
        enqueueDiagnostic: vi.fn().mockResolvedValue(undefined),
        planAffiliations: vi.fn().mockRejectedValue(failure),
        repairCollectionState,
        planResources,
      }),
    ).rejects.toBe(failure)
    expect(repairCollectionState).not.toHaveBeenCalled()
    expect(planResources).not.toHaveBeenCalled()
  })

  test('does not plan resources when collection-state repair fails', async () => {
    const failure = new Error('collection-state repair failed')
    const planResources = vi.fn()

    await expect(
      runQueuePlanner({} as never, undefined, {
        enqueueDiagnostic: vi.fn().mockResolvedValue(undefined),
        planAffiliations: vi.fn().mockResolvedValue(undefined),
        repairCollectionState: vi.fn().mockRejectedValue(failure),
        planResources,
      }),
    ).rejects.toBe(failure)
    expect(planResources).not.toHaveBeenCalled()
  })
})
