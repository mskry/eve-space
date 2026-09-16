export type CharacterSecurityStatusTone = 'positive' | 'warning' | 'danger'

export function formatCharacterSecurityStatus(value: number) {
  const roundedValue = Number(value.toFixed(2))
  if (roundedValue === 0) return '0.0'
  return `${roundedValue > 0 ? '+' : ''}${roundedValue}`
}

export function getCharacterSecurityStatusTone(value: number): CharacterSecurityStatusTone {
  if (value >= 0) return 'positive'
  if (value <= -5) return 'danger'
  return 'warning'
}
