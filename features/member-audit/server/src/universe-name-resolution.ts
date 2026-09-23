import type { PlatformResourceOperationMethods } from '@eve-space/platform-module-contract/resources'
import type { PlatformCoreEsiOperationProtocol } from '@eve-space/platform-module-server'
import { z } from 'zod'

const maximumUniverseNameIds = 1_000
const universeNamesSchema = z.array(
  z.strictObject({
    id: z.number().int().positive(),
    name: z.string().min(1).max(500),
    category: z.string().min(1).max(100),
  }),
)

type UniverseNameProtocol = PlatformCoreEsiOperationProtocol<'universe-resolve-names'>

interface UniverseNameExecutionContext {
  readonly operations: PlatformResourceOperationMethods<UniverseNameProtocol>
}

export interface ResolvedUniverseName {
  readonly name: string
  readonly category: string
}

export async function resolveUniverseNamesBestEffort(
  ids: readonly number[],
  context: UniverseNameExecutionContext,
) {
  const uniqueIds = [...new Set(ids)]
  const chunks = Array.from(
    { length: Math.ceil(uniqueIds.length / maximumUniverseNameIds) },
    (_, index) =>
      uniqueIds.slice(index * maximumUniverseNameIds, (index + 1) * maximumUniverseNameIds),
  )
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        return await context.operations['universe-resolve-names']({ body: chunk })
      } catch {
        return { data: [] }
      }
    }),
  )
  return new Map<number, ResolvedUniverseName>(
    results.flatMap((result) =>
      universeNamesSchema
        .parse(result.data)
        .map((entry) => [entry.id, { name: entry.name, category: entry.category }] as const),
    ),
  )
}
