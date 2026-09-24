import { describe, expect, it, vi } from 'vitest'
import type { MailHeader, MailLabel } from '../../app/queries/mail'
import { formatRelativeTime } from '../../app/utils/format'
import {
  applyMailOverlays,
  appendUniqueMailHeaders,
  deriveDisplayedMailCounts,
  deriveMailboxStatus,
  filterDisplayedMailHeaders,
  filterLoadedMailHeaders,
  isMailUnread,
  mailPartyName,
  mergePaginatedMailHeaders,
  reconcileMailLabelOverrides,
  reconcileMailReadOverrides,
  removeMailLabelIds,
  scheduleMailReadDwell,
  splitMailBodyParagraphs,
} from '../../app/utils/mail-view'
import { ApiQueryError } from '../../app/utils/query-error'

describe('mail frontend behavior', () => {
  it('filters only loaded headers by subject, sender, known-unread state, and list recipients', () => {
    const recipientMatch = mailHeader(1, {
      isRead: false,
      recipients: [{ id: 77, name: 'Alliance Logistics', type: 'mailing_list' }],
      sender: { id: 10, name: 'Alice', type: 'character' },
      subject: 'Fuel request',
    })
    const senderOnlyMatch = mailHeader(2, {
      isRead: false,
      recipients: [{ id: 11, name: 'Bob', type: 'character' }],
      sender: { id: 77, name: 'Alliance Logistics', type: 'unknown' },
      subject: 'Unrelated post',
    })
    const unknownReadState = mailHeader(3, {
      isRead: null,
      recipients: [{ id: 77, name: null, type: 'mailing_list' }],
      sender: { id: 12, name: 'Carol', type: 'character' },
      subject: 'Fuel follow-up',
    })

    expect(
      filterLoadedMailHeaders([recipientMatch, senderOnlyMatch, unknownReadState], {
        mailingListId: 77,
        search: 'fuel',
        unreadOnly: true,
      }).map((header) => header.mailId),
    ).toStrictEqual([1, 3])
    expect(
      filterLoadedMailHeaders([recipientMatch, senderOnlyMatch], {
        mailingListId: 77,
        search: '',
        unreadOnly: false,
      }).map((header) => header.mailId),
    ).toStrictEqual([1])
  })

  it('treats an absent ESI read flag as unread', () => {
    expect(isMailUnread(true)).toBe(false)
    expect(isMailUnread(false)).toBe(true)
    expect(isMailUnread(null)).toBe(true)
  })

  it('formats relative mail times against an explicit clock', () => {
    const now = Date.parse('2026-08-28T12:00:00.000Z')

    expect(formatRelativeTime('2026-08-28T11:55:00.000Z', now)).toBe('5 minutes ago')
    expect(formatRelativeTime('2026-08-28T11:54:00.000Z', now)).toBe('6 minutes ago')
    expect(formatRelativeTime(null, now)).toBe('Time unknown')
  })

  it('appends older pages, removes duplicate IDs, and retains the existing record', () => {
    const retained = mailHeader(2, { subject: 'Retained' })
    const duplicate = mailHeader(2, { subject: 'Older duplicate' })
    const result = appendUniqueMailHeaders([mailHeader(1), retained], [duplicate, mailHeader(3)])

    expect(result.map((header) => header.mailId)).toStrictEqual([1, 2, 3])
    expect(result[1]).toBe(retained)
  })

  it('preserves older pages when the latest page refreshes', () => {
    const oldLatest = mailHeader(2, { subject: 'Old latest copy' })
    const older = mailHeader(1, { subject: 'Older page' })
    const refreshed = mailHeader(2, { subject: 'Refreshed latest copy' })
    const newest = mailHeader(3, { subject: 'New arrival' })

    const result = mergePaginatedMailHeaders([oldLatest, older], [newest, refreshed])

    expect(result.map((header) => header.mailId)).toStrictEqual([3, 2, 1])
    expect(result[1]).toBe(refreshed)
  })

  it('retains read overrides through stale headers and releases them on agreement', () => {
    const staleHeader = mailHeader(1, { isRead: false })
    const overrides = new Map([[1, true]])

    expect(applyMailOverlays([staleHeader], overrides, new Set(), new Map())[0]?.isRead).toBe(true)
    const retained = reconcileMailReadOverrides([staleHeader], overrides)
    expect(retained).toBe(overrides)
    expect(retained.get(1)).toBe(true)

    const reconciled = reconcileMailReadOverrides([mailHeader(1, { isRead: true })], retained)
    expect(reconciled.has(1)).toBe(false)
    expect(
      applyMailOverlays([mailHeader(1, { isRead: true })], reconciled, new Set(), new Map())[0]
        ?.isRead,
    ).toBe(true)
  })

  it('treats an absent read flag as agreement with a local unread override', () => {
    const reconciled = reconcileMailReadOverrides(
      [mailHeader(1, { isRead: null })],
      new Map([[1, false]]),
    )

    expect(reconciled.has(1)).toBe(false)
  })

  it('keeps a deleted message absent while stale headers still include it', () => {
    const staleHeaders = [mailHeader(1), mailHeader(2)]

    expect(
      applyMailOverlays(staleHeaders, new Map(), new Set([1]), new Map()).map(
        ({ mailId }) => mailId,
      ),
    ).toStrictEqual([2])
  })

  it('removes deleted labels from stale mail without replacing unchanged records', () => {
    const staleHeader = mailHeader(1, { labelIds: [1, 2] })
    const unchangedHeader = mailHeader(2, { labelIds: [1] })
    const deletedLabelIds = new Set([2])

    expect(removeMailLabelIds(staleHeader, deletedLabelIds).labelIds).toStrictEqual([1])
    expect(removeMailLabelIds(unchangedHeader, deletedLabelIds)).toBe(unchangedHeader)
  })

  it('adjusts every message label and the total for read changes in both directions', () => {
    const labels: MailLabel[] = [mailLabel(1, 4), mailLabel(2, 3), mailLabel(3, 2)]
    const unreadHeader = mailHeader(1, { isRead: false, labelIds: [1, 2] })
    const readCounts = deriveDisplayedMailCounts({
      deletedMailIds: new Set(),
      headers: [unreadHeader],
      labelOverrides: new Map(),
      labels,
      readStateOverrides: new Map([[1, true]]),
      totalUnreadCount: 6,
    })

    expect(readCounts.labels.map(({ unreadCount }) => unreadCount)).toStrictEqual([3, 2, 2])
    expect(readCounts.totalUnreadCount).toBe(5)

    const unreadCounts = deriveDisplayedMailCounts({
      deletedMailIds: new Set(),
      headers: [mailHeader(1, { isRead: true, labelIds: [1, 2] })],
      labelOverrides: new Map(),
      labels,
      readStateOverrides: new Map([[1, false]]),
      totalUnreadCount: 6,
    })
    expect(unreadCounts.labels.map(({ unreadCount }) => unreadCount)).toStrictEqual([5, 4, 2])
    expect(unreadCounts.totalUnreadCount).toBe(7)
  })

  it('corrects unread counts while an unread message deletion is pending', () => {
    const counts = deriveDisplayedMailCounts({
      deletedMailIds: new Set([1]),
      headers: [mailHeader(1, { isRead: false, labelIds: [1, 2] })],
      labelOverrides: new Map(),
      labels: [mailLabel(1, 1), mailLabel(2, 1)],
      readStateOverrides: new Map(),
      totalUnreadCount: 1,
    })

    expect(counts.labels.map(({ unreadCount }) => unreadCount)).toStrictEqual([0, 0])
    expect(counts.totalUnreadCount).toBe(0)
  })

  it('retains label overrides through stale data and releases them on set agreement', () => {
    const staleHeader = mailHeader(1, { labelIds: [1] })
    const overrides = new Map<number, readonly number[]>([[1, [1, 2]]])

    expect(
      applyMailOverlays([staleHeader], new Map(), new Set(), overrides)[0]?.labelIds,
    ).toStrictEqual([1, 2])
    expect(reconcileMailLabelOverrides([staleHeader], overrides)).toBe(overrides)

    const reconciled = reconcileMailLabelOverrides([mailHeader(1, { labelIds: [2, 1] })], overrides)
    expect(reconciled.has(1)).toBe(false)
  })

  it('moves unread contributions between labels without changing the total', () => {
    const counts = deriveDisplayedMailCounts({
      deletedMailIds: new Set(),
      headers: [mailHeader(1, { isRead: false, labelIds: [1] })],
      labelOverrides: new Map([[1, [2]]]),
      labels: [mailLabel(1, 1), mailLabel(2, 0)],
      readStateOverrides: new Map(),
      totalUnreadCount: 1,
    })

    expect(counts.labels.map(({ unreadCount }) => unreadCount)).toStrictEqual([0, 1])
    expect(counts.totalUnreadCount).toBe(1)
  })

  it('leaves counts unchanged when a read message is relabelled', () => {
    const counts = deriveDisplayedMailCounts({
      deletedMailIds: new Set(),
      headers: [mailHeader(1, { isRead: true, labelIds: [1] })],
      labelOverrides: new Map([[1, [2]]]),
      labels: [mailLabel(1, 3), mailLabel(2, 4)],
      readStateOverrides: new Map(),
      totalUnreadCount: 5,
    })

    expect(counts.labels.map(({ unreadCount }) => unreadCount)).toStrictEqual([3, 4])
    expect(counts.totalUnreadCount).toBe(5)
  })

  it('composes pending read and label changes from their final contributions', () => {
    const counts = deriveDisplayedMailCounts({
      deletedMailIds: new Set(),
      headers: [mailHeader(1, { isRead: false, labelIds: [1] })],
      labelOverrides: new Map([[1, [2]]]),
      labels: [mailLabel(1, 1), mailLabel(2, 0)],
      readStateOverrides: new Map([[1, true]]),
      totalUnreadCount: 1,
    })

    expect(counts.labels.map(({ unreadCount }) => unreadCount)).toStrictEqual([0, 0])
    expect(counts.totalUnreadCount).toBe(0)
  })

  it('pins only the open message through the unread display filter', () => {
    const headers = [
      mailHeader(1, { isRead: true, subject: 'Open message' }),
      mailHeader(2, { isRead: false, subject: 'Next message' }),
    ]
    const filters = { mailingListId: null, search: '', unreadOnly: true }

    expect(
      filterDisplayedMailHeaders(headers, filters, 1).map(({ mailId }) => mailId),
    ).toStrictEqual([1, 2])
    expect(
      filterDisplayedMailHeaders(headers, filters, 2).map(({ mailId }) => mailId),
    ).toStrictEqual([2])
    expect(filterLoadedMailHeaders(headers, filters).map(({ mailId }) => mailId)).toStrictEqual([2])
  })

  it('cancels read writes while traversing faster than the dwell interval', async () => {
    vi.useFakeTimers()
    const write = vi.fn()
    try {
      const cancelFirst = scheduleMailReadDwell(write)
      await vi.advanceTimersByTimeAsync(300)
      cancelFirst()
      const cancelSecond = scheduleMailReadDwell(write)
      await vi.advanceTimersByTimeAsync(300)
      cancelSecond()
      await vi.runAllTimersAsync()

      expect(write).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps hostile body text inert while splitting only on blank lines', () => {
    const hostile = '<img src=x onerror=alert(1)>\nline two\n\n<a href="javascript:x">link</a>'

    expect(splitMailBodyParagraphs(hostile)).toStrictEqual([
      '<img src=x onerror=alert(1)>\nline two',
      '<a href="javascript:x">link</a>',
    ])
    expect(splitMailBodyParagraphs(null)).toStrictEqual([])
  })

  it('derives loading, authorization, cooldown, temporary failure, and retained-data states', () => {
    expect(deriveMailboxStatus({ errors: [], hasInitialData: false, loading: true })).toBe(
      'loading',
    )
    expect(
      deriveMailboxStatus({
        errors: [new ApiQueryError('Authorize mail.', { code: 'EVE_SCOPE_REQUIRED', status: 403 })],
        hasInitialData: false,
        loading: false,
      }),
    ).toBe('scope-required')
    expect(
      deriveMailboxStatus({
        errors: [new ApiQueryError('Wait.', { code: 'ESI_COOLDOWN', status: 429 })],
        hasInitialData: false,
        loading: false,
      }),
    ).toBe('cooldown')
    expect(
      deriveMailboxStatus({
        errors: [new TypeError('network')],
        hasInitialData: false,
        loading: false,
      }),
    ).toBe('error')
    expect(
      deriveMailboxStatus({
        errors: [new TypeError('refresh failed')],
        hasInitialData: true,
        loading: false,
      }),
    ).toBe('idle')
  })

  it('renders deterministic unresolved-party labels', () => {
    expect(mailPartyName(null, 'sender')).toBe('Unknown sender')
    expect(mailPartyName({ id: 77, name: null, type: 'mailing_list' })).toBe(
      'Unknown mailing list #77',
    )
  })
})

function mailHeader(mailId: number, overrides: Partial<MailHeader> = {}): MailHeader {
  return {
    isRead: true,
    labelIds: [],
    mailId,
    recipients: [],
    sender: null,
    sentAt: '2026-08-28T12:00:00.000Z',
    subject: `Message ${mailId}`,
    ...overrides,
  }
}

function mailLabel(labelId: number, unreadCount: number): MailLabel {
  return { color: '#ffffff', labelId, name: `Label ${labelId}`, unreadCount }
}
