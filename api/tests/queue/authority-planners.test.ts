import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runCorporationSourcePlanner } from '../../src/queue/corporation-source-planner.js'
import { runDerivedAuthorityPlanner } from '../../src/queue/derived-authority-planner.js'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'

const sourceId = '66503848-72b8-4fa3-8af5-de056001a37e'
const subjectLifecycleId = '35acd527-9539-44ad-aacf-9f8e45232267'
const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const sourceContext = {
  organizationVersion: 3,
  sourceSubjectLifecycleId: subjectLifecycleId,
  authorizationGeneration: 7,
  roleEvidenceRevision: '2026-09-21T12:00:00.000Z',
} as const
const corporationCandidate = { sourceId, ...sourceContext }
const derivedCandidate = {
  organizationVersion: sourceContext.organizationVersion,
  userId,
  characterId: 1_404_328_063,
  subjectLifecycleId,
  authorizationGeneration: sourceContext.authorizationGeneration,
  sourceId: null,
  roleEvidenceRevision: null,
} as const
const mocks = vi.hoisted(() => ({
  selectCorporationSources: vi.fn(),
  selectDerivedAuthority: vi.fn(),
}))

vi.mock('../../src/organization/corporation-sources.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/organization/corporation-sources.js')>()),
  selectDueOrganizationCorporationSources: mocks.selectCorporationSources,
}))
vi.mock('../../src/organization/derived-authority.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/organization/derived-authority.js')>()),
  selectDueDerivedDirectorCharacters: mocks.selectDerivedAuthority,
}))

const planners = [
  {
    name: 'corporation source',
    run: runCorporationSourcePlanner,
    selectDue: mocks.selectCorporationSources,
    command: {
      name: 'corporation-source-evidence',
      payload: corporationCandidate,
      source: 'planner',
    } as const,
  },
  {
    name: 'derived authority',
    run: runDerivedAuthorityPlanner,
    selectDue: mocks.selectDerivedAuthority,
    command: {
      name: 'derived-authority',
      payload: derivedCandidate,
      source: 'planner',
    } as const,
  },
] as const

beforeEach(() => {
  mocks.selectCorporationSources.mockReset().mockResolvedValue([])
  mocks.selectDerivedAuthority.mockReset().mockResolvedValue([])
})

describe.each(planners)('$name planner', ({ run, selectDue, command }) => {
  test('schedules due authority refresh work', async () => {
    const signal = new AbortController().signal
    const subject = context(signal)
    selectDue.mockResolvedValue([command.payload])

    await expect(run(subject)).resolves.toEqual({ planned: 1, reason: 'scheduled' })
    expect(subject.producer.commands).toEqual([command])
  })

  test('coalesces an already active authority refresh', async () => {
    const subject = context()
    selectDue.mockResolvedValue([command.payload])
    await subject.producer.enqueue(command)

    await expect(run(subject)).resolves.toEqual({ planned: 0, reason: 'idle' })
    expect(subject.producer.commands).toHaveLength(1)
  })

  test('stops when planner capacity rejects the refresh', async () => {
    const subject = context(undefined, 0)
    selectDue.mockResolvedValue([command.payload])

    await expect(run(subject)).resolves.toEqual({ planned: 0, reason: 'planner-paused' })
    expect(subject.producer.commands).toEqual([])
  })

  test('does not query due work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(run(context(controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
    expect(selectDue).not.toHaveBeenCalled()
  })
})

function context(signal?: AbortSignal, highWaterMark?: number) {
  return {
    producer: createInMemoryQueueProducer({ highWaterMark }),
    outcomes: {
      recordAffiliation: vi.fn().mockResolvedValue(undefined),
      recordOutbox: vi.fn().mockResolvedValue(undefined),
    },
    signal,
  }
}
