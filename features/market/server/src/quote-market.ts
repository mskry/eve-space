import {
  formatCents,
  parsePriceCents,
  quoteMarketDepth,
  type MarketDepthQuote,
  type MarketObservationIdentity,
  type MarketOrderRow,
} from './order-depth.js'

const maximumDepthPages = 512
const pageSize = 1_000

type ReadQuoteRows = (request: {
  readonly observationId: string
  readonly typeId: number
  readonly side: 'buy' | 'sell'
  readonly locationIds: number[]
  readonly limit: number
  readonly cursorPrice: string | null
  readonly cursorIssuedAt: string | null
  readonly cursorOrderId: number | null
}) => Promise<{ readonly rows: readonly MarketOrderRow[]; readonly hasMore: boolean }>

type DepthCursor = { readonly price: string; readonly issuedAt: string; readonly orderId: number }

const nextDepthCursor = (
  current: DepthCursor | null,
  rows: readonly MarketOrderRow[],
): DepthCursor => {
  const last = rows.at(-1)
  if (!last) throw new Error('Market depth page cannot advance its keyset cursor')
  const next = { price: last.price, issuedAt: last.issuedAt, orderId: last.orderId }
  if (
    current?.price === next.price &&
    current.issuedAt === next.issuedAt &&
    current.orderId === next.orderId
  ) {
    throw new Error('Market depth cursor did not advance')
  }
  return next
}

const completedDepthQuote = (
  input: Pick<Parameters<typeof quoteMarketDepth>[0], 'observation' | 'quantity'>,
  state: {
    readonly filledQuantity: number
    readonly totalCents: bigint
    readonly bestPriceIsk: string | null
    readonly worstConsumedPriceIsk: string | null
  },
): MarketDepthQuote => {
  const averageCents = state.filledQuantity
    ? (state.totalCents + BigInt(state.filledQuantity) / 2n) / BigInt(state.filledQuantity)
    : null
  return {
    ...input.observation,
    requestedQuantity: input.quantity,
    filledQuantity: state.filledQuantity,
    unfilledQuantity: input.quantity - state.filledQuantity,
    totalIsk: formatCents(state.totalCents),
    volumeWeightedPriceIsk: averageCents === null ? null : formatCents(averageCents),
    bestPriceIsk: state.bestPriceIsk,
    worstConsumedPriceIsk: state.worstConsumedPriceIsk,
    complete: state.filledQuantity === input.quantity,
  }
}

export const quoteObservedMarketDepth = async (input: {
  readonly observation: MarketObservationIdentity
  readonly typeId: number
  readonly side: 'buy' | 'sell'
  readonly quantity: number
  readonly locationIds: readonly number[]
  readonly readRows: ReadQuoteRows
  readonly signal?: AbortSignal
}): Promise<MarketDepthQuote> => {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new TypeError('Quote quantity must be a positive safe integer')
  }
  if (
    input.locationIds.length > 100 ||
    input.locationIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new TypeError('Quote locations exceed the bounded public market set')
  }
  const orderSide = input.side === 'buy' ? 'sell' : 'buy'
  let filledQuantity = 0
  let totalCents = 0n
  let bestPriceIsk: string | null = null
  let worstConsumedPriceIsk: string | null = null
  let cursor: DepthCursor | null = null
  for (let number = 1; number <= maximumDepthPages; number += 1) {
    input.signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Ordered keyset pages stop on a fill or proven exhaustion.
    const page = await input.readRows({
      observationId: input.observation.observationId,
      typeId: input.typeId,
      side: orderSide,
      locationIds: [...input.locationIds],
      limit: pageSize,
      cursorPrice: cursor?.price ?? null,
      cursorIssuedAt: cursor?.issuedAt ?? null,
      cursorOrderId: cursor?.orderId ?? null,
    })
    const partial = quoteMarketDepth({
      observation: input.observation,
      orders: page.rows,
      typeId: input.typeId,
      side: input.side,
      quantity: input.quantity - filledQuantity,
      locationIds: [],
    })
    filledQuantity += partial.filledQuantity
    totalCents += parsePriceCents(partial.totalIsk)
    bestPriceIsk ??= partial.bestPriceIsk
    worstConsumedPriceIsk = partial.worstConsumedPriceIsk ?? worstConsumedPriceIsk
    if (filledQuantity === input.quantity || !page.hasMore) {
      return completedDepthQuote(input, {
        filledQuantity,
        totalCents,
        bestPriceIsk,
        worstConsumedPriceIsk,
      })
    }
    cursor = nextDepthCursor(cursor, page.rows)
  }
  throw new RangeError('Market depth exceeds the quote work bound')
}
