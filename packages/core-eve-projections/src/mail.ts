import { eveFormattedTextToPlainText } from './eve-formatted-text.js'

export type MailRecipientType = 'alliance' | 'character' | 'corporation' | 'mailing_list'
export type MailPartyType = MailRecipientType | 'unknown'

export interface MailParty {
  readonly id: number
  readonly type: MailPartyType
  readonly name: string | null
}

export interface MailRecipientSource {
  readonly recipient_id: number
  readonly recipient_type: MailRecipientType
}

export interface ResolvedMailPartyName {
  readonly name: string
  readonly category: string
}

export interface MailPartyNames {
  readonly universeNames: ReadonlyMap<number, ResolvedMailPartyName>
  readonly mailingListNames: ReadonlyMap<number, string>
}

export function projectMailSender(
  id: number | undefined,
  parties: MailPartyNames,
): MailParty | null {
  if (id === undefined) {
    return null
  }
  const resolved = parties.universeNames.get(id)
  if (resolved && isUniverseMailPartyType(resolved.category)) {
    return { id, name: resolved.name, type: resolved.category }
  }
  return { id, name: null, type: 'unknown' }
}

export function projectMailRecipients(
  recipients: readonly MailRecipientSource[] | undefined,
  parties: MailPartyNames,
): MailParty[] {
  return (recipients ?? []).map((recipient) => {
    let name = parties.mailingListNames.get(recipient.recipient_id) ?? null
    if (recipient.recipient_type !== 'mailing_list') {
      const universeParty = parties.universeNames.get(recipient.recipient_id)
      name = universeParty?.category === recipient.recipient_type ? universeParty.name : null
    }
    return { id: recipient.recipient_id, name, type: recipient.recipient_type }
  })
}

export function sanitizeMailBody(body: string | undefined | null): string | null {
  return eveFormattedTextToPlainText(body) ?? null
}

export function isUniverseMailPartyType(
  value: string,
): value is Exclude<MailRecipientType, 'mailing_list'> {
  return value === 'alliance' || value === 'character' || value === 'corporation'
}
