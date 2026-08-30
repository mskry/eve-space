export interface MailUnreadBadge {
  readonly count: number
  readonly label: string
}

interface MailUnreadSource {
  readonly characterId: number
  readonly totalUnreadCount: number | null
}

export function resolveMailUnreadCount(
  characterId: number | undefined,
  labels: MailUnreadSource | undefined | null,
) {
  if (characterId === undefined || labels?.characterId !== characterId) return undefined
  return labels.totalUnreadCount ?? undefined
}

export function resolveMailUnreadBadge(
  characterId: number | undefined,
  count: number | undefined,
): MailUnreadBadge | undefined {
  if (characterId === undefined || count === undefined || count <= 0) return undefined
  return { count, label: `${count} unread ${count === 1 ? 'mail' : 'mails'}` }
}

export function mailUnreadBadgeValue(count: number) {
  return count > 99 ? '99+' : String(count)
}
