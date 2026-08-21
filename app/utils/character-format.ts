/** Long birthday used on the character record, e.g. `02 February 2022`. */
export function formatBirthday(birthday: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(birthday))
}

/** Compact birthday used on roster cards, e.g. `02.02.2022`. */
export function formatBirthdayShort(birthday: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(new Date(birthday))
    .replaceAll('/', '.')
}

/** Abbreviated ISK/SP amount for tight layouts, e.g. `1.2B`. */
export function formatCompactAmount(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}
