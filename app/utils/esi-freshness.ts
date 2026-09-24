export interface StaleEsiResult {
  stale: true
  validatedAt: string
  retryAt?: string
  refreshFailureClass?: string
}

export interface StaleEsiMetadata {
  readonly stale: true
  readonly validatedAt?: string
  readonly retryAt?: string
  readonly refreshFailureClass?: string
}

export function getStaleEsiResult(value: unknown): StaleEsiResult | undefined {
  const metadata = getStaleEsiMetadata(value)
  return metadata?.validatedAt ? { ...metadata, validatedAt: metadata.validatedAt } : undefined
}

export function getStaleEsiMetadata(value: unknown): StaleEsiMetadata | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  if (record.stale !== true) {
    return undefined
  }

  const validatedAt = normalizedTimestamp(record.validatedAt)
  const retryAt = normalizedTimestamp(record.retryAt)
  return {
    stale: true,
    ...(validatedAt ? { validatedAt } : {}),
    ...(retryAt ? { retryAt } : {}),
    ...(typeof record.refreshFailureClass === 'string' && record.refreshFailureClass.length > 0
      ? { refreshFailureClass: record.refreshFailureClass }
      : {}),
  }
}

export function hasUnavailableOverviewSection(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

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

function normalizedTimestamp(value: unknown) {
  if (typeof value !== 'string') {
    return
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? value : undefined
}
