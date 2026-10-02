import {
  bindPlatformPersistenceOperation,
  type PlatformInstalledPersistenceOperationDescriptor,
  type PlatformPersistenceOperationInvoker,
} from '@eve-space/platform-module-server'
import type { PlatformPersistenceOperationReference } from '@eve-space/platform-module-contract/persistence'
import type postgres from 'postgres'
import { sql } from '../db/client.js'
import {
  createStandaloneModulePersistenceOperationInvoker,
  createTransactionScopedModulePersistenceOperationInvoker,
} from '../db/module-persistence-operation-transaction.js'
import {
  installedModulePersistenceCapabilityFactories,
  installedModulePersistenceOperations,
} from '../generated/platform/installed-module-persistence.js'

const resourcePersistenceTimeoutMilliseconds = 2000
const installedReadOperations: readonly PlatformInstalledPersistenceOperationDescriptor[] =
  installedModulePersistenceOperations

export interface ModuleReadPersistenceDeclaration {
  readonly moduleId: string
  readonly contributionId: string
  readonly grant: 'routes' | 'graphqlReads'
  readonly operations: readonly PlatformPersistenceOperationReference[]
}

type PersistenceCapabilityFactory = (invoke: PlatformPersistenceOperationInvoker) => object
type PersistenceRead = ReturnType<typeof bindPlatformPersistenceOperation>
type PersistenceCapabilityFactories = typeof installedModulePersistenceCapabilityFactories
type PersistenceCapabilityGroup = keyof PersistenceCapabilityFactories
type PersistenceCapabilityResult<
  Group extends PersistenceCapabilityGroup,
  ModuleId extends string,
  ContributionId extends string,
> = `${ModuleId}/${ContributionId}` extends keyof PersistenceCapabilityFactories[Group]
  ? PersistenceCapabilityFactories[Group][`${ModuleId}/${ContributionId}`] extends (
      invoke: PlatformPersistenceOperationInvoker,
    ) => infer Result
    ? Result
    : never
  : object

export const createPlatformModuleReadPersistence = (
  declaration: ModuleReadPersistenceDeclaration,
  signal?: AbortSignal,
) => {
  const methods: Record<string, PersistenceRead> = {}
  const names = new Set<string>()
  const selected = declaration.operations.map((reference) => {
    const operation = installedReadOperations.find(
      (candidate) =>
        candidate.moduleId === declaration.moduleId &&
        candidate.operationId === reference.operationId &&
        candidate.mode === 'read' &&
        candidate.grants[declaration.grant]?.includes(declaration.contributionId),
    )
    if (!operation || names.has(operation.method)) {
      throw new Error('Missing or duplicate installed read-only persistence grant')
    }
    names.add(operation.method)
    return operation
  })
  const invoke = createStandaloneModulePersistenceOperationInvoker(
    sql,
    declaration.moduleId,
    selected,
    {
      readOnly: true,
      signal,
      statementTimeoutMilliseconds: resourcePersistenceTimeoutMilliseconds,
    },
  )
  for (const operation of selected)
    methods[operation.method] = bindPlatformPersistenceOperation(operation, invoke)
  return Object.freeze(methods)
}

export function createPlatformModuleRoutePersistence<
  const ModuleId extends string,
  const RouteId extends string,
>(moduleId: ModuleId, routeId: RouteId) {
  return resolveFactory(
    'routes',
    moduleId,
    routeId,
  )(
    createStandaloneModulePersistenceOperationInvoker(
      sql,
      moduleId,
      installedModulePersistenceOperations,
    ),
  )
}

export function createPlatformModuleActivityProviderPersistence<
  const ModuleId extends string,
  const ProviderId extends string,
>(
  moduleId: ModuleId,
  providerId: ProviderId,
  signal: AbortSignal,
  statementTimeoutMilliseconds: number,
) {
  return resolveFactory(
    'activityProviders',
    moduleId,
    providerId,
  )(
    createStandaloneModulePersistenceOperationInvoker(
      sql,
      moduleId,
      installedModulePersistenceOperations,
      { readOnly: true, signal, statementTimeoutMilliseconds },
    ),
  )
}

export function createPlatformResourceProjectionPersistence<
  const ModuleId extends string,
  const ResourceId extends string,
>(moduleId: ModuleId, resourceId: ResourceId, signal?: AbortSignal) {
  return resolveFactory(
    'resourceProjections',
    moduleId,
    resourceId,
  )(
    createStandaloneModulePersistenceOperationInvoker(
      sql,
      moduleId,
      installedModulePersistenceOperations,
      {
        readOnly: true,
        statementTimeoutMilliseconds: resourcePersistenceTimeoutMilliseconds,
        ...(signal && { signal }),
      },
    ),
  )
}

export function createPlatformResourceMaterializationPersistence<
  const ModuleId extends string,
  const ResourceId extends string,
>(
  transaction: postgres.TransactionSql,
  moduleId: ModuleId,
  resourceId: ResourceId,
  signal?: AbortSignal,
) {
  const scoped = createTransactionScopedModulePersistenceOperationInvoker(
    transaction,
    moduleId,
    installedModulePersistenceOperations,
    signal,
  )
  return {
    ...scoped,
    persistence: resolveFactory('resourceMaterializations', moduleId, resourceId)(scoped.invoke),
  }
}

export function createPlatformResourceMaintenancePersistence<
  const ModuleId extends string,
  const ResourceId extends string,
>(moduleId: ModuleId, resourceId: ResourceId, signal?: AbortSignal) {
  return resolveFactory(
    'resourceMaterializations',
    moduleId,
    resourceId,
  )(
    createStandaloneModulePersistenceOperationInvoker(
      sql,
      moduleId,
      installedModulePersistenceOperations,
      signal ? { signal } : {},
    ),
  )
}

function resolveFactory<
  Group extends PersistenceCapabilityGroup,
  ModuleId extends string,
  ContributionId extends string,
>(group: Group, moduleId: ModuleId, contributionId: ContributionId) {
  const factories: Readonly<Record<string, PersistenceCapabilityFactory>> =
    installedModulePersistenceCapabilityFactories[group]
  const factory = factories[`${moduleId}/${contributionId}`]
  if (!factory) {
    throw new Error(`Missing generated persistence capability ${moduleId}/${contributionId}`)
  }
  return factory as (
    invoke: PlatformPersistenceOperationInvoker,
  ) => PersistenceCapabilityResult<Group, ModuleId, ContributionId>
}
