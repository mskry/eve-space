import {
  isPlatformContributionId,
  isPlatformExportName,
} from '@eve-space/platform-module-contract/identifiers'
import type { PlatformEsiOperationContract } from '@eve-space/platform-module-contract/esi'
import type { StableOperationId } from '@evespace/esi-client/operations'
import { z } from 'zod'

const scopePattern = /^esi-[a-z0-9_-]+\.[a-z0-9_]+\.v[1-9]\d*$/
const identityFieldPattern = /^[A-Za-z][A-Za-z0-9]*$/
const representationVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const maximumEsiRequestAttempts = 3

const positiveSafeIntegerSchema = z.int().positive()
const nonnegativeSafeIntegerSchema = z.int().nonnegative()
const isoCalendarDateSchema = z.iso.date()
const scopeSchema = z.union([z.string().regex(scopePattern), z.literal('esi.activity.char:read')])
const contributionIdSchema = z.string().refine(isPlatformContributionId)

const freshnessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('relative'), seconds: positiveSafeIntegerSchema }),
  z.object({
    hour: z.number().int().min(0).max(23),
    kind: z.literal('daily-utc'),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({ kind: z.literal('runtime-only') }),
  z.object({ kind: z.literal('none') }),
])

const rateWindowPattern = /^[1-9]\d*[smhd]$/
const rateGroupSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('legacy-only') }),
  z.object({
    group: z.string().refine(isPlatformContributionId, {
      message: 'has invalid declared rate-group metadata',
    }),
    kind: z.literal('declared'),
    maximumTokens: positiveSafeIntegerSchema,
    window: z.string().regex(rateWindowPattern),
  }),
])

const esiOperationMetadataEntrySchema = z.strictObject({
  cache: freshnessSchema,
  esiOperationId: z.string().refine(isPlatformExportName),
  minimumCompatibilityDate: isoCalendarDateSchema,
})

const esiOperationMetadataSchema = z.record(contributionIdSchema, esiOperationMetadataEntrySchema)

const esiMetadataReviewSchema = z.strictObject({
  explorerUrl: z.url(),
  requestedCompatibilityDate: isoCalendarDateSchema,
  resolvedCompatibilityDate: isoCalendarDateSchema,
  reviewedAt: isoCalendarDateSchema,
})

function identityFieldSchema(message: string) {
  return z.string().refine((value) => identityFieldPattern.test(value), { message })
}

const orderedIdentitySchema = z
  .object({
    fields: z
      .array(identityFieldSchema('has invalid or duplicate ordered identity fields'))
      .readonly(),
    kind: z.literal('ordered'),
  })
  .superRefine((value, context) => {
    if (new Set(value.fields).size !== value.fields.length) {
      context.addIssue({
        code: 'custom',
        message: 'has invalid or duplicate ordered identity fields',
      })
    }
  })

const setIdentitySchema = z.object({
  field: identityFieldSchema('has an invalid set identity field'),
  kind: z.literal('set'),
  maximumItems: positiveSafeIntegerSchema,
})

const mixedIdentityFieldSchema = z.discriminatedUnion('kind', [
  z.object({
    field: identityFieldSchema('has an invalid mixed identity field'),
    kind: z.literal('scalar'),
    nullable: z.boolean().optional(),
  }),
  z.object({
    field: identityFieldSchema('has an invalid mixed identity field'),
    kind: z.literal('set'),
    maximumItems: positiveSafeIntegerSchema,
    nullable: z.boolean().optional(),
  }),
])

const mixedIdentitySchema = z
  .object({
    fields: z.array(mixedIdentityFieldSchema).min(1).readonly(),
    kind: z.literal('mixed'),
  })
  .superRefine((value, context) => {
    const names = value.fields.map((field) => field.field)
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: 'custom', message: 'has duplicate mixed identity fields' })
    }
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
      collapse: z.boolean(),
      kind: z.literal('shared'),
      retentionMilliseconds: nonnegativeSafeIntegerSchema,
      revalidate: z.boolean(),
      stale: staleSchema,
    })
    .superRefine((value, context) => {
      if (value.stale.kind !== 'none' && value.stale.milliseconds > value.retentionMilliseconds) {
        context.addIssue({ code: 'custom', message: 'stale duration exceeds cache retention' })
      }
    }),
  z.object({ kind: z.literal('none') }),
])

const retrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z
    .object({
      attempts: positiveSafeIntegerSchema.max(maximumEsiRequestAttempts),
      initialDelayMilliseconds: nonnegativeSafeIntegerSchema,
      kind: z.literal('idempotent'),
      maximumDelayMilliseconds: nonnegativeSafeIntegerSchema,
    })
    .superRefine((value, context) => {
      if (value.maximumDelayMilliseconds < value.initialDelayMilliseconds) {
        context.addIssue({ code: 'custom', message: 'has invalid idempotent retry metadata' })
      }
    }),
])

const responseValidationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('enabled') }),
  z.object({ kind: z.literal('disabled'), reason: z.string().trim().min(1) }),
])

const esiOperationContractSchema = z.object({
  audit: z.object({
    esiOperationId: z.string().refine(isPlatformExportName),
    reviewedDate: isoCalendarDateSchema,
  }),
  authorization: authorizationSchema,
  cache: cacheSchema,
  compatibility: z.object({ minimumDate: isoCalendarDateSchema }),
  freshness: freshnessSchema,
  identity: identitySchema,
  mutation: z.object({ kind: z.literal('character'), appliedOnMissing: z.boolean() }).optional(),
  rateGroup: rateGroupSchema,
  representationVersion: z.string().regex(representationVersionPattern),
  resourceRevision: z
    .object({ kind: z.literal('character'), namespace: contributionIdSchema })
    .optional(),
  responseValidation: responseValidationSchema,
  retry: retrySchema,
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
  const Metadata extends z.input<typeof esiOperationMetadataSchema> &
    Readonly<Record<string, { readonly esiOperationId: StableOperationId }>>,
>(metadata: Metadata) {
  esiOperationMetadataSchema.parse(metadata)
  return metadata
}

export function assertEsiOperationContracts(
  catalog: Readonly<Record<string, unknown>>,
  expectedSdkOperationIds: Readonly<Record<string, string>> = {},
): asserts catalog is Readonly<Record<string, ValidatedEsiOperationContract>> {
  const state: EsiOperationContractValidationState = {
    expectedSdkOperationIds,
    issues: [],
    rateGroups: new Map(),
    sdkOperationOwners: new Map(),
  }

  for (const [operation, value] of Object.entries(catalog)) {
    validateEsiOperationContract(operation, value, state)
  }

  if (state.issues.length > 0) {
    throw new Error(
      formatValidationIssues(
        'Invalid ESI operation catalog',
        state.issues.toSorted((left, right) => left.localeCompare(right)),
      ),
    )
  }
}

function validateEsiOperationContract(
  operation: string,
  value: unknown,
  state: EsiOperationContractValidationState,
) {
  if (!isPlatformContributionId(operation)) {
    state.issues.push(`operation ${operation} must use a lowercase kebab-case identity`)
  }

  const result = esiOperationContractSchema.safeParse(value)
  if (!result.success) {
    for (const issue of result.error.issues) {
      state.issues.push(`operation ${operation} ${formatContractIssue(issue)}`)
    }
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
  if (expectedSdkOperationId && contract.audit.esiOperationId !== expectedSdkOperationId) {
    issues.push(
      `operation ${operation} contract declares ${contract.audit.esiOperationId} instead of manifest SDK operation ${expectedSdkOperationId}`,
    )
  }

  const owner = sdkOperationOwners.get(contract.audit.esiOperationId)
  if (owner) {
    issues.push(
      `operation ${operation} duplicates ESI SDK operation ${contract.audit.esiOperationId} from operation ${owner}`,
    )
  } else {
    sdkOperationOwners.set(contract.audit.esiOperationId, operation)
  }

  if (
    contract.mutation &&
    (contract.authorization.kind !== 'character' || contract.cache.kind !== 'none')
  ) {
    issues.push(
      `operation ${operation} declares a mutation without character authorization and an uncached contract`,
    )
  }

  if (contract.compatibility.minimumDate > contract.audit.reviewedDate) {
    issues.push(`operation ${operation} minimum compatibility date exceeds its review date`)
  }

  if (contract.rateGroup.kind === 'declared') {
    validateRateGroupConsistency(operation, contract, rateGroups, issues)
  }
}

function validateRateGroupConsistency(
  operation: string,
  contract: ValidatedEsiOperationContract,
  groups: Map<string, RateGroupDefinition>,
  issues: string[],
) {
  if (contract.rateGroup.kind !== 'declared') {
    return
  }
  const definition = {
    maximumTokens: contract.rateGroup.maximumTokens,
    operation,
    scope: contract.authorization.kind,
    window: contract.rateGroup.window,
  }
  const current = groups.get(contract.rateGroup.group)
  if (
    current &&
    (current.scope !== definition.scope ||
      current.maximumTokens !== definition.maximumTokens ||
      current.window !== definition.window)
  ) {
    issues.push(
      `operation ${operation} rate group ${contract.rateGroup.group} conflicts with operation ${current.operation}`,
    )
  } else {
    groups.set(contract.rateGroup.group, definition)
  }
}

function formatContractIssue(issue: z.core.$ZodIssue) {
  if (issue.code === 'custom') {
    return issue.message
  }
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
    case 'mutation':
      return 'has invalid mutation metadata'
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
  if (field === 'esiOperationId') {
    return 'has an invalid ESI SDK operation identity'
  }
  if (field === 'reviewedDate') {
    return 'has an invalid review date'
  }
  return 'has invalid audit metadata'
}

function formatCompatibilityIssue(field: PropertyKey | undefined) {
  if (field === 'minimumDate') {
    return 'has an invalid minimum compatibility date'
  }
  return 'has invalid compatibility metadata'
}

function formatAuthorizationIssue(field: PropertyKey | undefined) {
  if (field === 'scope') {
    return 'has an invalid character scope'
  }
  return 'uses an unsupported authorization strategy'
}

function formatIdentityIssue(path: PropertyKey[]) {
  if (path[1] === 'maximumItems') {
    return 'set identity maximum must be a positive safe integer'
  }
  if (path[1] === 'field') {
    return 'has an invalid set identity field'
  }
  if (path[1] === 'fields' && typeof path[2] === 'number') {
    return path[3] === 'maximumItems'
      ? 'has an invalid mixed set identity field'
      : 'has an invalid mixed identity field'
  }
  if (path[1] === 'fields') {
    return 'has invalid mixed identity fields'
  }
  return 'uses an unsupported identity strategy'
}

function formatFreshnessIssue(path: PropertyKey[]) {
  if (path[1] === 'seconds') {
    return 'relative freshness must use positive whole seconds'
  }
  if (path[1] === 'hour' || path[1] === 'minute') {
    return 'has an invalid daily UTC freshness boundary'
  }
  return 'uses an unsupported freshness strategy'
}

function formatCacheIssue(path: PropertyKey[]) {
  if (path[1] === 'retentionMilliseconds') {
    return 'cache retention must be a non-negative whole duration'
  }
  if (path[1] === 'stale') {
    return 'has an invalid bounded stale duration'
  }
  if (path[1] === 'collapse' || path[1] === 'revalidate') {
    return 'shared cache flags must be boolean'
  }
  return 'uses an unsupported cache strategy'
}

export function isIsoCalendarDate(value: string) {
  return isoCalendarDateSchema.safeParse(value).success
}

export interface EsiRepresentationRegistrationDescriptor {
  readonly name: string
  readonly operation: string
  readonly authorization: 'public' | 'character'
  readonly execution: 'read' | 'mutation'
  readonly descriptorOperationId: string
}

export function assertConsistentEsiRepresentationRegistration(
  registration: EsiRepresentationRegistrationDescriptor,
  state: {
    duplicateName: boolean
    descriptorRegistered: boolean
    descriptorClassification?: 'read' | 'mutation'
    contract: PlatformEsiOperationContract | undefined
  },
) {
  const issues: string[] = []
  if (state.duplicateName) {
    issues.push(`representation ${registration.name} is already registered`)
  }
  if (!state.descriptorRegistered) {
    issues.push(`representation ${registration.name} does not bind the registered SDK descriptor`)
  }
  if (state.descriptorClassification && state.descriptorClassification !== registration.execution) {
    issues.push(
      `representation ${registration.name} declares ${registration.execution} execution but SDK operation ${registration.descriptorOperationId} is ${state.descriptorClassification}`,
    )
  }
  if (!state.contract) {
    issues.push(
      `representation ${registration.name} references unregistered ESI operation ${registration.operation}`,
    )
  } else {
    validateRegistrationContract(registration, state.contract, issues)
  }
  if (issues.length > 0) {
    throw new Error(formatValidationIssues('Invalid ESI representation registration', issues))
  }
}

function validateRegistrationContract(
  registration: EsiRepresentationRegistrationDescriptor,
  contract: PlatformEsiOperationContract,
  issues: string[],
) {
  if (contract.authorization.kind !== registration.authorization) {
    issues.push(
      `representation ${registration.name} declares ${registration.authorization} authorization but operation ${registration.operation} requires ${contract.authorization.kind}`,
    )
  }
  if (contract.audit.esiOperationId !== registration.descriptorOperationId) {
    issues.push(
      `representation ${registration.name} binds SDK operation ${registration.descriptorOperationId} instead of ${contract.audit.esiOperationId}`,
    )
  }
  const mutation =
    'mutation' in contract && contract.mutation !== undefined ? contract.mutation : undefined
  if (mutation && registration.execution !== 'mutation') {
    issues.push(
      `representation ${registration.name} cannot read mutation operation ${registration.operation}`,
    )
  }
  if (!mutation && registration.execution === 'mutation') {
    issues.push(
      `representation ${registration.name} cannot mutate undeclared operation ${registration.operation}`,
    )
  }
}

function formatValidationIssues(heading: string, issues: readonly string[]) {
  return [heading, ...issues.map((issue) => `- ${issue}`)].join('\n')
}
