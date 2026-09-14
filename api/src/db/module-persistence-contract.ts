import { createHash } from 'node:crypto'
import type { PlatformPersistenceOperationMode } from '@eve-space/platform-module-contract'

interface ModulePersistenceContractOperation {
  readonly moduleId: string
  readonly operationId: string
  readonly method?: string
  readonly revision: number
  readonly mode: PlatformPersistenceOperationMode
  readonly migration: string
  readonly schemaName: string
  readonly routineName: string
  readonly definitionFingerprint: string
  readonly grants?: {
    readonly routes: readonly string[]
    readonly activityProviders: readonly string[]
    readonly resourceProjections: readonly string[]
    readonly resourceMaterializations: readonly string[]
  }
}

export function createModulePersistenceContractFingerprint(
  operations: readonly ModulePersistenceContractOperation[],
  moduleIds: readonly string[] = [...new Set(operations.map(({ moduleId }) => moduleId))],
) {
  const contract = {
    moduleIds: [...moduleIds].toSorted((left, right) => left.localeCompare(right)),
    operations: operations
      .map(
        ({
          moduleId,
          operationId,
          method,
          revision,
          mode,
          migration,
          schemaName,
          routineName,
          definitionFingerprint,
          grants,
        }) => ({
          moduleId,
          operationId,
          method: method ?? null,
          revision,
          mode,
          migration,
          schemaName,
          routineName,
          definitionFingerprint,
          grants: grants ?? null,
        }),
      )
      .toSorted((left, right) =>
        `${left.moduleId}/${left.operationId}`.localeCompare(
          `${right.moduleId}/${right.operationId}`,
        ),
      ),
  }
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex')
}
