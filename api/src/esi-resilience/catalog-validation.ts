import {
  platformContributionIdPattern,
  platformExportNamePattern,
} from '@eve-space/platform-module-contract'
import { z } from 'zod'

const scopePattern = /^esi-[a-z0-9_-]+\.[a-z0-9_]+\.v[1-9]\d*$/
const identityFieldPattern = /^[A-Za-z][A-Za-z0-9]*$/
const representationVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const rateWindowPattern = /^[1-9]\d*[smhd]$/
const maximumEsiRequestAttempts = 3

const positiveSafeIntegerSchema = z.int().positive()
const nonnegativeSafeIntegerSchema = z.int().nonnegative()
const isoCalendarDateSchema = z.iso.date()
const scopeSchema = z.string().regex(scopePattern)
const contributionIdSchema = z.string().regex(platformContributionIdPattern)

const freshnessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('relative'), seconds: positiveSafeIntegerSchema }),
  z.object({
    kind: z.literal('daily-utc'),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({ kind: z.literal('runtime-only') }),
  z.object({ kind: z.literal('none') }),
])

const rateGroupSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('legacy-only') }),
  z.object({
    kind: z.literal('declared'),
    group: contributionIdSchema,
    maximumTokens: positiveSafeIntegerSchema,
    window: z.string().regex(rateWindowPattern),
  }),
])

const esiOperationMetadataEntrySchema = z.strictObject({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  path: z.string().startsWith('/'),
  esiOperationId: z.string().regex(platformExportNamePattern),
  minimumCompatibilityDate: isoCalendarDateSchema,
  requiredScope: scopeSchema.nullable(),
  cache: freshnessSchema,
  supportsConditionalRequests: z.boolean(),
  rateLimit: rateGroupSchema,
  maximumBatchSize: positiveSafeIntegerSchema.optional(),
})

const esiOperationMetadataSchema = z.record(contributionIdSchema, esiOperationMetadataEntrySchema)

const esiMetadataReviewSchema = z.strictObject({
  explorerUrl: z.url(),
  reviewedAt: isoCalendarDateSchema,
  requestedCompatibilityDate: isoCalendarDateSchema,
  resolvedCompatibilityDate: isoCalendarDateSchema,
})

function identityFieldSchema(message: string) {
  return z.string().refine((value) => identityFieldPattern.test(value), { message })
}

const orderedIdentitySchema = z
  .object({
    kind: z.literal('ordered'),
    fields: z
      .array(identityFieldSchema('has invalid or duplicate ordered identity fields'))
      .readonly(),
  })
  .superRefine((value, context) => {
    if (new Set(value.fields).size !== value.fields.length)
      context.addIssue({
        code: 'custom',
        message: 'has invalid or duplicate ordered identity fields',
      })
  })

const setIdentitySchema = z.object({
  kind: z.literal('set'),
  field: identityFieldSchema('has an invalid set identity field'),
  maximumItems: positiveSafeIntegerSchema,
})

const mixedIdentityFieldSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('scalar'),
    field: identityFieldSchema('has an invalid mixed identity field'),
    nullable: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('set'),
    field: identityFieldSchema('has an invalid mixed identity field'),
    maximumItems: positiveSafeIntegerSchema,
    nullable: z.boolean().optional(),
  }),
])

const mixedIdentitySchema = z
  .object({
    kind: z.literal('mixed'),
    fields: z.array(mixedIdentityFieldSchema).min(1).readonly(),
  })
  .superRefine((value, context) => {
    const names = value.fields.map((field) => field.field)
    if (new Set(names).size !== names.length)
      context.addIssue({ code: 'custom', message: 'has duplicate mixed identity fields' })
  })

const identitySchema = z.discriminatedUnion('kind', [
  orderedIdentitySchema,
  setIdentitySchema,
  mixedIdentitySchema,
])

const authorizationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('public') }),
  z.object({ kind: z.literal('character'), scope: scopeSchema }),
])

const staleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bounded'), milliseconds: positiveSafeIntegerSchema }),
  z.object({ kind: z.literal('outage'), milliseconds: positiveSafeIntegerSchema }),
  z.object({ kind: z.literal('none') }),
])

const cacheSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('shared'),
      collapse: z.boolean(),
      revalidate: z.boolean(),
      stale: staleSchema,
      retentionMilliseconds: nonnegativeSafeIntegerSchema,
    })
    .superRefine((value, context) => {
      if (value.stale.kind !== 'none' && value.stale.milliseconds > value.retentionMilliseconds)
        context.addIssue({ code: 'custom', message: 'stale duration exceeds cache retention' })
    }),
  z.object({ kind: z.literal('none') }),
])

const retrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z
    .object({
      kind: z.literal('idempotent'),
      attempts: positiveSafeIntegerSchema.max(maximumEsiRequestAttempts),
      initialDelayMilliseconds: nonnegativeSafeIntegerSchema,
      maximumDelayMilliseconds: nonnegativeSafeIntegerSchema,
    })
    .superRefine((value, context) => {
      if (value.maximumDelayMilliseconds < value.initialDelayMilliseconds)
        context.addIssue({ code: 'custom', message: 'has invalid idempotent retry metadata' })
    }),
])

const responseValidationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('enabled') }),
  z.object({ kind: z.literal('disabled'), reason: z.string().trim().min(1) }),
])

const esiOperationContractSchema = z.object({
  audit: z.object({
    esiOperationId: z.string().regex(platformExportNamePattern),
    reviewedDate: isoCalendarDateSchema,
  }),
  representationVersion: z.string().regex(representationVersionPattern),
  authorization: authorizationSchema,
  identity: identitySchema,
  resourceRevision: z
    .object({ kind: z.literal('character'), namespace: contributionIdSchema })
    .optional(),
  mutation: z.object({ kind: z.literal('character'), appliedOnMissing: z.boolean() }).optional(),
  freshness: freshnessSchema,
  cache: cacheSchema,
  rateGroup: rateGroupSchema,
  retry: retrySchema,
  compatibility: z.object({ minimumDate: isoCalendarDateSchema }),
  responseValidation: responseValidationSchema,
})

type ValidatedEsiOperationContract = z.infer<typeof esiOperationContractSchema>

interface RateGroupDefinition {
  operation: string
  scope: 'public' | 'character'
  maximumTokens: number
  window: string
}

interface EsiOperationContractValidationState {
  readonly issues: string[]
  readonly rateGroups: Map<string, RateGroupDefinition>
  readonly sdkOperationOwners: Map<string, string>
  readonly expectedSdkOperationIds: Readonly<Record<string, string>>
}

export function defineMetadataReview<const Review extends z.input<typeof esiMetadataReviewSchema>>(
  review: Review,
) {
  esiMetadataReviewSchema.parse(review)
  return review
}

export function defineOperationMetadata<
  const Metadata extends z.input<typeof esiOperationMetadataSchema>,
>(metadata: Metadata) {
  esiOperationMetadataSchema.parse(metadata)
  return metadata
}

export function assertEsiOperationContracts(
  catalog: Readonly<Record<string, unknown>>,
  expectedSdkOperationIds: Readonly<Record<string, string>> = {},
): asserts catalog is Readonly<Record<string, ValidatedEsiOperationContract>> {
  const state: EsiOperationContractValidationState = {
    issues: [],
    rateGroups: new Map(),
    sdkOperationOwners: new Map(),
    expectedSdkOperationIds,
  }

  for (const [operation, value] of Object.entries(catalog))
    validateEsiOperationContract(operation, value, state)

  if (state.issues.length > 0)
    throw new Error(
      `Invalid ESI operation catalog:\n${state.issues
        .toSorted((left, right) => left.localeCompare(right))
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    )
}

function validateEsiOperationContract(
  operation: string,
  value: unknown,
  state: EsiOperationContractValidationState,
) {
  if (!platformContributionIdPattern.test(operation))
    state.issues.push(`operation ${operation} must use a lowercase kebab-case identity`)

  const result = esiOperationContractSchema.safeParse(value)
  if (!result.success) {
    for (const issue of result.error.issues)
      state.issues.push(`operation ${operation} ${formatContractIssue(issue)}`)
    return
  }

  validateContractInvariants(operation, result.data, state)
}

function validateContractInvariants(
  operation: string,
  contract: ValidatedEsiOperationContract,
  state: EsiOperationContractValidationState,
) {
  const { issues, expectedSdkOperationIds, rateGroups, sdkOperationOwners } = state
  const expectedSdkOperationId = expectedSdkOperationIds[operation]
  if (expectedSdkOperationId && contract.audit.esiOperationId !== expectedSdkOperationId)
    issues.push(
      `operation ${operation} contract declares ${contract.audit.esiOperationId} instead of manifest SDK operation ${expectedSdkOperationId}`,
    )

  const owner = sdkOperationOwners.get(contract.audit.esiOperationId)
  if (owner)
    issues.push(
      `operation ${operation} duplicates ESI SDK operation ${contract.audit.esiOperationId} from operation ${owner}`,
    )
  else sdkOperationOwners.set(contract.audit.esiOperationId, operation)

  if (
    contract.mutation &&
    (contract.authorization.kind !== 'character' || contract.cache.kind !== 'none')
  )
    issues.push(
      `operation ${operation} declares a mutation without character authorization and an uncached contract`,
    )

  if (contract.compatibility.minimumDate > contract.audit.reviewedDate)
    issues.push(`operation ${operation} minimum compatibility date exceeds its review date`)

  if (contract.rateGroup.kind === 'declared')
    validateRateGroupConsistency(operation, contract, rateGroups, issues)
}

function validateRateGroupConsistency(
  operation: string,
  contract: ValidatedEsiOperationContract,
  groups: Map<string, RateGroupDefinition>,
  issues: string[],
) {
  if (contract.rateGroup.kind !== 'declared') return
  const definition = {
    operation,
    scope: contract.authorization.kind,
    maximumTokens: contract.rateGroup.maximumTokens,
    window: contract.rateGroup.window,
  }
  const current = groups.get(contract.rateGroup.group)
  if (
    current &&
    (current.scope !== definition.scope ||
      current.maximumTokens !== definition.maximumTokens ||
      current.window !== definition.window)
  )
    issues.push(
      `operation ${operation} rate group ${contract.rateGroup.group} conflicts with operation ${current.operation}`,
    )
  else groups.set(contract.rateGroup.group, definition)
}

function formatContractIssue(issue: z.core.$ZodIssue) {
  if (issue.code === 'custom') return issue.message
  const [field, nestedField] = issue.path

  switch (field) {
    case 'audit':
      return formatAuditIssue(nestedField)
    case 'compatibility':
      return formatCompatibilityIssue(nestedField)
    case 'authorization':
      return formatAuthorizationIssue(nestedField)
    case 'representationVersion':
      return 'has an invalid representation version'
    case 'identity':
      return formatIdentityIssue(issue.path)
    case 'resourceRevision':
      return 'has invalid resource-revision metadata'
    case 'freshness':
      return formatFreshnessIssue(issue.path)
    case 'cache':
      return formatCacheIssue(issue.path)
    case 'rateGroup':
      return 'has invalid declared rate-group metadata'
    case 'retry':
      return 'has invalid idempotent retry metadata'
    case 'responseValidation':
      return 'has an invalid response-validation exception'
    default:
      return 'must export a contract object'
  }
}

function formatAuditIssue(field: PropertyKey | undefined) {
  if (field === 'esiOperationId') return 'has an invalid ESI SDK operation identity'
  if (field === 'reviewedDate') return 'has an invalid review date'
  return 'has invalid audit metadata'
}

function formatCompatibilityIssue(field: PropertyKey | undefined) {
  if (field === 'minimumDate') return 'has an invalid minimum compatibility date'
  return 'has invalid compatibility metadata'
}

function formatAuthorizationIssue(field: PropertyKey | undefined) {
  if (field === 'scope') return 'has an invalid character scope'
  return 'uses an unsupported authorization strategy'
}

function formatIdentityIssue(path: PropertyKey[]) {
  if (path[1] === 'maximumItems') return 'set identity maximum must be a positive safe integer'
  if (path[1] === 'field') return 'has an invalid set identity field'
  if (path[1] === 'fields' && typeof path[2] === 'number')
    return path[3] === 'maximumItems'
      ? 'has an invalid mixed set identity field'
      : 'has an invalid mixed identity field'
  if (path[1] === 'fields') return 'has invalid mixed identity fields'
  return 'uses an unsupported identity strategy'
}

function formatFreshnessIssue(path: PropertyKey[]) {
  if (path[1] === 'seconds') return 'relative freshness must use positive whole seconds'
  if (path[1] === 'hour' || path[1] === 'minute')
    return 'has an invalid daily UTC freshness boundary'
  return 'uses an unsupported freshness strategy'
}

function formatCacheIssue(path: PropertyKey[]) {
  if (path[1] === 'retentionMilliseconds')
    return 'cache retention must be a non-negative whole duration'
  if (path[1] === 'stale') return 'has an invalid bounded stale duration'
  if (path[1] === 'collapse' || path[1] === 'revalidate')
    return 'shared cache flags must be boolean'
  return 'uses an unsupported cache strategy'
}

export function isIsoCalendarDate(value: string) {
  return isoCalendarDateSchema.safeParse(value).success
}
