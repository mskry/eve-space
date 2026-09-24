export const uiThemes = [
  { label: 'Amarr Gold', value: 'amarr' },
  { label: 'Gallente Green', value: 'gallente' },
  { label: 'Caldari Steel', value: 'caldari' },
  { label: 'CONCORD Daylight', value: 'high-sec' },
  { label: 'Minmatar Rust', value: 'minmatar' },
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
      if (preference.value === 'void') {
        return 'gallente'
      }
      return isUiTheme(preference.value) ? preference.value : 'gallente'
    },
    set: (value) => {
      preference.value = value
    },
  })

  function setTheme(value: unknown) {
    if (isUiTheme(value)) {
      theme.value = value
    }
  }

  return {
    setTheme,
    theme,
    themes: uiThemes,
  }
}
