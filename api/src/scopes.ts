export function normalizeScopeSet(scopes: readonly string[]) {
  return [...new Set(scopes)].toSorted((left, right) => left.localeCompare(right))
}
