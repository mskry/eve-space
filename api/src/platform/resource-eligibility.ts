import { createHash } from 'node:crypto'
import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import type postgres from 'postgres'
import {
  evaluateCorporationResourceAuthority,
  lockCorporationResourceAuthorityInTransaction,
  type CorporationResourceAuthorityCandidate,
  type CorporationResourceAuthorityVerdict,
} from '../characters/corporation-role-evidence.js'
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
import { getManagedCorporationResourceRequirements } from './resource-declarations.js'
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
const dueReasonSet: ReadonlySet<string> = new Set(platformResourceDueReasons)
const collectionFailureClassSet: ReadonlySet<string> = new Set(platformCollectionFailureClasses)

const isPlatformResourceDueReason = (value: string | null): value is PlatformResourceDueReason =>
  value !== null && dueReasonSet.has(value)

const isPlatformCollectionFailureClass = (value: string): value is PlatformCollectionFailureClass =>
  collectionFailureClassSet.has(value)

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
      readonly corporationAuthorityFence?: PlatformCorporationAuthorityFence
    }
  | {
      readonly status: 'authorization-required'
      readonly authorizationGeneration: number | null
      readonly authorizationCharacterId?: number | null
      readonly authorizationCharacterLifecycleId?: string | null
      readonly requiredScope: string
      readonly authorizationReason?:
        | 'scope-missing'
        | 'role-unsatisfied'
        | 'role-evidence-unavailable'
        | 'source-invalid'
      readonly requiredRolePredicates?: readonly string[]
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

export interface PlatformCorporationAuthorityFence {
  readonly sourceId: string
  readonly organizationVersion: number
  readonly corporationLifecycleId: string
  readonly corporationId: number
  readonly characterId: number
  readonly characterLifecycleId: string
  readonly affiliationPeriodRevision: string | null
  readonly authorizationGeneration: number
  readonly requirementsFingerprint: string
  readonly roleRevision: string | null
}

export const createCorporationContinuationAuthorityBinding = (
  fence: PlatformCorporationAuthorityFence,
): string => {
  const components = [
    'corporation-continuation-v1',
    fence.organizationVersion,
    fence.sourceId,
    fence.corporationLifecycleId,
    fence.corporationId,
    fence.characterId,
    fence.characterLifecycleId,
    fence.affiliationPeriodRevision,
    fence.authorizationGeneration,
    fence.requirementsFingerprint,
    fence.roleRevision ?? 'none',
  ]
  return `v1:${createHash('sha256').update(JSON.stringify(components)).digest('hex')}`
}

export const corporationAuthorityFenceEquals = (
  left: PlatformCorporationAuthorityFence | null | undefined,
  right: PlatformCorporationAuthorityFence | null | undefined,
): boolean => {
  if (!left || !right) return left == null && right == null
  return (
    left.sourceId === right.sourceId &&
    left.organizationVersion === right.organizationVersion &&
    left.corporationLifecycleId === right.corporationLifecycleId &&
    left.corporationId === right.corporationId &&
    left.characterId === right.characterId &&
    left.characterLifecycleId === right.characterLifecycleId &&
    left.affiliationPeriodRevision === right.affiliationPeriodRevision &&
    left.authorizationGeneration === right.authorizationGeneration &&
    left.requirementsFingerprint === right.requirementsFingerprint &&
    left.roleRevision === right.roleRevision
  )
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
  readonly schedulingKeyCursor?: string
  readonly nextEligibleAt: DatabaseTimestamp
  readonly validatedAt: DatabaseTimestamp
  readonly lastFailureClass: string | null
}

type DatabaseTimestamp = Date | string | null

type EligibilityOptions = {
  readonly now?: Date
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly signal?: AbortSignal
} & (
  | { readonly connection?: postgres.Sql | postgres.TransactionSql; readonly lockAuthority?: false }
  | { readonly connection: postgres.TransactionSql; readonly lockAuthority: true }
)

export interface DueInstalledResource {
  readonly identity: PlatformCollectionStateIdentity
  readonly operationId: EsiOperation
  readonly authorizationCharacterId?: number | null
}

type SelectDueResourcesOptions = EligibilityOptions & {
  readonly limit: number
}

interface DueCandidateCursor {
  readonly schedulingKey: string
  readonly moduleId: string
  readonly resourceId: string
  readonly subjectKind: string
  readonly subjectLifecycleId: string
  readonly subjectId: string
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
  if (!row) return { status: 'obsolete' }
  const base = parseClassification(row)
  if (
    base.status !== 'eligible' ||
    resource.eligibility.kind !== 'current-managed-corporation-source'
  ) {
    return base
  }
  const [verdict] = await classifyCorporationAuthorityRows(
    [row],
    [resource],
    connection,
    options.lockAuthority ? options.connection : undefined,
  )
  options.signal?.throwIfAborted()
  return applyCorporationRoleVerdict(base, verdict, resource, row)
}

const loadDueCandidatePage = (
  connection: postgres.Sql | postgres.TransactionSql,
  resourceInput: string,
  effectiveAt: string,
  cursor: DueCandidateCursor | null,
  pageSize: number,
) => {
  const cursorFilter = cursor
    ? connection`and (scheduling_key, module_id, resource_id, subject_kind,
        subject_lifecycle_id, subject_id) > (
        ${cursor.schedulingKey}::timestamptz, ${cursor.moduleId}, ${cursor.resourceId},
        ${cursor.subjectKind}, ${cursor.subjectLifecycleId}::uuid, ${cursor.subjectId}
      )`
    : connection``
  return connection<ClassificationRow[]>`
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
      scheduling_key::text as "schedulingKeyCursor",
      next_eligible_at as "nextEligibleAt",
      validated_at as "validatedAt",
      last_failure_class as "lastFailureClass"
    from platform_classify_resources(
      ${resourceInput}::text::jsonb,
      ${effectiveAt}::text::timestamptz
    )
    where eligibility_status = 'eligible'
      and due_reason <> 'future'
      ${cursorFilter}
    order by scheduling_key, module_id, resource_id, subject_kind,
      subject_lifecycle_id, subject_id
    limit ${pageSize}
  `
}

const projectDueResource = (row: ClassificationRow): DueInstalledResource => {
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
}

const admitDueCandidatePage = async (
  rows: readonly ClassificationRow[],
  resources: readonly PlatformInstalledResourceDescriptor[],
  connection: postgres.Sql | postgres.TransactionSql,
): Promise<readonly DueInstalledResource[]> => {
  const verdicts = await classifyCorporationAuthorityRows(rows, resources, connection)
  return rows.flatMap((row, index) => {
    const verdict = verdicts[index]
    const resource = resources.find(
      (candidate) => candidate.moduleId === row.moduleId && candidate.resourceId === row.resourceId,
    )
    if (
      resource?.eligibility.kind === 'current-managed-corporation-source' &&
      verdict?.outcome !== 'satisfied'
    ) {
      return []
    }
    return [projectDueResource(row)]
  })
}

const dueCandidateCursor = (row: ClassificationRow): DueCandidateCursor => {
  if (!row.schedulingKeyCursor) throw new Error('Resource classifier omitted the scheduling cursor')
  return {
    schedulingKey: row.schedulingKeyCursor,
    moduleId: row.moduleId,
    resourceId: row.resourceId,
    subjectKind: row.subjectKind,
    subjectLifecycleId: row.subjectLifecycleId,
    subjectId: row.subjectId,
  }
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
  if (resources.length === 0) return []

  const connection = options.connection ?? sql
  const resourceInput = JSON.stringify(createPlatformResourceClassifierInput(resources))
  const effectiveAt = (options.now ?? new Date()).toISOString()
  const pageSize = Math.max(64, Math.min(options.limit, 256))
  const admitted: DueInstalledResource[] = []
  let cursor: DueCandidateCursor | null = null
  while (admitted.length < options.limit) {
    options.signal?.throwIfAborted()
    // oxlint-disable-next-line eslint/no-await-in-loop -- Keyset pages stay ordered and each bounded authority batch settles before advancing.
    const rows = await loadDueCandidatePage(
      connection,
      resourceInput,
      effectiveAt,
      cursor,
      pageSize,
    )
    options.signal?.throwIfAborted()
    if (rows.length === 0) break
    // oxlint-disable-next-line eslint/no-await-in-loop -- Avoid unbounded role-evidence query concurrency across pages.
    const eligible = await admitDueCandidatePage(rows, resources, connection)
    options.signal?.throwIfAborted()
    admitted.push(...eligible.slice(0, options.limit - admitted.length))
    if (rows.length < pageSize) break
    cursor = dueCandidateCursor(rows.at(-1)!)
  }
  return admitted
}

const createCorporationAuthorityCandidate = (
  row: ClassificationRow,
  resource: PlatformInstalledResourceDescriptor,
): CorporationResourceAuthorityCandidate | null => {
  const characterId = parseAuthorizationCharacterId(row.authorizationCharacterId)
  const organizationVersion =
    row.organizationVersion === null ? null : Number(row.organizationVersion)
  const corporationId = Number(row.subjectId)
  if (
    !characterId ||
    !row.authorizationCharacterLifecycleId ||
    row.expectedAuthorizationGeneration === null ||
    (organizationVersion !== null && !isPositiveSafeInteger(organizationVersion)) ||
    !isPositiveSafeInteger(corporationId)
  ) {
    return null
  }
  const requirements = getManagedCorporationResourceRequirements(resource)
  return {
    authorizationGeneration: row.expectedAuthorizationGeneration,
    characterId,
    characterLifecycleId: row.authorizationCharacterLifecycleId,
    corporationId,
    corporationLifecycleId: row.subjectLifecycleId,
    organizationVersion,
    predicates: requirements.rolePredicates,
    requiredScopes: requirements.scopes,
  }
}

const classifyCorporationAuthorityRows = async (
  rows: readonly ClassificationRow[],
  resources: readonly PlatformInstalledResourceDescriptor[],
  connection: postgres.Sql | postgres.TransactionSql,
  transaction?: postgres.TransactionSql,
): Promise<readonly (CorporationResourceAuthorityVerdict | null)[]> => {
  const candidates = rows.map((row) => {
    const resource = resources.find(
      (candidate) => candidate.moduleId === row.moduleId && candidate.resourceId === row.resourceId,
    )
    return resource?.eligibility.kind === 'current-managed-corporation-source'
      ? createCorporationAuthorityCandidate(row, resource)
      : null
  })
  const matched = candidates.flatMap((candidate, index) =>
    candidate ? [{ candidate, index }] : [],
  )
  const verdicts = new Map<number, CorporationResourceAuthorityVerdict>()
  for (let offset = 0; offset < matched.length; offset += 64) {
    const batch = matched.slice(offset, offset + 64)
    const input = batch.map(({ candidate }) => candidate)
    const evaluation = transaction
      ? lockCorporationResourceAuthorityInTransaction(transaction, input)
      : evaluateCorporationResourceAuthority(connection, input)
    // oxlint-disable-next-line eslint/no-await-in-loop -- Sequential bounded batches avoid unbounded database concurrency and preserve lock ordering.
    const outcomes = await evaluation
    batch.forEach(({ index }, position) => {
      if (outcomes[position]) verdicts.set(index, outcomes[position])
    })
  }
  return rows.map((_, index) => verdicts.get(index) ?? null)
}

const applyCorporationRoleVerdict = (
  base: Extract<PlatformResourceEligibility, { status: 'eligible' }>,
  verdict: CorporationResourceAuthorityVerdict | null | undefined,
  resource: PlatformInstalledResourceDescriptor,
  row: ClassificationRow,
): PlatformResourceEligibility => {
  if (verdict?.outcome === 'satisfied' && verdict.sourceId && verdict.sourceBinding) {
    const requirements = getManagedCorporationResourceRequirements(resource)
    return {
      ...base,
      corporationAuthorityFence: {
        ...verdict.sourceBinding,
        sourceId: verdict.sourceId,
        corporationLifecycleId: row.subjectLifecycleId,
        requirementsFingerprint: requirements.fingerprint,
        roleRevision: verdict.roleRevision,
      },
    }
  }
  let authorizationReason:
    | 'scope-missing'
    | 'role-unsatisfied'
    | 'role-evidence-unavailable'
    | 'source-invalid' = 'source-invalid'
  if (verdict?.outcome === 'scope-missing') authorizationReason = 'scope-missing'
  if (verdict?.outcome === 'role-unsatisfied') authorizationReason = 'role-unsatisfied'
  if (verdict?.outcome === 'role-unavailable') authorizationReason = 'role-evidence-unavailable'
  const requirements = getManagedCorporationResourceRequirements(resource)
  return {
    authorizationReason,
    ...(requirements.rolePredicates.length > 0 && {
      requiredRolePredicates: requirements.rolePredicates,
    }),
    authorizationGeneration: base.authorizationGeneration,
    authorizationCharacterId: base.authorizationCharacterId,
    authorizationCharacterLifecycleId: base.authorizationCharacterLifecycleId,
    dueReason: null,
    lastFailureClass: base.lastFailureClass,
    managedAuthority: base.managedAuthority,
    nextEligibleAt: base.nextEligibleAt,
    requiredScope: verdict?.missingScope ?? requirements.scopes[0]!,
    schedulingKey: null,
    status: 'authorization-required',
    validatedAt: base.validatedAt,
  }
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
  if (!isPlatformResourceDueReason(row.dueReason)) {
    throw new Error(`Resource classifier returned invalid due reason ${String(row.dueReason)}`)
  }
  const schedulingKey = toDate(row.schedulingKey)
  if (!schedulingKey) {
    throw new Error('Resource classifier omitted the scheduling key')
  }
  return {
    due: row.dueReason !== 'future',
    dueReason: row.dueReason,
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
  if (!isPlatformCollectionFailureClass(value)) {
    throw new Error(`Resource classifier returned invalid failure class ${value}`)
  }
  return value
}
