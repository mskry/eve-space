import { describe, expect, it } from 'vitest'
import { formatSettingsTimestamp } from '../../app/utils/settings-timestamp'

describe('settings timestamp formatting', () => {
  it('preserves locale date and time presentation', () => {
    const timestamp = '2026-09-13T12:34:00.000Z'

    expect(formatSettingsTimestamp(timestamp, 'Missing')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(timestamp),
      ),
    )
  })

  it.each([
    [null, 'Not collected'],
    ['', 'Not recorded'],
    ['not-a-timestamp', 'Unavailable'],
  ])('returns caller-provided empty text for %j', (timestamp, emptyText) => {
    expect(formatSettingsTimestamp(timestamp, emptyText)).toBe(emptyText)
  })
})
