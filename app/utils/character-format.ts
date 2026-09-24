/** Long birthday used on the character record, e.g. `02 February 2022`. */
export function formatBirthday(birthday: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(birthday))
}

/** Compact birthday used on roster cards, e.g. `02.02.2022`. */
export function formatBirthdayShort(birthday: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
    year: 'numeric',
  })
    .format(new Date(birthday))
    .replaceAll('/', '.')
}

/** Abbreviated ISK/SP amount for tight layouts, e.g. `1.2B`. */
export function formatCompactAmount(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(value)
}
