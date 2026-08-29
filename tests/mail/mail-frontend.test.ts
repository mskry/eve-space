import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  reconcileMailReadOverrides,
  scheduleMailReadDwell,
  splitMailBodyParagraphs,
} from '../../app/utils/mail-view'
import { ApiQueryError } from '../../app/utils/query-error'

const readWorkspaceFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('mail frontend behavior', () => {
  it('filters only loaded headers by subject, sender, known-unread state, and list recipients', () => {
    const recipientMatch = mailHeader(1, {
      isRead: false,
      recipients: [{ id: 77, type: 'mailing_list', name: 'Alliance Logistics' }],
      sender: { id: 10, type: 'character', name: 'Alice' },
      subject: 'Fuel request',
    })
    const senderOnlyMatch = mailHeader(2, {
      isRead: false,
      recipients: [{ id: 11, type: 'character', name: 'Bob' }],
      sender: { id: 77, type: 'unknown', name: 'Alliance Logistics' },
      subject: 'Unrelated post',
    })
    const unknownReadState = mailHeader(3, {
      isRead: null,
      recipients: [{ id: 77, type: 'mailing_list', name: null }],
      sender: { id: 12, type: 'character', name: 'Carol' },
      subject: 'Fuel follow-up',
    })

    expect(
      filterLoadedMailHeaders([recipientMatch, senderOnlyMatch, unknownReadState], {
        mailingListId: 77,
        search: 'fuel',
        unreadOnly: true,
      }).map((header) => header.mailId),
    ).toEqual([1, 3])
    expect(
      filterLoadedMailHeaders([recipientMatch, senderOnlyMatch], {
        mailingListId: 77,
        search: '',
        unreadOnly: false,
      }).map((header) => header.mailId),
    ).toEqual([1])
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

    expect(result.map((header) => header.mailId)).toEqual([1, 2, 3])
    expect(result[1]).toBe(retained)
  })

  it('preserves older pages when the latest page refreshes', () => {
    const oldLatest = mailHeader(2, { subject: 'Old latest copy' })
    const older = mailHeader(1, { subject: 'Older page' })
    const refreshed = mailHeader(2, { subject: 'Refreshed latest copy' })
    const newest = mailHeader(3, { subject: 'New arrival' })

    const result = mergePaginatedMailHeaders([oldLatest, older], [newest, refreshed])

    expect(result.map((header) => header.mailId)).toEqual([3, 2, 1])
    expect(result[1]).toBe(refreshed)
  })

  it('retains read overrides through stale headers and releases them on agreement', () => {
    const staleHeader = mailHeader(1, { isRead: false })
    const overrides = new Map([[1, true]])

    expect(applyMailOverlays([staleHeader], overrides, new Set())[0]?.isRead).toBe(true)
    const retained = reconcileMailReadOverrides([staleHeader], overrides)
    expect(retained).toBe(overrides)
    expect(retained.get(1)).toBe(true)

    const reconciled = reconcileMailReadOverrides([mailHeader(1, { isRead: true })], retained)
    expect(reconciled.has(1)).toBe(false)
    expect(
      applyMailOverlays([mailHeader(1, { isRead: true })], reconciled, new Set())[0]?.isRead,
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
      applyMailOverlays(staleHeaders, new Map(), new Set([1])).map(({ mailId }) => mailId),
    ).toEqual([2])
  })

  it('adjusts every message label and the total for read changes in both directions', () => {
    const labels: MailLabel[] = [mailLabel(1, 4), mailLabel(2, 3), mailLabel(3, 2)]
    const unreadHeader = mailHeader(1, { isRead: false, labelIds: [1, 2] })
    const readCounts = deriveDisplayedMailCounts({
      deletedMailIds: new Set(),
      headers: [unreadHeader],
      labels,
      readStateOverrides: new Map([[1, true]]),
      totalUnreadCount: 6,
    })

    expect(readCounts.labels.map(({ unreadCount }) => unreadCount)).toEqual([3, 2, 2])
    expect(readCounts.totalUnreadCount).toBe(5)

    const unreadCounts = deriveDisplayedMailCounts({
      deletedMailIds: new Set(),
      headers: [mailHeader(1, { isRead: true, labelIds: [1, 2] })],
      labels,
      readStateOverrides: new Map([[1, false]]),
      totalUnreadCount: 6,
    })
    expect(unreadCounts.labels.map(({ unreadCount }) => unreadCount)).toEqual([5, 4, 2])
    expect(unreadCounts.totalUnreadCount).toBe(7)
  })

  it('corrects unread counts while an unread message deletion is pending', () => {
    const counts = deriveDisplayedMailCounts({
      deletedMailIds: new Set([1]),
      headers: [mailHeader(1, { isRead: false, labelIds: [1, 2] })],
      labels: [mailLabel(1, 1), mailLabel(2, 1)],
      readStateOverrides: new Map(),
      totalUnreadCount: 1,
    })

    expect(counts.labels.map(({ unreadCount }) => unreadCount)).toEqual([0, 0])
    expect(counts.totalUnreadCount).toBe(0)
  })

  it('pins only the open message through the unread display filter', () => {
    const headers = [
      mailHeader(1, { isRead: true, subject: 'Open message' }),
      mailHeader(2, { isRead: false, subject: 'Next message' }),
    ]
    const filters = { mailingListId: null, search: '', unreadOnly: true }

    expect(filterDisplayedMailHeaders(headers, filters, 1).map(({ mailId }) => mailId)).toEqual([
      1, 2,
    ])
    expect(filterDisplayedMailHeaders(headers, filters, 2).map(({ mailId }) => mailId)).toEqual([2])
    expect(filterLoadedMailHeaders(headers, filters).map(({ mailId }) => mailId)).toEqual([2])
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

    expect(splitMailBodyParagraphs(hostile)).toEqual([
      '<img src=x onerror=alert(1)>\nline two',
      '<a href="javascript:x">link</a>',
    ])
    expect(splitMailBodyParagraphs(null)).toEqual([])

    const component = readWorkspaceFile('app/components/mail/MailBodyText.vue')
    expect(component).toContain('{{ paragraph }}')
    expect(component).not.toContain('v-html')
    expect(component).not.toContain('innerHTML')
  })

  it('derives loading, authorization, cooldown, temporary failure, and retained-data states', () => {
    expect(deriveMailboxStatus({ errors: [], hasInitialData: false, loading: true })).toBe(
      'loading',
    )
    expect(
      deriveMailboxStatus({
        errors: [new ApiQueryError('Authorize mail.', { status: 403, code: 'EVE_SCOPE_REQUIRED' })],
        hasInitialData: false,
        loading: false,
      }),
    ).toBe('scope-required')
    expect(
      deriveMailboxStatus({
        errors: [new ApiQueryError('Wait.', { status: 429, code: 'ESI_COOLDOWN' })],
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
    expect(mailPartyName({ id: 77, type: 'mailing_list', name: null })).toBe(
      'Unknown mailing list #77',
    )
  })

  it('keeps every mail query behind the client/auth/character gate and ownership parent', () => {
    const mailbox = readWorkspaceFile('app/composables/useCharacterMailbox.ts')
    const parent = readWorkspaceFile('app/pages/characters/[characterId].vue')
    const gateCalls = mailbox.match(/canRunProtectedQuery\(/g) ?? []

    expect(gateCalls).toHaveLength(1)
    expect(mailbox).toContain('requestedCursor.value !== null')
    expect(mailbox).toContain('nextLastMailId.value === requestedCursor.value')
    expect(mailbox).toContain('selectedMailId.value !== null')
    expect(parent.indexOf('v-else-if="selectedCharacter"')).toBeLessThan(
      parent.indexOf('<NuxtPage'),
    )
  })

  it('keeps label selection in query state and other filters in loaded-header view state', () => {
    const page = readWorkspaceFile('app/pages/characters/[characterId]/mail.vue')
    const mailbox = readWorkspaceFile('app/composables/useCharacterMailbox.ts')
    const view = readWorkspaceFile('app/utils/mail-view.ts')

    expect(mailbox).toContain('labels: selectedLabels.value')
    expect(mailbox).toContain('filterDisplayedMailHeaders(')
    expect(mailbox).toContain('displayedHeaders.value')
    expect(view).not.toMatch(/labelIds\.includes|activeLabel/)
    expect(mailbox).toContain('No matches in loaded messages. Load older messages')
    expect(mailbox).toContain('There are no messages in this folder.')
    expect(page).toContain('title="Mailbox empty"')
  })

  it('uses a scroll area in every pane and exposes composition and organization actions', () => {
    const sidebar = readWorkspaceFile('app/components/mail/MailLabelSidebar.vue')
    const headers = readWorkspaceFile('app/components/mail/MailHeaderList.vue')
    const reader = readWorkspaceFile('app/components/mail/MailReader.vue')
    const page = readWorkspaceFile('app/pages/characters/[characterId]/mail.vue')
    const provider = readWorkspaceFile('layers/ui/app/components/ui/UiProvider.vue')

    for (const component of [sidebar, headers, reader]) {
      expect(component).toContain('<UiScrollArea')
    }
    expect(sidebar).toContain('@click="$emit(\'compose\')"')
    expect(reader).toContain('@click="emit(\'reply\')"')
    expect(reader).toContain('@click="emit(\'replyAll\')"')
    expect(reader).toContain('@click="emit(\'forward\')"')
    expect(reader).toContain("emit('changeRead', isMailUnread(readState))")
    expect(reader).toContain('@click="emit(\'delete\')"')
    expect(page).not.toContain('<UiConfirmDialog')
    expect(page).not.toContain('<UiToast')
    expect(provider).toContain('<UiConfirmDialog')
    expect(provider).toContain('<UiToast')
  })

  it('keeps the mailbox workspace visible with pane-specific loading skeletons', () => {
    const headers = readWorkspaceFile('app/components/mail/MailHeaderList.vue')
    const reader = readWorkspaceFile('app/components/mail/MailReader.vue')
    const page = readWorkspaceFile('app/pages/characters/[characterId]/mail.vue')
    const css = readWorkspaceFile('app/assets/css/features/mail.css')

    expect(page).not.toContain('class="app-scanner"')
    expect(page).toContain(':loading="showMailboxSkeleton"')
    expect(page).toContain('showMailboxSkeleton || detailQuery.asyncStatus.value')
    expect(headers).toContain('class="mail-header-skeleton"')
    expect(reader).toContain('class="mail-reader-skeleton"')
    expect(css).toContain('@keyframes mail-skeleton-scan')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('keeps automatic reads quiet, requires readable detail, and resets destructive state', () => {
    const mailbox = readWorkspaceFile('app/composables/useCharacterMailbox.ts')
    const organization = readWorkspaceFile('app/composables/useMailOrganization.ts')

    expect(organization).toContain('detail?.mailId !== mailId')
    expect(organization).toContain('detailFailure')
    expect(organization).toContain('changeMailRead(header, true, false)')
    expect(organization).toContain('openConfirmDialog({')
    expect(organization).not.toContain('deleteDialogOpen')
    expect(organization).not.toContain('deleteCandidate')
    expect(organization).toContain('options.mailbox.displayedHeaders.value.find(')
    expect(organization).toContain('readPendingIds.value.has(mailId)')
    expect(mailbox).toContain('loadedHeaders.value.length === 0')
  })

  it('styles the mail feature only through semantic UI color tokens', () => {
    const page = readWorkspaceFile('app/pages/characters/[characterId]/mail.vue')
    const css = readWorkspaceFile('app/assets/css/features/mail.css')
    const authorization = readWorkspaceFile('app/components/character/AuthorizationRequired.vue')
    const variables = [...css.matchAll(/var\((--[^),\s]+)/g)].map((match) => match[1])

    expect(page).toContain('<CharacterAuthorizationRequired')
    expect(page).toContain('<UiStatePanel')
    expect(page).not.toMatch(/mail-access-state|skills-access-state/)
    expect(authorization).toContain('var(--ui-border)')
    expect(authorization).toContain('var(--ui-surface)')
    expect(css).toContain('height: clamp(36rem, 68vh, 46rem)')
    expect(variables.length).toBeGreaterThan(0)
    expect(variables.every((variable) => variable.startsWith('--ui-'))).toBe(true)
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i)
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
