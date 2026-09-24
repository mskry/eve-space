import type { PlatformPersistenceOperationInvoker } from '@eve-space/platform-module-server'
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

type PersistenceCapabilityFactory = (invoke: PlatformPersistenceOperationInvoker) => object
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
        ...(signal ? { signal } : {}),
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
  const factories = installedModulePersistenceCapabilityFactories[group] as Readonly<
    Record<string, PersistenceCapabilityFactory>
  >
  const factory = factories[`${moduleId}/${contributionId}`]
  if (!factory) {
    throw new Error(`Missing generated persistence capability ${moduleId}/${contributionId}`)
  }
  return factory as (
    invoke: PlatformPersistenceOperationInvoker,
  ) => PersistenceCapabilityResult<Group, ModuleId, ContributionId>
}
