export function formatSettingsTimestamp(timestamp: string | null, emptyText: string) {
  if (!timestamp) {
    return emptyText
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return emptyText
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  )
}
