export interface StaleEsiResult {
  stale: true
  validatedAt: string
  refreshFailureClass?: string
}

export function getStaleEsiResult(value: unknown): StaleEsiResult | undefined {
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  if (
    record.stale === true &&
    typeof record.validatedAt === 'string' &&
    Number.isFinite(Date.parse(record.validatedAt))
  ) {
    return {
      stale: true,
      validatedAt: record.validatedAt,
      ...(typeof record.refreshFailureClass === 'string'
        ? { refreshFailureClass: record.refreshFailureClass }
        : {}),
    }
  }

  return undefined
}

export function hasUnavailableOverviewSection(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false

  const record = value as Record<string, unknown>
  return ['location', 'ship', 'skills'].some((key) => {
    const section = record[key]
    return Boolean(
      section &&
      typeof section === 'object' &&
      'status' in section &&
      section.status === 'unavailable',
    )
  })
}
