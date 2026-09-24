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
    finishDate: null,
    finishedLevel: 5,
    groupId: 255,
    groupName: 'Gunnery',
    levelEndSp: 512_000,
    levelStartSp: 256_000,
    name: `Skill ${overrides.queuePosition}`,
    primaryAttribute: 'perception',
    secondaryAttribute: 'willpower',
    startDate: null,
    trainingStartSp: 256_000,
    typeId: 3300 + overrides.queuePosition,
    ...overrides,
  }
}

// Mirrors the API's resolveSkillQueueState case table; both implementations must agree.
describe('resolveSkillQueueState', () => {
  it('reports an empty queue', () => {
    expect(resolveSkillQueueState([], now)).toStrictEqual({
      activeQueuePosition: null,
      state: 'empty',
    })
  })

  it('reports a paused queue when no entry carries a start date', () => {
    expect(
      resolveSkillQueueState([entry({ queuePosition: 0 }), entry({ queuePosition: 1 })], now),
    ).toStrictEqual({ activeQueuePosition: null, state: 'paused' })
  })

  it('reports a lapsed queue when every entry finished in the past', () => {
    expect(
      resolveSkillQueueState(
        [
          entry({
            finishDate: '2026-08-28T10:00:00Z',
            queuePosition: 0,
            startDate: '2026-08-27T10:00:00Z',
          }),
          entry({
            finishDate: '2026-08-29T10:00:00Z',
            queuePosition: 1,
            startDate: '2026-08-28T10:00:00Z',
          }),
        ],
        now,
      ),
    ).toStrictEqual({ activeQueuePosition: null, state: 'lapsed' })
  })

  it('identifies the first unfinished entry as the one training', () => {
    expect(
      resolveSkillQueueState(
        [
          entry({
            finishDate: '2026-08-29T10:00:00Z',
            queuePosition: 0,
            startDate: '2026-08-28T10:00:00Z',
          }),
          entry({
            finishDate: '2026-08-29T18:00:00Z',
            queuePosition: 1,
            startDate: '2026-08-29T10:00:00Z',
          }),
          entry({
            finishDate: '2026-08-30T18:00:00Z',
            queuePosition: 2,
            startDate: '2026-08-29T18:00:00Z',
          }),
        ],
        now,
      ),
    ).toStrictEqual({ activeQueuePosition: 1, state: 'training' })
  })

  it('does not report a lapsed queue while an entry has no finish date', () => {
    expect(
      resolveSkillQueueState(
        [
          entry({
            finishDate: '2026-08-29T10:00:00Z',
            queuePosition: 0,
            startDate: '2026-08-28T10:00:00Z',
          }),
          entry({ queuePosition: 1, startDate: '2026-08-29T10:00:00Z' }),
        ],
        now,
      ),
    ).toStrictEqual({ activeQueuePosition: 1, state: 'training' })
  })

  it('advances from training to lapsed as the clock passes the last finish date', () => {
    const entries = [
      entry({
        finishDate: '2026-08-29T14:00:00Z',
        queuePosition: 0,
        startDate: '2026-08-29T10:00:00Z',
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
        entry({ finishedLevel: 3, queuePosition: 0, typeId: 3300 }),
        entry({ finishedLevel: 5, queuePosition: 1, typeId: 3300 }),
        entry({ finishedLevel: 2, queuePosition: 2, typeId: 3301 }),
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
          finishDate: '2026-08-29T14:00:00Z',
          queuePosition: 0,
          startDate: '2026-08-29T10:00:00Z',
          trainingStartSp: 504_800,
        }),
      ),
    ).toBe(30)
  })

  it('does not claim a rate without complete SP and timing boundaries', () => {
    expect(trainingRatePerMinute(entry({ queuePosition: 0 }))).toBeNull()
    expect(
      trainingRatePerMinute(
        entry({
          finishDate: '2026-08-29T14:00:00Z',
          queuePosition: 0,
          startDate: '2026-08-29T10:00:00Z',
          trainingStartSp: null,
        }),
      ),
    ).toBeNull()
  })
})

describe('entry timing', () => {
  it('reports remaining and total duration from the entry timestamps', () => {
    const training = entry({
      finishDate: '2026-08-29T14:00:00Z',
      queuePosition: 0,
      startDate: '2026-08-29T10:00:00Z',
    })

    expect(entryRemainingMs(training, now)).toBe(2 * 60 * 60_000)
    expect(entryDurationMs(training)).toBe(4 * 60 * 60_000)
  })

  it('clamps a finished entry to zero rather than reporting negative time', () => {
    const finished = entry({
      finishDate: '2026-08-29T10:00:00Z',
      queuePosition: 0,
      startDate: '2026-08-28T10:00:00Z',
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
          finishDate: '2026-08-29T14:00:00Z',
          queuePosition: 0,
          startDate: '2026-08-29T10:00:00Z',
        }),
        now,
      ),
    ).toStrictEqual({ currentSp: 384_000, percent: 50, targetSp: 512_000 })
  })

  it('interpolates resumed training from training SP into full-level progress', () => {
    expect(
      entryProgress(
        entry({
          finishDate: '2026-08-29T14:00:00Z',
          queuePosition: 0,
          startDate: '2026-08-29T10:00:00Z',
          trainingStartSp: 384_000,
        }),
        now,
      ),
    ).toStrictEqual({ currentSp: 448_000, percent: 75, targetSp: 512_000 })
  })

  it('does not derive current SP from the rounded display percent', () => {
    expect(
      entryProgress(
        entry({
          finishDate: '2026-08-29T13:00:00Z',
          queuePosition: 0,
          startDate: '2026-08-29T10:00:00Z',
          trainingStartSp: 256_001,
        }),
        now,
      ),
    ).toStrictEqual({ currentSp: 426_667, percent: 67, targetSp: 512_000 })
  })

  it('reports no progress for an undated entry', () => {
    expect(entryProgress(entry({ queuePosition: 0 }), now)).toStrictEqual({
      currentSp: 256_000,
      percent: 0,
      targetSp: 512_000,
    })
  })

  it('omits skill points when the upstream did not provide the level boundaries', () => {
    expect(
      entryProgress(
        entry({
          finishDate: '2026-08-29T14:00:00Z',
          levelEndSp: null,
          levelStartSp: null,
          queuePosition: 0,
          startDate: '2026-08-29T10:00:00Z',
        }),
        now,
      ),
    ).toStrictEqual({ currentSp: null, percent: 50, targetSp: null })
  })
})

describe('queue totals', () => {
  it('reports time until the last dated entry finishes', () => {
    expect(
      queueRemainingMs(
        [
          entry({
            finishDate: '2026-08-29T14:00:00Z',
            queuePosition: 0,
            startDate: '2026-08-29T10:00:00Z',
          }),
          entry({
            finishDate: '2026-08-31T12:00:00Z',
            queuePosition: 1,
            startDate: '2026-08-29T14:00:00Z',
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
            finishDate: '2026-08-29T14:00:00Z',
            queuePosition: 0,
            startDate: '2026-08-29T10:00:00Z',
          }),
          entry({
            finishDate: '2026-08-29T18:00:00Z',
            queuePosition: 1,
            startDate: '2026-08-29T14:00:00Z',
          }),
        ],
        now,
      ),
    ).toBe(384_000)
  })

  it('reports no skill-point total when queue boundaries are unavailable', () => {
    expect(
      queueRemainingSp([entry({ levelEndSp: null, levelStartSp: null, queuePosition: 0 })], now),
    ).toBeNull()
  })

  it('does not present a partial total when one queue entry lacks boundaries', () => {
    expect(
      queueRemainingSp(
        [
          entry({ queuePosition: 0 }),
          entry({ levelEndSp: null, levelStartSp: null, queuePosition: 1 }),
        ],
        now,
      ),
    ).toBeNull()
  })

  it('builds proportional segments and skips undated entries', () => {
    expect(
      queueSegments([
        entry({
          finishDate: '2026-08-29T14:00:00Z',
          queuePosition: 0,
          startDate: '2026-08-29T10:00:00Z',
        }),
        entry({ queuePosition: 1 }),
        entry({
          finishDate: '2026-08-29T16:00:00Z',
          queuePosition: 2,
          startDate: '2026-08-29T14:00:00Z',
        }),
      ]),
    ).toStrictEqual([
      { flex: 2 / 3, queuePosition: 0 },
      { flex: 1 / 3, queuePosition: 2 },
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
    expect([0, 1, 2, 3, 4, 5].map(romanLevel)).toStrictEqual(['0', 'I', 'II', 'III', 'IV', 'V'])
  })
})
