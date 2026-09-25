import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import type postgres from 'postgres'
import { sql } from '../db/client.js'
import {
  assertRegisteredEsiOperation,
  type EsiOperation,
} from '../esi-gateway/catalog-interface.js'
import { isPositiveSafeInteger } from '../type-guards.js'
import {
  platformCollectionFailureClasses,
  platformCollectionStateIdentitySchema,
  type PlatformCollectionFailureClass,
  type PlatformCollectionStateIdentity,
} from './collection-state.js'
import { createPlatformResourceClassifierInput } from './resource-classifier-input.js'
import { platformResources } from './resources.js'

export { createPlatformResourceClassifierInput } from './resource-classifier-input.js'

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
      readonly authorizationCharacterId?: number | null
      readonly authorizationCharacterLifecycleId?: string | null
      readonly nextEligibleAt: Date | null
      readonly validatedAt: Date | null
      readonly lastFailureClass: PlatformCollectionFailureClass | null
      readonly managedAuthority: PlatformManagedCollectionAuthority | null
    }
  | {
      readonly status: 'authorization-required'
      readonly authorizationGeneration: number | null
      readonly authorizationCharacterId?: number | null
      readonly authorizationCharacterLifecycleId?: string | null
      readonly requiredScope: string
      readonly dueReason: null
      readonly schedulingKey: null
      readonly nextEligibleAt: Date | null
      readonly validatedAt: Date | null
      readonly lastFailureClass: PlatformCollectionFailureClass | null
      readonly managedAuthority: PlatformManagedCollectionAuthority | null
    }
  | {
      readonly status: 'disabled' | 'suppressed'
      readonly authorizationGeneration: number | null
      readonly authorizationCharacterId?: number | null
      readonly authorizationCharacterLifecycleId?: string | null
      readonly dueReason: null
      readonly schedulingKey: null
      readonly nextEligibleAt: Date | null
      readonly validatedAt: Date | null
      readonly lastFailureClass: PlatformCollectionFailureClass | null
      readonly managedAuthority: PlatformManagedCollectionAuthority | null
    }
  | { readonly status: 'obsolete' | 'resource-unavailable' }

export interface PlatformManagedCollectionAuthority {
  readonly organizationDeploymentId: 1
  readonly organizationVersion: number
  readonly targetUserId: string
  readonly managedMemberLifecycleId: string
  readonly sectionId: string
  readonly disclosureVersion: number
  readonly sectionActivationVersion: number
}

export function managedCollectionAuthorityEquals(
  left: PlatformManagedCollectionAuthority | null | undefined,
  right: PlatformManagedCollectionAuthority | null | undefined,
) {
  if (!left || !right) {
    return left == null && right == null
  }
  return (
    left.organizationDeploymentId === right.organizationDeploymentId &&
    left.organizationVersion === right.organizationVersion &&
    left.targetUserId === right.targetUserId &&
    left.managedMemberLifecycleId === right.managedMemberLifecycleId &&
    left.sectionId === right.sectionId &&
    left.disclosureVersion === right.disclosureVersion &&
    left.sectionActivationVersion === right.sectionActivationVersion
  )
}

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
  readonly authorizationCharacterId: number | string | null
  readonly authorizationCharacterLifecycleId: string | null
  readonly requiredScope: string | null
  readonly organizationDeploymentId: number | null
  readonly organizationVersion: number | string | null
  readonly targetUserId: string | null
  readonly managedMemberLifecycleId: string | null
  readonly authoritySectionId: string | null
  readonly disclosureVersion: number | null
  readonly sectionActivationVersion: number | null
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
  readonly signal?: AbortSignal
}

export interface DueInstalledResource {
  readonly identity: PlatformCollectionStateIdentity
  readonly operationId: EsiOperation
  readonly authorizationCharacterId?: number | null
}

interface SelectDueResourcesOptions extends EligibilityOptions {
  readonly limit: number
}

export async function resolveInstalledResourceEligibility(
  identity: PlatformCollectionStateIdentity,
  options: EligibilityOptions = {},
): Promise<PlatformResourceEligibility> {
  options.signal?.throwIfAborted()
  const parsed = platformCollectionStateIdentitySchema.parse(identity)
  const resources = options.resources ?? platformResources
  const resource = resources.find(
    ({ moduleId, resourceId }) => moduleId === parsed.moduleId && resourceId === parsed.resourceId,
  )
  if (resource?.subjectKind !== parsed.subjectKind) {
    return { status: 'resource-unavailable' }
  }

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
      authorization_character_id as "authorizationCharacterId",
      authorization_character_lifecycle_id as "authorizationCharacterLifecycleId",
      required_scope as "requiredScope",
      organization_deployment_id as "organizationDeploymentId",
      organization_version as "organizationVersion",
      target_user_id as "targetUserId",
      managed_member_lifecycle_id as "managedMemberLifecycleId",
      authority_section_id as "authoritySectionId",
      disclosure_version as "disclosureVersion",
      section_activation_version as "sectionActivationVersion",
      due_reason as "dueReason",
      scheduling_key as "schedulingKey",
      next_eligible_at as "nextEligibleAt",
      validated_at as "validatedAt",
      last_failure_class as "lastFailureClass"
    from platform_classify_resources(
      ${JSON.stringify(createPlatformResourceClassifierInput([resource]))}::text::jsonb,
      ${(options.now ?? new Date()).toISOString()}::text::timestamptz,
      ${parsed.moduleId},
      ${parsed.resourceId},
      ${parsed.subjectKind},
      ${parsed.subjectLifecycleId},
      ${parsed.subjectId}
    )
  `
  options.signal?.throwIfAborted()
  return row ? parseClassification(row) : { status: 'obsolete' }
}

export async function selectDueInstalledResources(
  options: SelectDueResourcesOptions,
): Promise<readonly DueInstalledResource[]> {
  options.signal?.throwIfAborted()
  if (!isPositiveSafeInteger(options.limit)) {
    throw new Error('Resource planning limit must be a positive safe integer')
  }
  const resources = (options.resources ?? platformResources).filter(
    ({ scheduled }) => scheduled !== false,
  )
  if (resources.length === 0) {
    return []
  }

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
      authorization_character_id as "authorizationCharacterId",
      authorization_character_lifecycle_id as "authorizationCharacterLifecycleId",
      required_scope as "requiredScope",
      organization_deployment_id as "organizationDeploymentId",
      organization_version as "organizationVersion",
      target_user_id as "targetUserId",
      managed_member_lifecycle_id as "managedMemberLifecycleId",
      authority_section_id as "authoritySectionId",
      disclosure_version as "disclosureVersion",
      section_activation_version as "sectionActivationVersion",
      due_reason as "dueReason",
      scheduling_key as "schedulingKey",
      next_eligible_at as "nextEligibleAt",
      validated_at as "validatedAt",
      last_failure_class as "lastFailureClass"
    from platform_classify_resources(
      ${JSON.stringify(createPlatformResourceClassifierInput(resources))}::text::jsonb,
      ${(options.now ?? new Date()).toISOString()}::text::timestamptz
    )
    where eligibility_status = 'eligible'
      and due_reason <> 'future'
    order by scheduling_key, module_id, resource_id, subject_kind,
      subject_lifecycle_id, subject_id
    limit ${options.limit}
  `
  options.signal?.throwIfAborted()

  return rows.map((row) => {
    const classification = parseClassification(row)
    if (classification.status !== 'eligible' || !classification.due) {
      throw new Error('Resource classifier returned a non-due planning row')
    }
    assertRegisteredEsiOperation(row.operationId)
    const due: DueInstalledResource = {
      identity: platformCollectionStateIdentitySchema.parse({
        moduleId: row.moduleId,
        resourceId: row.resourceId,
        subjectId: row.subjectId,
        subjectKind: row.subjectKind,
        subjectLifecycleId: row.subjectLifecycleId,
      }),
      operationId: row.operationId,
    }
    return row.subjectKind === 'corporation'
      ? Object.assign(due, {
          authorizationCharacterId: parseAuthorizationCharacterId(row.authorizationCharacterId),
        })
      : due
  })
}

function parseClassification(row: ClassificationRow): PlatformResourceEligibility {
  const state = {
    authorizationGeneration: row.expectedAuthorizationGeneration,
    ...(row.subjectKind === 'corporation' && {
      authorizationCharacterId: parseAuthorizationCharacterId(row.authorizationCharacterId),
      authorizationCharacterLifecycleId: row.authorizationCharacterLifecycleId ?? null,
    }),
    nextEligibleAt: toDate(row.nextEligibleAt),
    validatedAt: toDate(row.validatedAt),
    lastFailureClass: parseFailureClass(row.lastFailureClass),
    managedAuthority: parseManagedAuthority(row),
  }
  if (row.eligibilityStatus === 'disabled' || row.eligibilityStatus === 'suppressed') {
    return { dueReason: null, schedulingKey: null, status: row.eligibilityStatus, ...state }
  }
  if (row.eligibilityStatus === 'authorization-required') {
    if (!row.requiredScope) {
      throw new Error('Resource classifier omitted the required authorization scope')
    }
    return {
      dueReason: null,
      requiredScope: row.requiredScope,
      schedulingKey: null,
      status: 'authorization-required',
      ...state,
    }
  }
  if (row.eligibilityStatus !== 'eligible') {
    throw new Error(`Resource classifier returned invalid eligibility ${row.eligibilityStatus}`)
  }
  if (!row.dueReason || !platformResourceDueReasons.includes(row.dueReason as never)) {
    throw new Error(`Resource classifier returned invalid due reason ${String(row.dueReason)}`)
  }
  const schedulingKey = toDate(row.schedulingKey)
  if (!schedulingKey) {
    throw new Error('Resource classifier omitted the scheduling key')
  }
  return {
    due: row.dueReason !== 'future',
    dueReason: row.dueReason as PlatformResourceDueReason,
    schedulingKey,
    status: 'eligible',
    ...state,
  }
}

function parseManagedAuthority(row: ClassificationRow): PlatformManagedCollectionAuthority | null {
  const values = [
    row.organizationDeploymentId,
    row.organizationVersion,
    row.targetUserId,
    row.managedMemberLifecycleId,
    row.authoritySectionId,
    row.disclosureVersion,
    row.sectionActivationVersion,
  ]
  if (values.every((value) => value === null)) {
    return null
  }
  if (values.includes(null)) {
    throw new Error('Resource classifier returned incomplete managed authority')
  }
  const organizationVersion = Number(row.organizationVersion)
  if (
    row.organizationDeploymentId !== 1 ||
    !isPositiveSafeInteger(organizationVersion) ||
    !row.targetUserId ||
    !row.managedMemberLifecycleId ||
    !row.authoritySectionId ||
    !isPositiveSafeInteger(row.disclosureVersion!) ||
    !isPositiveSafeInteger(row.sectionActivationVersion!)
  ) {
    throw new Error('Resource classifier returned invalid managed authority')
  }
  return {
    disclosureVersion: row.disclosureVersion!,
    managedMemberLifecycleId: row.managedMemberLifecycleId,
    organizationDeploymentId: 1,
    organizationVersion,
    sectionActivationVersion: row.sectionActivationVersion!,
    sectionId: row.authoritySectionId,
    targetUserId: row.targetUserId,
  }
}

function parseAuthorizationCharacterId(value: number | string | null | undefined) {
  if (value == null) {
    return null
  }
  const parsed = Number(value)
  if (!isPositiveSafeInteger(parsed)) {
    throw new Error(`Resource classifier returned invalid authorization character ${value}`)
  }
  return parsed
}

function toDate(value: Date | string | null) {
  if (value === null) {
    return null
  }
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Resource classifier returned invalid time ${value}`)
  }
  return parsed
}

function parseFailureClass(value: string | null) {
  if (value === null) {
    return null
  }
  if (!platformCollectionFailureClasses.includes(value as never)) {
    throw new Error(`Resource classifier returned invalid failure class ${value}`)
  }
  return value as PlatformCollectionFailureClass
}
