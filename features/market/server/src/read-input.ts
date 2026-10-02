import { z } from 'zod'

export class MarketReadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

export const marketReadInput = <Schema extends z.ZodType, Value>(schema: Schema, value: Value) => {
  const result = schema.safeParse(value)
  if (!result.success) throw new MarketReadError('INVALID_MARKET_READ_INPUT', 400)
  return result.data
}

export const marketReadId = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .transform(Number)
  .pipe(z.number().int().positive().safe())

export const marketReadRevision = z.string().regex(/^[\w-]{1,192}$/)
export const marketReadPageSize = z.number().int().min(1).max(100).default(100)
export const marketCatalogueCursor = z
  .string()
  .regex(/^t_[\da-z]{1,12}$/)
  .refine((cursor) => {
    const id = Number.parseInt(cursor.slice(2), 36)
    return Number.isSafeInteger(id) && id > 0
  }, 'Invalid market group cursor')
export const marketOptionalCatalogueCursor = z
  .nullish(marketCatalogueCursor)
  .transform((cursor) => cursor ?? undefined)
