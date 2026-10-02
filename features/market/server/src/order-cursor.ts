import { z } from 'zod'
import { MarketReadError, marketReadInput } from './read-input.js'

const cursorSchema = z.strictObject({
  version: z.literal(1),
  profileId: z.uuid(),
  typeId: z.number().int().positive().safe(),
  observationId: z.uuid(),
  side: z.enum(['sell', 'buy']),
  price: z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{2}$/),
  issuedAt: z.iso.datetime({ offset: true }),
  orderId: z.number().int().positive().safe(),
})

export type MarketOrderSelector = Pick<
  z.infer<typeof cursorSchema>,
  'profileId' | 'typeId' | 'observationId' | 'side'
>

export const decodeMarketOrderCursor = (
  after: string | undefined,
  selector: MarketOrderSelector,
) => {
  if (!after) return { cursorPrice: null, cursorIssuedAt: null, cursorOrderId: null }
  const encoded = marketReadInput(
    z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[\w-]+$/),
    after,
  )
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new MarketReadError('INVALID_MARKET_READ_INPUT', 400)
  }
  const cursor = marketReadInput(cursorSchema, value)
  marketReadInput(
    z.literal(true),
    cursor.profileId === selector.profileId &&
      cursor.typeId === selector.typeId &&
      cursor.observationId === selector.observationId &&
      cursor.side === selector.side,
  )
  return {
    cursorPrice: cursor.price,
    cursorIssuedAt: cursor.issuedAt,
    cursorOrderId: cursor.orderId,
  }
}

export const encodeMarketOrderCursor = (
  selector: MarketOrderSelector,
  row: { price: string; issuedAt: string; orderId: number },
) =>
  Buffer.from(
    JSON.stringify({
      version: 1,
      ...selector,
      price: row.price,
      issuedAt: row.issuedAt,
      orderId: row.orderId,
    }),
  ).toString('base64url')
