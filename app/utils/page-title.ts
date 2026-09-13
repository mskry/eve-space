export function composeRecordPageTitle(
  identity: string | undefined,
  routeTitle: unknown,
  fallbackTitle: string,
) {
  const sectionTitle =
    typeof routeTitle === 'string' && routeTitle.trim() ? routeTitle.trim() : fallbackTitle
  const recordIdentity = identity?.trim()
  return [recordIdentity, sectionTitle, 'EVE Space'].filter(Boolean).join(' // ')
}
