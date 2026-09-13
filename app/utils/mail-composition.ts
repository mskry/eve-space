import type { MailDetail, MailRecipient } from '../queries/mail'
import { mailPartyName } from './mail-view'

export const MAIL_RECIPIENT_LIMIT = 50
export const MAIL_SUBJECT_LIMIT = 1_000
export const MAIL_BODY_LIMIT = 10_000
export const MAIL_RECIPIENT_RESOLUTION_MIN_LENGTH = 1
export const MAIL_RECIPIENT_SEARCH_MIN_LENGTH = 3

export type MailCompositionMode = 'forward' | 'new' | 'reply' | 'reply-all'

interface MailCompositionSeed {
  body: string
  omitted: string[]
  recipients: MailRecipient[]
  subject: string
}

export function seedMailComposition(
  mode: Exclude<MailCompositionMode, 'new'>,
  detail: MailDetail,
  characterId: number,
): MailCompositionSeed {
  const omitted: string[] = []
  const recipients: MailRecipient[] = []
  const seen = new Set<string>()
  const add = (party: MailDetail['sender']) => {
    if (!party) return
    if (!addressableMailParty(party)) {
      omitted.push(mailPartyName(party, 'sender'))
      return
    }
    if (party.type === 'character' && party.id === characterId) return
    const key = mailRecipientKey(party)
    if (seen.has(key)) return
    seen.add(key)
    recipients.push(party)
  }

  if (mode !== 'forward') add(detail.sender)
  if (mode === 'reply-all') {
    for (const recipient of detail.recipients) add(recipient)
  }

  return {
    body: quotedBody(detail),
    omitted,
    recipients,
    subject: prefixedSubject(detail.subject, mode === 'forward' ? 'forward' : 'reply'),
  }
}

export function mailRecipientKey(recipient: Pick<MailRecipient, 'id' | 'type'>) {
  return `${recipient.type}:${recipient.id}`
}

export function addressableMailParty(party: MailDetail['sender']): party is MailRecipient {
  return Boolean(party && party.type !== 'unknown')
}

function prefixedSubject(subject: string | null, mode: 'forward' | 'reply') {
  const value = subject?.trim() || '(No subject)'
  const prefix = mode === 'reply' ? 'Re:' : 'Fwd:'
  return value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? value
    : `${prefix} ${value}`
}

function quotedBody(detail: MailDetail) {
  const sender = mailPartyName(detail.sender, 'sender')
  return `\n\n--- Original message from ${sender} ---\n${detail.body ?? ''}`
}
