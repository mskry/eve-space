import type { CoreMigrationIdentity } from './migration-manifest.js'

export interface CoreMigrationHistoryRow {
  readonly name: string
  readonly contentSha256: string | null
}

export function assertCoreMigrationHistory(
  rows: readonly CoreMigrationHistoryRow[],
  manifest: readonly CoreMigrationIdentity[],
) {
  const manifestByName = new Map(manifest.map((migration) => [migration.name, migration]))
  const rowsByName = new Map(rows.map((row) => [row.name, row]))
  const unknown = rows.find(({ name }) => !manifestByName.has(name))
  if (unknown) throw historyError('unknown migration', unknown.name)

  let foundGap = false
  for (const migration of manifest) {
    const row = rowsByName.get(migration.name)
    if (!row) {
      foundGap = true
      continue
    }
    if (foundGap) throw historyError('non-prefix migration', row.name)
    if (row.contentSha256 === null) throw historyError('missing content identity', row.name)
    if (row.contentSha256 !== migration.sha256)
      throw historyError('content identity mismatch', row.name)
  }
}

function historyError(category: string, name: string) {
  return new Error(`Unsupported core migration history (${category}): ${name}`)
}
