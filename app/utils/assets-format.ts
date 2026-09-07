export function formatAssetVolume(value: number | null, maximumFractionDigits = 2) {
  if (value === null || !Number.isFinite(value) || value < 0) return 'Unknown'
  return `${value.toLocaleString('en-US', { maximumFractionDigits })} m³`
}
