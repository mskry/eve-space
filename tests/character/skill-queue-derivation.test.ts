import { describe, expect, it } from 'vitest'
import {
  entryDurationMs,
  entryProgress,
  entryRemainingMs,
  formatQueueDuration,
  queueRemainingMs,
  queueRemainingSp,
  queueSegments,
  queuedLevelsByType,
  resolveSkillQueueState,
  romanLevel,
  trainingRatePerMinute,
  type SkillQueueEntry,
} from '../../app/utils/skill-queue'

const now = Date.parse('2026-08-29T12:00:00Z')

function entry(overrides: Partial<SkillQueueEntry> & { queuePosition: number }): SkillQueueEntry {
  return {
    typeId: 3300 + overrides.queuePosition,
    name: `Skill ${overrides.queuePosition}`,
    groupId: 255,
    groupName: 'Gunnery',
    finishedLevel: 5,
    levelStartSp: 256_000,
    levelEndSp: 512_000,
    trainingStartSp: 256_000,
    startDate: null,
    finishDate: null,
    primaryAttribute: 'perception',
    secondaryAttribute: 'willpower',
    ...overrides,
  }
}

// Mirrors the API's resolveSkillQueueState case table; both implementations must agree.
describe('resolveSkillQueueState', () => {
  it('reports an empty queue', () => {
    expect(resolveSkillQueueState([], now)).toEqual({ state: 'empty', activeQueuePosition: null })
  })

  it('reports a paused queue when no entry carries a start date', () => {
    expect(
      resolveSkillQueueState([entry({ queuePosition: 0 }), entry({ queuePosition: 1 })], now),
    ).toEqual({ state: 'paused', activeQueuePosition: null })
  })

  it('reports a lapsed queue when every entry finished in the past', () => {
    expect(
      resolveSkillQueueState(
        [
          entry({
            queuePosition: 0,
            startDate: '2026-08-27T10:00:00Z',
            finishDate: '2026-08-28T10:00:00Z',
          }),
          entry({
            queuePosition: 1,
            startDate: '2026-08-28T10:00:00Z',
            finishDate: '2026-08-29T10:00:00Z',
          }),
        ],
        now,
      ),
    ).toEqual({ state: 'lapsed', activeQueuePosition: null })
  })

  it('identifies the first unfinished entry as the one training', () => {
    expect(
      resolveSkillQueueState(
        [
          entry({
            queuePosition: 0,
            startDate: '2026-08-28T10:00:00Z',
            finishDate: '2026-08-29T10:00:00Z',
          }),
          entry({
            queuePosition: 1,
            startDate: '2026-08-29T10:00:00Z',
            finishDate: '2026-08-29T18:00:00Z',
          }),
          entry({
            queuePosition: 2,
            startDate: '2026-08-29T18:00:00Z',
            finishDate: '2026-08-30T18:00:00Z',
          }),
        ],
        now,
      ),
    ).toEqual({ state: 'training', activeQueuePosition: 1 })
  })

  it('does not report a lapsed queue while an entry has no finish date', () => {
    expect(
      resolveSkillQueueState(
        [
          entry({
            queuePosition: 0,
            startDate: '2026-08-28T10:00:00Z',
            finishDate: '2026-08-29T10:00:00Z',
          }),
          entry({ queuePosition: 1, startDate: '2026-08-29T10:00:00Z' }),
        ],
        now,
      ),
    ).toEqual({ state: 'training', activeQueuePosition: 1 })
  })

  it('advances from training to lapsed as the clock passes the last finish date', () => {
    const entries = [
      entry({
        queuePosition: 0,
        startDate: '2026-08-29T10:00:00Z',
        finishDate: '2026-08-29T14:00:00Z',
      }),
    ]

    expect(resolveSkillQueueState(entries, now).state).toBe('training')
    expect(resolveSkillQueueState(entries, Date.parse('2026-08-29T15:00:00Z')).state).toBe('lapsed')
  })
})

describe('queuedLevelsByType', () => {
  it('keeps the highest queued level per skill', () => {
    const levels = queuedLevelsByType({
      entries: [
        entry({ queuePosition: 0, typeId: 3300, finishedLevel: 3 }),
        entry({ queuePosition: 1, typeId: 3300, finishedLevel: 5 }),
        entry({ queuePosition: 2, typeId: 3301, finishedLevel: 2 }),
      ],
    })

    expect(levels.get(3300)).toBe(5)
    expect(levels.get(3301)).toBe(2)
  })

  it('is empty when the queue is unavailable', () => {
    expect(queuedLevelsByType(null).size).toBe(0)
    expect(queuedLevelsByType(undefined).size).toBe(0)
  })
})

describe('trainingRatePerMinute', () => {
  it('derives the actual rate from remaining SP and queue timestamps', () => {
    expect(
      trainingRatePerMinute(
        entry({
          queuePosition: 0,
          trainingStartSp: 504_800,
          startDate: '2026-08-29T10:00:00Z',
          finishDate: '2026-08-29T14:00:00Z',
        }),
      ),
    ).toBe(30)
  })

  it('does not claim a rate without complete SP and timing boundaries', () => {
    expect(trainingRatePerMinute(entry({ queuePosition: 0 }))).toBeNull()
    expect(
      trainingRatePerMinute(
        entry({
          queuePosition: 0,
          trainingStartSp: null,
          startDate: '2026-08-29T10:00:00Z',
          finishDate: '2026-08-29T14:00:00Z',
        }),
      ),
    ).toBeNull()
  })
})

describe('entry timing', () => {
  it('reports remaining and total duration from the entry timestamps', () => {
    const training = entry({
      queuePosition: 0,
      startDate: '2026-08-29T10:00:00Z',
      finishDate: '2026-08-29T14:00:00Z',
    })

    expect(entryRemainingMs(training, now)).toBe(2 * 60 * 60_000)
    expect(entryDurationMs(training)).toBe(4 * 60 * 60_000)
  })

  it('clamps a finished entry to zero rather than reporting negative time', () => {
    const finished = entry({
      queuePosition: 0,
      startDate: '2026-08-28T10:00:00Z',
      finishDate: '2026-08-29T10:00:00Z',
    })

    expect(entryRemainingMs(finished, now)).toBe(0)
  })

  it('reports no timing for an entry without dates', () => {
    expect(entryRemainingMs(entry({ queuePosition: 0 }), now)).toBeNull()
    expect(entryDurationMs(entry({ queuePosition: 0 }))).toBeNull()
  })
})

describe('entryProgress', () => {
  it('interpolates percent and skill points across the level', () => {
    expect(
      entryProgress(
        entry({
          queuePosition: 0,
          startDate: '2026-08-29T10:00:00Z',
          finishDate: '2026-08-29T14:00:00Z',
        }),
        now,
      ),
    ).toEqual({ percent: 50, currentSp: 384_000, targetSp: 512_000 })
  })

  it('interpolates resumed training from training SP into full-level progress', () => {
    expect(
      entryProgress(
        entry({
          queuePosition: 0,
          trainingStartSp: 384_000,
          startDate: '2026-08-29T10:00:00Z',
          finishDate: '2026-08-29T14:00:00Z',
        }),
        now,
      ),
    ).toEqual({ percent: 75, currentSp: 448_000, targetSp: 512_000 })
  })

  it('does not derive current SP from the rounded display percent', () => {
    expect(
      entryProgress(
        entry({
          queuePosition: 0,
          trainingStartSp: 256_001,
          startDate: '2026-08-29T10:00:00Z',
          finishDate: '2026-08-29T13:00:00Z',
        }),
        now,
      ),
    ).toEqual({ percent: 67, currentSp: 426_667, targetSp: 512_000 })
  })

  it('reports no progress for an undated entry', () => {
    expect(entryProgress(entry({ queuePosition: 0 }), now)).toEqual({
      percent: 0,
      currentSp: 256_000,
      targetSp: 512_000,
    })
  })

  it('omits skill points when the upstream did not provide the level boundaries', () => {
    expect(
      entryProgress(
        entry({
          queuePosition: 0,
          startDate: '2026-08-29T10:00:00Z',
          finishDate: '2026-08-29T14:00:00Z',
          levelStartSp: null,
          levelEndSp: null,
        }),
        now,
      ),
    ).toEqual({ percent: 50, currentSp: null, targetSp: null })
  })
})

describe('queue totals', () => {
  it('reports time until the last dated entry finishes', () => {
    expect(
      queueRemainingMs(
        [
          entry({
            queuePosition: 0,
            startDate: '2026-08-29T10:00:00Z',
            finishDate: '2026-08-29T14:00:00Z',
          }),
          entry({
            queuePosition: 1,
            startDate: '2026-08-29T14:00:00Z',
            finishDate: '2026-08-31T12:00:00Z',
          }),
        ],
        now,
      ),
    ).toBe(2 * 24 * 60 * 60_000)
  })

  it('reports no total for a queue with no scheduled entries', () => {
    expect(queueRemainingMs([entry({ queuePosition: 0 })], now)).toBeNull()
  })

  it('reports remaining skill points across active and upcoming entries', () => {
    expect(
      queueRemainingSp(
        [
          entry({
            queuePosition: 0,
            startDate: '2026-08-29T10:00:00Z',
            finishDate: '2026-08-29T14:00:00Z',
          }),
          entry({
            queuePosition: 1,
            startDate: '2026-08-29T14:00:00Z',
            finishDate: '2026-08-29T18:00:00Z',
          }),
        ],
        now,
      ),
    ).toBe(384_000)
  })

  it('reports no skill-point total when queue boundaries are unavailable', () => {
    expect(
      queueRemainingSp([entry({ queuePosition: 0, levelStartSp: null, levelEndSp: null })], now),
    ).toBeNull()
  })

  it('does not present a partial total when one queue entry lacks boundaries', () => {
    expect(
      queueRemainingSp(
        [
          entry({ queuePosition: 0 }),
          entry({ queuePosition: 1, levelStartSp: null, levelEndSp: null }),
        ],
        now,
      ),
    ).toBeNull()
  })

  it('builds proportional segments and skips undated entries', () => {
    expect(
      queueSegments([
        entry({
          queuePosition: 0,
          startDate: '2026-08-29T10:00:00Z',
          finishDate: '2026-08-29T14:00:00Z',
        }),
        entry({ queuePosition: 1 }),
        entry({
          queuePosition: 2,
          startDate: '2026-08-29T14:00:00Z',
          finishDate: '2026-08-29T16:00:00Z',
        }),
      ]),
    ).toEqual([
      { queuePosition: 0, flex: 2 / 3 },
      { queuePosition: 2, flex: 1 / 3 },
    ])
  })
})

describe('formatQueueDuration', () => {
  it.each([
    [null, 'UNSCHEDULED'],
    [0, 'DONE'],
    [-1, 'DONE'],
    [45 * 60_000, '45m'],
    [90 * 60_000, '1h 30m'],
    [50 * 60 * 60_000, '2d 2h'],
  ])('formats %s as %s', (milliseconds, expected) => {
    expect(formatQueueDuration(milliseconds)).toBe(expected)
  })
})

describe('romanLevel', () => {
  it('renders trained levels as roman numerals', () => {
    expect([0, 1, 2, 3, 4, 5].map(romanLevel)).toEqual(['0', 'I', 'II', 'III', 'IV', 'V'])
  })
})
