import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import type postgres from 'postgres'
import { sql } from '../db/client.js'
import {
  assertRegisteredEsiOperation,
  getOptionalCharacterEsiScope,
  type EsiOperation,
} from '../esi-resilience/catalog.js'
import { installedModuleResources } from '../generated/platform/installed-module-worker.js'
import {
  platformCollectionFailureClasses,
  platformCollectionStateIdentitySchema,
  type PlatformCollectionFailureClass,
  type PlatformCollectionStateIdentity,
} from './collection-state.js'

const platformResourceDueReasons = [
  'never-collected',
  'authorization-changed',
  'unscheduled',
  'elapsed',
  'future',
] as const
type PlatformResourceDueReason = (typeof platformResourceDueReasons)[number]

export type PlatformResourceEligibility =
  | {
      readonly status: 'eligible'
      readonly due: boolean
      readonly dueReason: PlatformResourceDueReason
      readonly schedulingKey: Date
      readonly authorizationGeneration: number | null
      readonly nextEligibleAt: Date | null
      readonly validatedAt: Date | null
      readonly lastFailureClass: PlatformCollectionFailureClass | null
    }
  | {
      readonly status: 'authorization-required'
      readonly authorizationGeneration: number | null
      readonly requiredScope: string
      readonly dueReason: null
      readonly schedulingKey: null
      readonly nextEligibleAt: Date | null
      readonly validatedAt: Date | null
      readonly lastFailureClass: PlatformCollectionFailureClass | null
    }
  | {
      readonly status: 'disabled' | 'suppressed'
      readonly authorizationGeneration: number | null
      readonly dueReason: null
      readonly schedulingKey: null
      readonly nextEligibleAt: Date | null
      readonly validatedAt: Date | null
      readonly lastFailureClass: PlatformCollectionFailureClass | null
    }
  | { readonly status: 'obsolete' | 'resource-unavailable' }

export type PlatformResourceIneligibleStatus = Exclude<
  PlatformResourceEligibility['status'],
  'eligible'
>

interface ClassificationRow {
  readonly moduleId: string
  readonly resourceId: string
  readonly subjectKind: string
  readonly subjectLifecycleId: string
  readonly subjectId: string
  readonly operationId: string
  readonly eligibilityStatus: string
  readonly expectedAuthorizationGeneration: number | null
  readonly requiredScope: string | null
  readonly dueReason: string | null
  readonly schedulingKey: DatabaseTimestamp
  readonly nextEligibleAt: DatabaseTimestamp
  readonly validatedAt: DatabaseTimestamp
  readonly lastFailureClass: string | null
}

type DatabaseTimestamp = Date | string | null

interface EligibilityOptions {
  readonly connection?: postgres.Sql | postgres.TransactionSql
  readonly now?: Date
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
}

export interface DueInstalledResource {
  readonly identity: PlatformCollectionStateIdentity
  readonly operationId: EsiOperation
}

interface SelectDueResourcesOptions extends EligibilityOptions {
  readonly limit: number
}

export async function resolveInstalledResourceEligibility(
  identity: PlatformCollectionStateIdentity,
  options: EligibilityOptions = {},
): Promise<PlatformResourceEligibility> {
  const parsed = platformCollectionStateIdentitySchema.parse(identity)
  const resources = options.resources ?? installedModuleResources
  const resource = resources.find(
    ({ moduleId, resourceId }) => moduleId === parsed.moduleId && resourceId === parsed.resourceId,
  )
  if (resource?.subjectKind !== parsed.subjectKind) return { status: 'resource-unavailable' }

  const connection = options.connection ?? sql
  const [row] = await connection<ClassificationRow[]>`
    select
      module_id as "moduleId",
      resource_id as "resourceId",
      subject_kind as "subjectKind",
      subject_lifecycle_id as "subjectLifecycleId",
      subject_id as "subjectId",
      operation_id as "operationId",
      eligibility_status as "eligibilityStatus",
      expected_authorization_generation as "expectedAuthorizationGeneration",
      required_scope as "requiredScope",
      due_reason as "dueReason",
      scheduling_key as "schedulingKey",
      next_eligible_at as "nextEligibleAt",
      validated_at as "validatedAt",
      last_failure_class as "lastFailureClass"
    from platform_classify_resources(
      ${JSON.stringify(toPlanningResources([resource]))}::text::jsonb,
      ${(options.now ?? new Date()).toISOString()}::text::timestamptz,
      ${parsed.moduleId},
      ${parsed.resourceId},
      ${parsed.subjectKind},
      ${parsed.subjectLifecycleId},
      ${parsed.subjectId}
    )
  `
  return row ? parseClassification(row) : { status: 'obsolete' }
}

export async function selectDueInstalledResources(
  options: SelectDueResourcesOptions,
): Promise<readonly DueInstalledResource[]> {
  if (!Number.isSafeInteger(options.limit) || options.limit <= 0)
    throw new Error('Resource planning limit must be a positive safe integer')
  const resources = options.resources ?? installedModuleResources
  if (resources.length === 0) return []

  const connection = options.connection ?? sql
  const rows = await connection<ClassificationRow[]>`
    select
      module_id as "moduleId",
      resource_id as "resourceId",
      subject_kind as "subjectKind",
      subject_lifecycle_id as "subjectLifecycleId",
      subject_id as "subjectId",
      operation_id as "operationId",
      eligibility_status as "eligibilityStatus",
      expected_authorization_generation as "expectedAuthorizationGeneration",
      required_scope as "requiredScope",
      due_reason as "dueReason",
      scheduling_key as "schedulingKey",
      next_eligible_at as "nextEligibleAt",
      validated_at as "validatedAt",
      last_failure_class as "lastFailureClass"
    from platform_classify_resources(
      ${JSON.stringify(toPlanningResources(resources))}::text::jsonb,
      ${(options.now ?? new Date()).toISOString()}::text::timestamptz
    )
    where eligibility_status = 'eligible'
      and due_reason <> 'future'
    order by scheduling_key, module_id, resource_id, subject_kind,
      subject_lifecycle_id, subject_id
    limit ${options.limit}
  `

  return rows.map((row) => {
    const classification = parseClassification(row)
    if (classification.status !== 'eligible' || !classification.due)
      throw new Error('Resource classifier returned a non-due planning row')
    assertRegisteredEsiOperation(row.operationId)
    return {
      identity: platformCollectionStateIdentitySchema.parse({
        moduleId: row.moduleId,
        resourceId: row.resourceId,
        subjectKind: row.subjectKind,
        subjectLifecycleId: row.subjectLifecycleId,
        subjectId: row.subjectId,
      }),
      operationId: row.operationId,
    }
  })
}

function toPlanningResources(resources: readonly PlatformInstalledResourceDescriptor[]) {
  const seen = new Set<string>()
  return resources.map((resource) => {
    const identity = `${resource.moduleId}\0${resource.resourceId}\0${resource.subjectKind}`
    if (seen.has(identity))
      throw new Error(
        `Duplicate installed resource planning identity: ${resource.moduleId}/${resource.resourceId}/${resource.subjectKind}`,
      )
    seen.add(identity)
    assertRegisteredEsiOperation(resource.operationId)
    return {
      module_id: resource.moduleId,
      resource_id: resource.resourceId,
      subject_kind: resource.subjectKind,
      operation_id: resource.operationId,
      required_scope: getOptionalCharacterEsiScope(resource.operationId),
    }
  })
}

function parseClassification(row: ClassificationRow): PlatformResourceEligibility {
  const state = {
    authorizationGeneration: row.expectedAuthorizationGeneration,
    nextEligibleAt: toDate(row.nextEligibleAt),
    validatedAt: toDate(row.validatedAt),
    lastFailureClass: parseFailureClass(row.lastFailureClass),
  }
  if (row.eligibilityStatus === 'disabled' || row.eligibilityStatus === 'suppressed')
    return { status: row.eligibilityStatus, dueReason: null, schedulingKey: null, ...state }
  if (row.eligibilityStatus === 'authorization-required') {
    if (!row.requiredScope)
      throw new Error('Resource classifier omitted the required authorization scope')
    return {
      status: 'authorization-required',
      requiredScope: row.requiredScope,
      dueReason: null,
      schedulingKey: null,
      ...state,
    }
  }
  if (row.eligibilityStatus !== 'eligible')
    throw new Error(`Resource classifier returned invalid eligibility ${row.eligibilityStatus}`)
  if (!row.dueReason || !platformResourceDueReasons.includes(row.dueReason as never))
    throw new Error(`Resource classifier returned invalid due reason ${String(row.dueReason)}`)
  const schedulingKey = toDate(row.schedulingKey)
  if (!schedulingKey) throw new Error('Resource classifier omitted the scheduling key')
  return {
    status: 'eligible',
    due: row.dueReason !== 'future',
    dueReason: row.dueReason as PlatformResourceDueReason,
    schedulingKey,
    ...state,
  }
}

function toDate(value: Date | string | null) {
  if (value === null) return null
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`Resource classifier returned invalid time ${value}`)
  return parsed
}

function parseFailureClass(value: string | null) {
  if (value === null) return null
  if (!platformCollectionFailureClasses.includes(value as never))
    throw new Error(`Resource classifier returned invalid failure class ${value}`)
  return value as PlatformCollectionFailureClass
}
