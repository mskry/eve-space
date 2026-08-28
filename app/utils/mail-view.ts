import type { MailHeader, MailParty } from '../queries/mail'
import { ApiQueryError } from './query-error'

export interface MailFilters {
  mailingListId: number | null
  search: string
  unreadOnly: boolean
}

export type MailboxStatus = 'cooldown' | 'error' | 'idle' | 'loading' | 'scope-required'

// ESI omits is_read for unread headers, so true is the only read state.
export function isMailUnread(isRead: MailHeader['isRead']) {
  return isRead !== true
}

export function mailPartyName(party: MailParty | null, role = 'party') {
  const name = party?.name?.trim()
  if (name) return name
  if (!party) return `Unknown ${role}`
  return `Unknown ${party.type.replace('_', ' ')} #${party.id}`
}

export function filterLoadedMailHeaders(headers: readonly MailHeader[], filters: MailFilters) {
  const search = filters.search.trim().toLocaleLowerCase()

  return headers.filter((header) => {
    if (filters.unreadOnly && !isMailUnread(header.isRead)) return false
    if (
      filters.mailingListId !== null &&
      !header.recipients.some(
        (recipient) => recipient.type === 'mailing_list' && recipient.id === filters.mailingListId,
      )
    ) {
      return false
    }
    if (!search) return true

    return [header.subject ?? '', mailPartyName(header.sender, 'sender')].some((value) =>
      value.toLocaleLowerCase().includes(search),
    )
  })
}

export function appendUniqueMailHeaders(
  current: readonly MailHeader[],
  older: readonly MailHeader[],
) {
  const retainedIds = new Set(current.map((header) => header.mailId))
  return [...current, ...older.filter((header) => !retainedIds.has(header.mailId))]
}

export function mergeLatestMailHeaders(
  current: readonly MailHeader[],
  latest: readonly MailHeader[],
  hasPaginated: boolean,
) {
  return hasPaginated ? appendUniqueMailHeaders(latest, current) : [...latest]
}

export function splitMailBodyParagraphs(body: string | null) {
  if (!body) return []
  return body
    .replaceAll('\r\n', '\n')
    .split(/\n[\t ]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

export function deriveMailboxStatus(options: {
  errors: readonly unknown[]
  hasInitialData: boolean
  loading: boolean
}): MailboxStatus {
  if (options.hasInitialData) return 'idle'
  const errors = options.errors.filter((error): error is Error => error instanceof Error)
  if (
    errors.some(
      (error) =>
        error instanceof ApiQueryError &&
        (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED'),
    )
  ) {
    return 'scope-required'
  }
  if (
    errors.some(
      (error) =>
        error instanceof ApiQueryError && (error.status === 429 || error.code === 'ESI_COOLDOWN'),
    )
  ) {
    return 'cooldown'
  }
  if (errors.length > 0) return 'error'
  if (options.loading) return 'loading'
  return 'idle'
}
