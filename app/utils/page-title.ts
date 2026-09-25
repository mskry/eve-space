const isPageTitle = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

export function composeRecordPageTitle(
  identity: string | undefined,
  routeTitle: unknown,
  fallbackTitle: string,
) {
  const sectionTitle = isPageTitle(routeTitle) ? routeTitle.trim() : fallbackTitle
  const recordIdentity = identity?.trim()
  return [recordIdentity, sectionTitle, 'EVE Space'].filter(Boolean).join(' // ')
}
