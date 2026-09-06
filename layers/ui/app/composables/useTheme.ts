export const uiThemes = [
  { value: 'gallente', label: 'Gallente Green' },
  { value: 'amarr', label: 'Amarr Gold' },
  { value: 'caldari', label: 'Caldari Steel' },
  { value: 'minmatar', label: 'Minmatar Rust' },
  { value: 'high-sec', label: 'CONCORD Daylight' },
] as const

export type UiTheme = (typeof uiThemes)[number]['value']
type StoredUiTheme = UiTheme | 'void'

function isUiTheme(value: unknown): value is UiTheme {
  return uiThemes.some((theme) => theme.value === value)
}

export function useTheme() {
  const preference = useCookie<StoredUiTheme>('eve-space-theme', {
    default: () => 'gallente',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })

  const theme = computed<UiTheme>({
    get: () => {
      if (preference.value === 'void') return 'gallente'
      return isUiTheme(preference.value) ? preference.value : 'gallente'
    },
    set: (value) => {
      preference.value = value
    },
  })

  function setTheme(value: unknown) {
    if (isUiTheme(value)) theme.value = value
  }

  return {
    setTheme,
    theme,
    themes: uiThemes,
  }
}
