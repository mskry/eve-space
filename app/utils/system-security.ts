export type SystemSecurityClass = 'high-sec' | 'low-sec' | 'null-sec'
export type SystemSecurityBand = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export function roundSystemSecurityStatus(value: number) {
  const boundedValue = Math.min(1, Math.max(-1, value))
  if (boundedValue > 0 && boundedValue < 0.05) return 0.1
  const roundedValue = Math.round(boundedValue * 10) / 10
  return Object.is(roundedValue, -0) ? 0 : roundedValue
}

export function formatSystemSecurityStatus(value: number) {
  return roundSystemSecurityStatus(value).toFixed(1)
}

export function getSystemSecurityClass(value: number): SystemSecurityClass {
  if (value >= 0.45) return 'high-sec'
  if (value > 0) return 'low-sec'
  return 'null-sec'
}

export function getSystemSecurityBand(value: number): SystemSecurityBand {
  return Math.max(0, Math.round(roundSystemSecurityStatus(value) * 10)) as SystemSecurityBand
}
