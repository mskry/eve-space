import type { CoreDataCoverageEntry } from './coverage-manifest.js'

export function renderCoreDataCoverageReport(entries: readonly CoreDataCoverageEntry[]) {
  const headers = [
    'Domain',
    'Capability',
    'Owner',
    'Source',
    'Status',
    'Exposure',
    'Product',
    'ESI operations',
    'Rationale',
  ]
  const rows = entries
    .toSorted((left, right) =>
      `${left.domain}/${left.capability}`.localeCompare(`${right.domain}/${right.capability}`),
    )
    .map((entry) => [
      entry.domain,
      entry.capability,
      entry.owner,
      entry.source,
      entry.status,
      entry.exposure ?? 'none',
      entry.productId ?? '',
      (entry.esiOperationIds ?? []).join(', '),
      entry.rationale,
    ])

  return `# Core EVE Data Coverage\n\nThis report is generated from the machine-readable core-data coverage manifest. An implemented internal capability, a generated SDK operation, planned coverage, and module-product exposure are distinct states. Only an implemented \`module-product\` entry with a matching contract and executable adapter grants module access.\n\n${renderTable(headers, rows)}\n`
}

function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, 3, ...rows.map((row) => row[index]?.length ?? 0)),
  )
  const renderRow = (cells: readonly string[]) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index]!)).join(' | ')} |`
  return [
    renderRow(headers),
    renderRow(widths.map((width) => '-'.repeat(width))),
    ...rows.map(renderRow),
  ].join('\n')
}
