export type FinanceRange = '7D' | '30D' | '90D' | 'ALL'
export type FinanceOrderMode = 'open' | 'history'
export type FinanceJournalGroupFilter = 'All' | 'Income' | 'Expense' | 'Market' | 'Contracts'
export type FinanceTransactionSideFilter = 'All' | 'Buy' | 'Sell'
export type FinanceOrderFilter = 'All' | 'Buy' | 'Sell' | 'Escrowed'
export type FinanceContractFilter =
  | 'all'
  | 'awaiting'
  | 'active'
  | 'couriers'
  | 'auctions'
  | 'closed'

export interface FinanceFilterOption<T extends string> {
  label: string
  value: T
}

interface FinanceFreshness {
  validatedAt: string
  stale: boolean
}

interface FinanceAuthorizationAction {
  href: string
  label: string
}

export interface FinanceResourceState {
  authorizationRequired: boolean
  loading: boolean
  stale: boolean
  errorCode: string | null
  errorMessage: string | null
  canRetry: boolean
  authorizationAction: FinanceAuthorizationAction | null
}

export interface FinanceBalance extends FinanceFreshness {
  balance: number
}

export interface FinancePageMetadata {
  page: number
  totalPages: number
}

interface FinanceContinuationMetadata {
  fromId: number | null
  nextFromId: number | null
}

export interface FinanceJournalEntry {
  journalId: number
  date: string
  amount: number | null
  balance: number | null
  referenceType: string
  description: string
}

export interface FinanceJournal extends FinanceFreshness, FinancePageMetadata {
  entries: FinanceJournalEntry[]
}

export interface FinanceTransaction {
  transactionId: number
  date: string
  typeId: number
  typeName: string
  quantity: number
  unitPrice: number
  totalPrice: number
  isBuy: boolean
  locationId: number
  locationName: string | null
}

export interface FinanceTransactions extends FinanceFreshness, FinanceContinuationMetadata {
  transactions: FinanceTransaction[]
}

export interface FinanceOrder {
  orderId: number
  typeId: number
  typeName: string
  isBuy: boolean
  price: number
  volumeRemain: number
  volumeTotal: number
  escrow: number | null
  range: string
  locationId: number
  locationName: string | null
  issuedAt: string
  expiresAt: string
  state: string | null
}

export interface FinanceOrders extends FinanceFreshness {
  orders: FinanceOrder[]
}

export interface FinanceOrderHistory extends FinanceOrders, FinancePageMetadata {}

export interface FinanceContract {
  contractId: number
  type: string
  status: string
  availability: string
  role: 'assigned' | 'issued'
  title: string | null
  issuedAt: string
  expiredAt: string
  daysToComplete: number | null
  price: number | null
  reward: number | null
  collateral: number | null
  volume: number | null
}

export interface FinanceContracts extends FinanceFreshness, FinancePageMetadata {
  contracts: FinanceContract[]
}

interface FinanceContractItem {
  recordId: number
  typeId: number
  typeName: string
  direction: 'included' | 'requested'
  quantity: number
  blueprint: 'original' | 'copy' | null
}

export interface FinanceContractItems extends FinanceFreshness {
  items: FinanceContractItem[]
}

interface FinanceContractBid {
  bidId: number
  amount: number
  bidAt: string
}

export interface FinanceContractBids extends FinanceFreshness {
  bids: FinanceContractBid[]
}

export interface FinanceSummary {
  journalLoaded: boolean
  journalEntryCount: number
  netInRange: number
  openOrdersLoaded: boolean
  escrowOrderCount: number
  escrowTotal: number
  contractsLoaded: boolean
  awaitingContractCount: number
  expiringOrderCount: number
  expiringContractCount: number
}

export interface FinanceSummaryMetric {
  id: 'net' | 'escrow' | 'awaiting' | 'expiring'
  label: string
  detail: string
  value: string
  link?: boolean
}

export interface FinanceSummaryCopy {
  awaitingDetail: string
  awaitingLabel: string
}
