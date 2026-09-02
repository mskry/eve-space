import { inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sdeTypes } from '../db/schema.js'

const financeTypeLookupBatchSize = 1_000

export async function loadFinanceTypeNames(typeIds: readonly number[]) {
  const uniqueTypeIds = [...new Set(typeIds)]
  if (uniqueTypeIds.some((typeId) => !Number.isSafeInteger(typeId) || typeId <= 0))
    throw new Error('Finance type lookup IDs must be positive safe integers')
  if (uniqueTypeIds.length === 0) return new Map<number, string>()

  const batches = Array.from(
    { length: Math.ceil(uniqueTypeIds.length / financeTypeLookupBatchSize) },
    (_, index) =>
      uniqueTypeIds.slice(
        index * financeTypeLookupBatchSize,
        (index + 1) * financeTypeLookupBatchSize,
      ),
  )
  const rowsByBatch = await Promise.all(
    batches.map((batch) =>
      db
        .select({ typeId: sdeTypes.typeId, typeName: sdeTypes.name })
        .from(sdeTypes)
        .where(inArray(sdeTypes.typeId, batch)),
    ),
  )
  const namesByType = new Map<number, string>()
  for (const rows of rowsByBatch) for (const row of rows) namesByType.set(row.typeId, row.typeName)
  return namesByType
}

export function financeTypeName(typeId: number, namesByType: ReadonlyMap<number, string>) {
  return namesByType.get(typeId) ?? `Unknown type ${typeId}`
}
