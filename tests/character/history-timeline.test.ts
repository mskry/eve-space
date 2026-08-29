import { describe, expect, it } from 'vitest'
import { buildHistoryTimeline } from '../../app/utils/history-timeline'

describe('buildHistoryTimeline', () => {
  it('sorts newest first and derives each completed period without mutating the source', () => {
    const history = [
      { id: 1, startDate: '2020-01-01T00:00:00Z' },
      { id: 3, startDate: '2024-01-01T00:00:00Z' },
      { id: 2, startDate: '2022-01-01T00:00:00Z' },
    ]

    expect(buildHistoryTimeline(history)).toEqual([
      { id: 3, startDate: '2024-01-01T00:00:00Z', endDate: undefined },
      {
        id: 2,
        startDate: '2022-01-01T00:00:00Z',
        endDate: '2024-01-01T00:00:00Z',
      },
      {
        id: 1,
        startDate: '2020-01-01T00:00:00Z',
        endDate: '2022-01-01T00:00:00Z',
      },
    ])
    expect(history.map((entry) => entry.id)).toEqual([1, 3, 2])
  })
})
