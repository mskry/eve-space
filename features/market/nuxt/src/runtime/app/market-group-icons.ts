const icons = import.meta.glob<string>('./assets/icons/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
})

export const marketGroupIconUrl = (iconId: number): string | null =>
  icons[`./assets/icons/${iconId}.png`] ?? null
