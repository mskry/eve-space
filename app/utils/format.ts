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

export function stateLabel(value: string) {
  return value.toUpperCase()
}
