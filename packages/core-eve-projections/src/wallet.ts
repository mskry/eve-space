export const safeWalletJournalContextTypes = [
  'structure_id',
  'station_id',
  'market_transaction_id',
  'eve_system',
  'industry_job_id',
  'contract_id',
  'planet_id',
  'system_id',
  'type_id',
] as const

export type WalletJournalContextType = (typeof safeWalletJournalContextTypes)[number]

export interface WalletJournalSourceEntry<ReferenceType extends string = string> {
  readonly id: number
  readonly date: string
  readonly amount?: number
  readonly balance?: number
  readonly ref_type: ReferenceType
  readonly description: string
  readonly reason?: string
  readonly tax?: number
  readonly context_id?: number
  readonly context_id_type?: string
}

export interface ProjectedWalletJournalEntry<ReferenceType extends string = string> {
  readonly journalId: number
  readonly date: string
  readonly amount: number | null
  readonly balance: number | null
  readonly referenceType: ReferenceType
  readonly description: string
  readonly reason: string | null
  readonly taxAmount: number | null
  readonly context: { readonly id: number; readonly type: WalletJournalContextType } | null
}

export interface WalletTransactionSourceEntry {
  readonly transaction_id: number
  readonly journal_ref_id: number
  readonly date: string
  readonly type_id: number
  readonly quantity: number
  readonly unit_price: number
  readonly is_buy: boolean
  readonly is_personal: boolean
  readonly location_id: number
}

export interface ProjectedWalletTransaction {
  readonly transactionId: number
  readonly journalRefId: number
  readonly date: string
  readonly typeId: number
  readonly typeName: string
  readonly quantity: number
  readonly unitPrice: number
  readonly totalPrice: number
  readonly isBuy: boolean
  readonly locationId: number
  readonly locationName: string | null
}

const safeWalletJournalContextTypeSet = new Set<string>(safeWalletJournalContextTypes)

export function projectWalletJournalEntry<ReferenceType extends string>(
  entry: WalletJournalSourceEntry<ReferenceType>,
): ProjectedWalletJournalEntry<ReferenceType> {
  return {
    journalId: entry.id,
    date: entry.date,
    amount: entry.amount ?? null,
    balance: entry.balance ?? null,
    referenceType: entry.ref_type,
    description: entry.description,
    reason: entry.reason ?? null,
    taxAmount: entry.tax ?? null,
    context: walletJournalContext(entry),
  }
}

export function projectWalletTransactions(
  transactions: readonly WalletTransactionSourceEntry[],
  namesByType: ReadonlyMap<number, string>,
  namesByLocation: ReadonlyMap<number, string>,
): ProjectedWalletTransaction[] {
  return transactions
    .filter((transaction) => transaction.is_personal)
    .map((transaction) => ({
      transactionId: transaction.transaction_id,
      journalRefId: transaction.journal_ref_id,
      date: transaction.date,
      typeId: transaction.type_id,
      typeName: namesByType.get(transaction.type_id) ?? `Unknown type ${transaction.type_id}`,
      quantity: transaction.quantity,
      unitPrice: transaction.unit_price,
      totalPrice: transaction.quantity * transaction.unit_price,
      isBuy: transaction.is_buy,
      locationId: transaction.location_id,
      locationName: namesByLocation.get(transaction.location_id) ?? null,
    }))
    .toSorted(
      (left, right) =>
        Date.parse(right.date) - Date.parse(left.date) || right.transactionId - left.transactionId,
    )
}

function walletJournalContext(entry: WalletJournalSourceEntry) {
  if (
    !isPositiveSafeInteger(entry.context_id) ||
    !isSafeWalletJournalContextType(entry.context_id_type)
  )
    return null
  return { id: entry.context_id, type: entry.context_id_type }
}

function isSafeWalletJournalContextType(
  value: string | undefined,
): value is WalletJournalContextType {
  return value !== undefined && safeWalletJournalContextTypeSet.has(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
