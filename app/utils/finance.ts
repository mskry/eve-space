import type {
  FinanceContract,
  FinanceContractFilter,
  FinanceContracts,
  FinanceJournal,
  FinanceJournalEntry,
  FinanceJournalGroupFilter,
  FinanceOrder,
  FinanceOrderFilter,
  FinanceOrderMode,
  FinanceOrders,
  FinanceRange,
  FinanceSummary,
  FinanceSummaryCopy,
  FinanceSummaryMetric,
  FinanceTransaction,
  FinanceTransactionSideFilter,
} from '../types/finance'

export const FINANCE_RANGES: readonly FinanceRange[] = ['7D', '30D', '90D', 'ALL']

const millisecondsPerDay = 86_400_000
const millisecondsPerHour = 3_600_000
const financeRangeDays: Record<FinanceRange, number> = {
  '7D': 7,
  '30D': 30,
  '90D': 90,
  ALL: Number.POSITIVE_INFINITY,
}
const closedContractStatuses = new Set([
  'cancelled',
  'deleted',
  'failed',
  'finished',
  'finished_contractor',
  'finished_issuer',
  'rejected',
  'reversed',
])

export function financeJournalGroup(referenceType: string) {
  if (referenceType.includes('contract')) return 'Contracts'
  if (
    referenceType.includes('market') ||
    referenceType.includes('broker') ||
    referenceType.includes('transaction_tax')
  )
    return 'Market'
  return 'Other'
}

export function isWithinFinanceRange(value: string, range: FinanceRange, now: number) {
  if (now === 0 || financeRangeDays[range] === Number.POSITIVE_INFINITY) return true
  const elapsed = now - Date.parse(value)
  return Number.isNaN(elapsed) || elapsed <= financeRangeDays[range] * millisecondsPerDay
}

export function expiresWithinFinanceUrgency(value: string, now: number) {
  if (now === 0) return false
  const remaining = Date.parse(value) - now
  return remaining > 0 && remaining <= 48 * millisecondsPerHour
}

export function filterFinanceJournalEntries(
  entries: readonly FinanceJournalEntry[],
  range: FinanceRange,
  group: FinanceJournalGroupFilter,
  now: number,
) {
  return entries
    .filter((entry) => isWithinFinanceRange(entry.date, range, now))
    .filter((entry) => {
      if (group === 'All') return true
      if (group === 'Income') return (entry.amount ?? 0) > 0
      if (group === 'Expense') return (entry.amount ?? 0) < 0
      return financeJournalGroup(entry.referenceType) === group
    })
}

export function filterFinanceTransactions(
  transactions: readonly FinanceTransaction[],
  range: FinanceRange,
  side: FinanceTransactionSideFilter,
  searchQuery: string,
  now: number,
) {
  const search = searchQuery.trim().toLocaleLowerCase('en-US')
  return transactions
    .filter((transaction) => isWithinFinanceRange(transaction.date, range, now))
    .filter((transaction) => side === 'All' || financeTransactionSide(transaction.isBuy) === side)
    .filter((transaction) =>
      search === ''
        ? true
        : `${transaction.typeName} ${transaction.locationName ?? ''}`
            .toLocaleLowerCase('en-US')
            .includes(search),
    )
}

export function filterFinanceOrders(
  openOrders: readonly FinanceOrder[],
  orderHistory: readonly FinanceOrder[],
  mode: FinanceOrderMode,
  range: FinanceRange,
  filter: FinanceOrderFilter,
  now: number,
) {
  const activeOrders =
    mode === 'open'
      ? openOrders
      : orderHistory.filter((order) => isWithinFinanceRange(order.issuedAt, range, now))
  return activeOrders.filter((order) => {
    if (filter === 'All') return true
    if (filter === 'Escrowed') return (order.escrow ?? 0) > 0
    return financeOrderSide(order.isBuy) === filter.toLocaleLowerCase('en-US')
  })
}

export function filterFinanceContracts(
  contracts: readonly FinanceContract[],
  range: FinanceRange,
  filter: FinanceContractFilter,
  now: number,
) {
  return contracts
    .filter((contract) => isWithinFinanceRange(contract.issuedAt, range, now))
    .filter((contract) => {
      if (filter === 'all') return true
      if (filter === 'awaiting') return financeContractAwaitsEntity(contract)
      if (filter === 'active')
        return contract.status === 'outstanding' || contract.status === 'in_progress'
      if (filter === 'couriers') return contract.type === 'courier'
      if (filter === 'auctions') return contract.type === 'auction'
      return closedContractStatuses.has(contract.status)
    })
}

export function financeOrderSide(isBuy: boolean) {
  return isBuy ? 'buy' : 'sell'
}

export function financeTransactionSide(isBuy: boolean) {
  return isBuy ? 'Buy' : 'Sell'
}

export function financeOrderStateLabel(order: Pick<FinanceOrder, 'state'>) {
  return order.state ? order.state.toLocaleUpperCase('en-US') : '—'
}

export function financeOrderFill(order: Pick<FinanceOrder, 'volumeRemain' | 'volumeTotal'>) {
  if (order.volumeTotal <= 0) return 0
  return Math.round(((order.volumeTotal - order.volumeRemain) / order.volumeTotal) * 100)
}

export function financeOrderVolumeNumerator(
  order: Pick<FinanceOrder, 'volumeRemain' | 'volumeTotal'>,
  mode: FinanceOrderMode,
) {
  return mode === 'open' ? order.volumeRemain : order.volumeTotal - order.volumeRemain
}

export function financeContractHasItems(type: string) {
  return type === 'auction' || type === 'courier' || type === 'item_exchange'
}

export function financeContractAwaitsEntity(contract: Pick<FinanceContract, 'role' | 'status'>) {
  return (
    contract.role === 'assigned' &&
    (contract.status === 'outstanding' || contract.status === 'in_progress')
  )
}

export function formatFinanceIsk(value: number, fractionDigits = 2) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value)
}

export function formatSignedFinanceIsk(value: number | null) {
  if (value === null) return 'UNAVAILABLE'
  return `${value > 0 ? '+' : ''}${formatFinanceIsk(value)}`
}

export function formatFinanceDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
    year: 'numeric',
  }).formatToParts(new Date(value))
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${lookup('year')}.${lookup('month')}.${lookup('day')} ${lookup('hour')}:${lookup('minute')}`
}

export function formatFinanceCountdown(value: string, now: number) {
  if (now === 0) return '—'
  const remaining = Date.parse(value) - now
  if (Number.isNaN(remaining)) return '—'
  if (remaining <= 0) return 'ELAPSED'
  const hours = Math.floor(remaining / millisecondsPerHour)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function formatFinanceSynced(value: string | undefined, now: number) {
  if (!value || now === 0) return '—'
  const elapsed = now - Date.parse(value)
  if (Number.isNaN(elapsed)) return '—'
  if (elapsed < 60_000) return 'JUST NOW'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `${minutes}M AGO`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}H AGO` : `${Math.floor(hours / 24)}D AGO`
}

export function formatFinanceTerm(value: number | null) {
  return value === null ? '—' : `${formatFinanceIsk(value, 0)} ISK`
}

export function formatFinanceContractType(value: string) {
  return value.replaceAll('_', ' ').toLocaleUpperCase('en-US')
}

export function financeContractValue(contract: Pick<FinanceContract, 'price' | 'reward'>) {
  return formatFinanceTerm(contract.price ?? contract.reward)
}

export function formatFinanceCollectionCount(
  shown: number,
  total: number,
  scope: 'loaded-page' | 'loaded-range' | 'complete-collection',
) {
  const labels = {
    'loaded-page': 'on the loaded page',
    'loaded-range': 'in the loaded range',
    'complete-collection': 'in the complete collection',
  } as const
  return `${shown} OF ${total} ${labels[scope]}`
}

export function calculateFinanceSummary({
  journal,
  openOrders,
  contracts,
  range,
  now,
}: {
  journal?: FinanceJournal | null
  openOrders?: FinanceOrders | null
  contracts?: FinanceContracts | null
  range: FinanceRange
  now: number
}): FinanceSummary {
  const rangedJournal = (journal?.entries ?? []).filter((entry) =>
    isWithinFinanceRange(entry.date, range, now),
  )
  const escrowOrders = (openOrders?.orders ?? []).filter((order) => (order.escrow ?? 0) > 0)
  const expiringOrderCount = (openOrders?.orders ?? []).filter((order) =>
    expiresWithinFinanceUrgency(order.expiresAt, now),
  ).length
  const rangedContracts = (contracts?.contracts ?? []).filter((contract) =>
    isWithinFinanceRange(contract.issuedAt, range, now),
  )
  const activeContracts = rangedContracts.filter(
    (contract) => contract.status === 'outstanding' || contract.status === 'in_progress',
  )

  return {
    journalLoaded: journal !== null && journal !== undefined,
    journalEntryCount: rangedJournal.length,
    netInRange: rangedJournal.reduce((total, entry) => total + (entry.amount ?? 0), 0),
    openOrdersLoaded: openOrders !== null && openOrders !== undefined,
    escrowOrderCount: escrowOrders.length,
    escrowTotal: escrowOrders.reduce((total, order) => total + (order.escrow ?? 0), 0),
    contractsLoaded: contracts !== null && contracts !== undefined,
    awaitingContractCount: rangedContracts.filter(financeContractAwaitsEntity).length,
    expiringOrderCount,
    expiringContractCount: activeContracts.filter((contract) =>
      expiresWithinFinanceUrgency(contract.expiredAt, now),
    ).length,
  }
}

export function buildFinanceSummaryMetrics(
  summary: FinanceSummary,
  copy: FinanceSummaryCopy,
): FinanceSummaryMetric[] {
  const metrics: FinanceSummaryMetric[] = []
  if (summary.journalLoaded && summary.netInRange !== 0)
    metrics.push({
      id: 'net',
      label: 'Net change',
      detail: `${summary.journalEntryCount} journal entries · loaded page`,
      value: `${formatSignedFinanceIsk(summary.netInRange)} ISK`,
    })
  if (summary.openOrdersLoaded && summary.escrowTotal > 0)
    metrics.push({
      id: 'escrow',
      label: 'In escrow',
      detail: `${summary.escrowOrderCount} buy orders · complete collection`,
      value: `${formatFinanceIsk(summary.escrowTotal, 0)} ISK`,
    })
  if (summary.contractsLoaded && summary.awaitingContractCount > 0)
    metrics.push({
      id: 'awaiting',
      label: copy.awaitingLabel,
      detail: copy.awaitingDetail,
      value: String(summary.awaitingContractCount),
      link: true,
    })
  const expiringTotal = summary.expiringOrderCount + summary.expiringContractCount
  if (expiringTotal > 0)
    metrics.push({
      id: 'expiring',
      label: 'Expiring < 48h',
      detail: `${summary.expiringOrderCount} orders · ${summary.expiringContractCount} contracts`,
      value: String(expiringTotal),
    })
  return metrics
}
