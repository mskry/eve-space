export function formatNumber(value: number | null) {
  return value === null ? '--' : new Intl.NumberFormat('en-US').format(value)
}

export function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  return days > 0 ? `${days}D ${hours}H` : `${hours}H ${Math.floor((seconds % 3_600) / 60)}M`
}

export function formatCheckedAt(value: string) {
  return new Date(value).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function formatValidatedAt(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export function formatRelativeTime(value: string | null, now = Date.now()) {
  if (!value) return 'Time unknown'
  const difference = Date.parse(value) - now
  if (!Number.isFinite(difference)) return 'Time unknown'
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const absolute = Math.abs(difference)
  if (absolute < 60_000) return formatter.format(Math.round(difference / 1_000), 'second')
  if (absolute < 3_600_000) return formatter.format(Math.round(difference / 60_000), 'minute')
  if (absolute < 86_400_000) return formatter.format(Math.round(difference / 3_600_000), 'hour')
  return formatter.format(Math.round(difference / 86_400_000), 'day')
}

export function stateLabel(value: string) {
  return value.toUpperCase()
}
