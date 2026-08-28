import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MailHeader } from '../../app/queries/mail'
import {
  appendUniqueMailHeaders,
  deriveMailboxStatus,
  filterLoadedMailHeaders,
  isMailUnread,
  mailPartyName,
  mergeLatestMailHeaders,
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

    const result = mergeLatestMailHeaders([oldLatest, older], [newest, refreshed], true)

    expect(result.map((header) => header.mailId)).toEqual([3, 2, 1])
    expect(result[1]).toBe(refreshed)
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
    const page = readWorkspaceFile('app/pages/characters/[characterId]/mail.vue')
    const parent = readWorkspaceFile('app/pages/characters/[characterId].vue')
    const gateCalls = page.match(/canRunProtectedQuery\(/g) ?? []

    expect(gateCalls).toHaveLength(5)
    expect(page).toContain('requestedCursor.value !== null')
    expect(page).toContain('nextLastMailId.value === requestedCursor.value')
    expect(page).toContain('selectedMailId.value !== null')
    expect(parent.indexOf('v-else-if="selectedCharacter"')).toBeLessThan(
      parent.indexOf('<NuxtPage'),
    )
  })

  it('keeps label selection in query state and other filters in loaded-header view state', () => {
    const page = readWorkspaceFile('app/pages/characters/[characterId]/mail.vue')
    const view = readWorkspaceFile('app/utils/mail-view.ts')

    expect(page).toContain('labels: selectedLabels.value')
    expect(page).toContain('filterLoadedMailHeaders(loadedHeaders.value')
    expect(view).not.toMatch(/labelIds\.includes|activeLabel/)
    expect(page).toContain('No matches in loaded messages. Load older messages')
    expect(page).toContain('There are no messages in this folder.')
    expect(page).toContain('<h2>Mailbox empty</h2>')
  })

  it('uses a scroll area in every pane and keeps all read actions inert', () => {
    const sidebar = readWorkspaceFile('app/components/mail/MailLabelSidebar.vue')
    const headers = readWorkspaceFile('app/components/mail/MailHeaderList.vue')
    const reader = readWorkspaceFile('app/components/mail/MailReader.vue')

    for (const component of [sidebar, headers, reader]) {
      expect(component).toContain('<UiScrollArea')
    }
    expect(sidebar).toContain('<button class="ui-action-primary" type="button" disabled>COMPOSE')
    expect(reader).toContain('<button type="button" disabled>REPLY</button>')
    expect(reader).toContain('<button type="button" disabled>FORWARD</button>')
    expect(reader).toContain('<button type="button" disabled>DELETE</button>')
  })

  it('styles the mail feature only through semantic UI color tokens', () => {
    const page = readWorkspaceFile('app/pages/characters/[characterId]/mail.vue')
    const css = readWorkspaceFile('app/assets/css/features/mail.css')
    const variables = [...css.matchAll(/var\((--[^),\s]+)/g)].map((match) => match[1])

    expect(page).toContain('class="mail-access-state"')
    expect(page).not.toContain('skills-access-state')
    expect(css).toContain('.mail-access-state {')
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
