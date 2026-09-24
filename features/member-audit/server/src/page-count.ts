export function requireEsiPageCount(
  pagination: { readonly pages?: number } | undefined,
  currentPage: number,
  maximumPages: number,
  resourceName: string,
) {
  const pages = pagination?.pages
  if (!Number.isSafeInteger(pages) || pages === undefined || pages < 1) {
    throw new Error(`${resourceName} response omitted its authoritative page count`)
  }
  if (pages > maximumPages) {
    throw new Error(`${resourceName} pagination exceeded the reviewed page bound`)
  }
  if (currentPage > pages) {
    throw new Error(`${resourceName} page count moved behind the current continuation`)
  }
  return pages
}
