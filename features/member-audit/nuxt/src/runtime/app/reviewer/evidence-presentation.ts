type EvidenceScalar = string | number | boolean | null
type EvidenceValue = EvidenceScalar | readonly EvidenceScalar[] | undefined

export const evidenceText = (value: EvidenceValue, fallback = 'Unknown') => {
  const text = String(value ?? '')
  return text.trim() && !Array.isArray(value) ? text : fallback
}

export const evidenceNumber = (value: EvidenceValue, fallback = 'Unknown') => {
  const number = Number(value ?? Number.NaN)
  return Number.isFinite(number) && !Array.isArray(value)
    ? new Intl.NumberFormat('en-US').format(number)
    : fallback
}

export const evidenceNames = (value: EvidenceValue) =>
  Array.isArray(value)
    ? value
        .map((name) => String(name ?? ''))
        .filter(Boolean)
        .join(', ')
    : ''
