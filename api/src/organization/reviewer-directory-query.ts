export const escapeReviewerLikePattern = (value: string) =>
  value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`)

export const parseReviewerCharacterId = (value: string) => {
  if (value.length > 16) return null
  for (const character of value) {
    if (character < '0' || character > '9') return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
