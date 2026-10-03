import { z } from 'zod'
import type { PlatformInventoryRead } from '@eve-space/platform-module-contract/inventory'
import type { PlatformGraphQLReadInput } from '@eve-space/platform-module-contract/graphql'

class TradingInputError extends Error {
  readonly code = 'BAD_USER_INPUT'
}

export const inventoryReadInput = (
  args: PlatformGraphQLReadInput['args'],
): PlatformInventoryRead => {
  const filters = z.strictObject({
    typeId: z.coerce.number().int().positive().safe().nullish(),
    groupId: z.coerce.number().int().positive().safe().nullish(),
    categoryId: z.coerce.number().int().positive().safe().nullish(),
    locationKey: z.string().min(1).max(100).nullish(),
  })
  const input = z.object({
    kind: z.enum(['groups', 'holders', 'coverage']).default('groups'),
    first: z.number().int().min(1).max(100).default(50),
    after: z.string().min(1).max(4096).nullish(),
    groupKey: z.string().min(1).max(256).nullish(),
    filters: filters.nullish(),
  })
  const parsed = input.safeParse(args)
  if (!parsed.success) throw new TradingInputError()
  const value = parsed.data
  const page = { first: value.first, ...(value.after && { after: value.after }) }
  if (value.kind === 'coverage') {
    if (value.filters || value.groupKey) throw new TradingInputError()
    return { kind: 'coverage', ...page }
  }
  if (value.kind === 'holders') {
    if (!value.groupKey || value.filters) throw new TradingInputError()
    return { kind: 'holders', groupKey: value.groupKey, ...page }
  }
  if (value.groupKey) throw new TradingInputError()
  return {
    kind: 'groups',
    ...page,
    filters: Object.fromEntries(Object.entries(value.filters ?? {}).filter(([, v]) => v != null)),
  }
}
