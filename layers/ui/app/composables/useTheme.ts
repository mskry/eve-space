export const uiThemes = [
  { value: 'void', label: 'Void', code: 'DARK' },
  { value: 'high-sec', label: 'High Sec', code: 'LIGHT' },
] as const

export type UiTheme = (typeof uiThemes)[number]['value']

function isUiTheme(value: unknown): value is UiTheme {
  return uiThemes.some((theme) => theme.value === value)
}

export function useTheme() {
  const preference = useCookie<UiTheme>('eve-space-theme', {
    default: () => 'void',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })

  const theme = computed<UiTheme>({
    get: () => (isUiTheme(preference.value) ? preference.value : 'void'),
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
