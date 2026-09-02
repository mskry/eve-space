import {
  platformActivityFreshnessStates,
  platformActivityParticipationStates,
  platformActivityProviderMaximumActivities,
  platformActivityProviderTimeoutMilliseconds,
  platformActivityRequiredActionKinds,
  platformContributionIdPattern,
  type PlatformActivity,
  type PlatformActivityFreshness,
  type PlatformActivityProviderCharacter,
  type PlatformInstalledActivityProviderDescriptor,
} from '@eve-space/platform-module-contract'
import { z } from 'zod'
import { installedModuleActivityProviders } from '../generated/platform/installed-module-activity-providers.js'
import type { OrganizationSessionContext } from '../middleware/organization-session.js'
import { loadModuleRuntimeState } from '../platform/module-settings.js'
import { loadOrganizationActivityCharacters } from './activity-context.js'
import { authorizeOrganizationContribution } from './module-authorization.js'

const positiveCharacterIdSchema = z.number().int().positive()
const freshnessSchema = z
  .object({
    state: z.enum(platformActivityFreshnessStates),
    collectedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((freshness, context) => {
    if (
      (freshness.state === 'current' || freshness.state === 'stale') &&
      freshness.collectedAt === null
    )
      context.addIssue({ code: 'custom', message: 'Collected activity requires a timestamp.' })
  })
const providerActivitySchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    kind: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(2_000).nullable(),
    requiredAction: z
      .object({
        kind: z.enum(platformActivityRequiredActionKinds),
        label: z.string().trim().min(1).max(200),
        characterId: positiveCharacterIdSchema.nullable(),
      })
      .strict()
      .nullable(),
    organizationPriority: z.number().int().min(0).max(1_000),
    deadline: z.iso.datetime({ offset: true }).nullable(),
    eligibleCharacterIds: z.array(positiveCharacterIdSchema).max(100),
    participation: z
      .array(
        z
          .object({
            characterId: positiveCharacterIdSchema,
            state: z.enum(platformActivityParticipationStates),
          })
          .strict(),
      )
      .max(100),
    linkTarget: z
      .object({
        pageId: z.string().regex(platformContributionIdPattern),
        characterId: positiveCharacterIdSchema.nullable(),
      })
      .strict()
      .nullable(),
    freshness: freshnessSchema,
  })
  .strict()
const providerResultSchema = z
  .object({
    activities: z.array(providerActivitySchema).max(platformActivityProviderMaximumActivities),
    freshness: freshnessSchema,
  })
  .strict()

export interface OrganizationActivity extends Omit<PlatformActivity, 'id' | 'linkTarget'> {
  readonly id: string
  readonly sourceId: string
  readonly linkTarget: {
    readonly moduleId: string
    readonly pageId: string
    readonly characterId: number | null
  } | null
}

export interface OrganizationActivitySource {
  readonly sourceId: string
  readonly moduleId: string
  readonly providerId: string
  readonly freshness: PlatformActivityFreshness
}

export interface AggregateOrganizationActivitiesOptions {
  readonly providers?: readonly PlatformInstalledActivityProviderDescriptor[]
  readonly timeoutMilliseconds?: number
  readonly now?: Date
  readonly loadEnabledModuleIds?: () => Promise<readonly string[]>
  readonly authorize?: typeof authorizeOrganizationContribution
  readonly loadCharacters?: typeof loadOrganizationActivityCharacters
}

export async function aggregateOrganizationActivities(
  userId: string,
  organization: OrganizationSessionContext,
  options: AggregateOrganizationActivitiesOptions = {},
) {
  const now = options.now ?? new Date()
  const providers = options.providers ?? installedModuleActivityProviders
  const enabledModuleIds = new Set(
    await (options.loadEnabledModuleIds ?? defaultLoadEnabledModuleIds)(),
  )
  const enabledProviders = providers.filter(({ moduleId }) => enabledModuleIds.has(moduleId))
  const authorize = options.authorize ?? authorizeOrganizationContribution
  const authorizationResults = await Promise.all(
    enabledProviders.map(async (provider) => ({
      provider,
      authorization: await authorize(userId, organization, provider, now),
    })),
  )
  const authorizedProviders = authorizationResults
    .filter(({ authorization }) => authorization.authorized)
    .map(({ provider }) => provider)
  if (authorizedProviders.length === 0)
    return {
      organizationVersion: organization.organizationVersion,
      generatedAt: now.toISOString(),
      activities: [] as OrganizationActivity[],
      sources: [] as OrganizationActivitySource[],
    }

  let characters: readonly PlatformActivityProviderCharacter[]
  try {
    characters = await (options.loadCharacters ?? loadOrganizationActivityCharacters)(
      userId,
      organization.organizationVersion,
      now,
    )
  } catch {
    return {
      organizationVersion: organization.organizationVersion,
      generatedAt: now.toISOString(),
      activities: [] as OrganizationActivity[],
      sources: authorizedProviders.map(unavailableSource),
    }
  }
  const timeoutMilliseconds =
    options.timeoutMilliseconds ?? platformActivityProviderTimeoutMilliseconds
  const results = await Promise.all(
    authorizedProviders.map((provider) =>
      collectProviderActivities(provider, {
        userId,
        organizationVersion: organization.organizationVersion,
        requestedAt: now.toISOString(),
        characters,
        timeoutMilliseconds,
        now,
      }),
    ),
  )
  return {
    organizationVersion: organization.organizationVersion,
    generatedAt: now.toISOString(),
    activities: results.flatMap(({ activities }) => activities).toSorted(compareActivities),
    sources: results.map(({ source }) => source),
  }
}

function unavailableSource(
  provider: PlatformInstalledActivityProviderDescriptor,
): OrganizationActivitySource {
  return {
    sourceId: `${provider.moduleId}:${provider.providerId}`,
    moduleId: provider.moduleId,
    providerId: provider.providerId,
    freshness: { state: 'unavailable', collectedAt: null },
  }
}

async function defaultLoadEnabledModuleIds() {
  return (await loadModuleRuntimeState()).enabledModuleIds
}

async function collectProviderActivities(
  provider: PlatformInstalledActivityProviderDescriptor,
  input: {
    readonly userId: string
    readonly organizationVersion: number
    readonly requestedAt: string
    readonly characters: readonly PlatformActivityProviderCharacter[]
    readonly timeoutMilliseconds: number
    readonly now: Date
  },
): Promise<{ activities: OrganizationActivity[]; source: OrganizationActivitySource }> {
  const sourceId = `${provider.moduleId}:${provider.providerId}`
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      provider.invoke({
        userId: input.userId,
        organizationVersion: input.organizationVersion,
        requestedAt: input.requestedAt,
        signal: controller.signal,
        characters: input.characters,
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('Activity provider timed out'))
        }, input.timeoutMilliseconds)
      }),
    ])
    const parsed = providerResultSchema.parse(result)
    const freshness = normalizeFreshness(parsed.freshness, provider, input.now)
    return {
      activities: mergeProviderActivities(provider, sourceId, parsed.activities, input),
      source: {
        sourceId,
        moduleId: provider.moduleId,
        providerId: provider.providerId,
        freshness,
      },
    }
  } catch {
    controller.abort()
    return {
      activities: [],
      source: {
        sourceId,
        moduleId: provider.moduleId,
        providerId: provider.providerId,
        freshness: { state: 'unavailable', collectedAt: null },
      },
    }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function mergeProviderActivities(
  provider: PlatformInstalledActivityProviderDescriptor,
  sourceId: string,
  activities: readonly z.infer<typeof providerActivitySchema>[],
  input: {
    readonly characters: readonly PlatformActivityProviderCharacter[]
    readonly now: Date
  },
) {
  const characterIds = new Set(input.characters.map(({ characterId }) => characterId))
  const merged = new Map<string, OrganizationActivity>()
  for (const activity of activities) {
    validateActivityReferences(provider, activity, characterIds)
    const projected = projectActivity(provider, sourceId, activity, input.now)
    const existing = merged.get(activity.id)
    if (!existing) {
      merged.set(activity.id, projected)
      continue
    }
    if (!sameActivityScalars(existing, projected)) throw new Error('Conflicting duplicate activity')
    const participation = new Map(existing.participation.map((entry) => [entry.characterId, entry]))
    for (const entry of projected.participation) {
      const previous = participation.get(entry.characterId)
      if (previous && previous.state !== entry.state)
        throw new Error('Conflicting duplicate activity participation')
      participation.set(entry.characterId, entry)
    }
    merged.set(activity.id, {
      ...existing,
      eligibleCharacterIds: [
        ...new Set([...existing.eligibleCharacterIds, ...projected.eligibleCharacterIds]),
      ].toSorted((left, right) => left - right),
      participation: [...participation.values()].toSorted(
        (left, right) => left.characterId - right.characterId,
      ),
    })
  }
  return [...merged.values()]
}

function validateActivityReferences(
  provider: PlatformInstalledActivityProviderDescriptor,
  activity: z.infer<typeof providerActivitySchema>,
  characterIds: ReadonlySet<number>,
) {
  const referencedCharacterIds = [
    ...activity.eligibleCharacterIds,
    ...activity.participation.map(({ characterId }) => characterId),
    activity.requiredAction?.characterId,
    activity.linkTarget?.characterId,
  ].filter(
    (characterId): characterId is number => characterId !== null && characterId !== undefined,
  )
  if (referencedCharacterIds.some((characterId) => !characterIds.has(characterId)))
    throw new Error('Activity references a character outside the authorized account')
  if (activity.linkTarget && !provider.pageIds.includes(activity.linkTarget.pageId))
    throw new Error('Activity references an undeclared module page')
}

function projectActivity(
  provider: PlatformInstalledActivityProviderDescriptor,
  sourceId: string,
  activity: z.infer<typeof providerActivitySchema>,
  now: Date,
): OrganizationActivity {
  return {
    id: `${sourceId}:${activity.id}`,
    sourceId,
    kind: activity.kind,
    title: activity.title,
    summary: activity.summary,
    requiredAction: activity.requiredAction,
    organizationPriority: activity.organizationPriority,
    deadline: activity.deadline,
    eligibleCharacterIds: [...new Set(activity.eligibleCharacterIds)].toSorted(
      (left, right) => left - right,
    ),
    participation: normalizeParticipation(activity.participation),
    linkTarget: activity.linkTarget
      ? { moduleId: provider.moduleId, ...activity.linkTarget }
      : null,
    freshness: normalizeFreshness(activity.freshness, provider, now),
  }
}

function normalizeParticipation(
  participation: readonly z.infer<typeof providerActivitySchema>['participation'][number][],
) {
  const byCharacter = new Map<number, (typeof participation)[number]>()
  for (const entry of participation) {
    const existing = byCharacter.get(entry.characterId)
    if (existing && existing.state !== entry.state)
      throw new Error('Conflicting activity participation')
    byCharacter.set(entry.characterId, entry)
  }
  return [...byCharacter.values()].toSorted((left, right) => left.characterId - right.characterId)
}

function normalizeFreshness(
  freshness: PlatformActivityFreshness,
  provider: PlatformInstalledActivityProviderDescriptor,
  now: Date,
): PlatformActivityFreshness {
  if (
    freshness.state === 'current' &&
    freshness.collectedAt &&
    new Date(freshness.collectedAt).getTime() <
      now.getTime() - provider.freshness.staleAfterSeconds * 1_000
  )
    return { ...freshness, state: 'stale' }
  return freshness
}

function sameActivityScalars(left: OrganizationActivity, right: OrganizationActivity) {
  return (
    left.kind === right.kind &&
    left.title === right.title &&
    left.summary === right.summary &&
    JSON.stringify(left.requiredAction) === JSON.stringify(right.requiredAction) &&
    left.organizationPriority === right.organizationPriority &&
    left.deadline === right.deadline &&
    JSON.stringify(left.linkTarget) === JSON.stringify(right.linkTarget) &&
    JSON.stringify(left.freshness) === JSON.stringify(right.freshness)
  )
}

function compareActivities(left: OrganizationActivity, right: OrganizationActivity) {
  const actionOrder = Number(right.requiredAction !== null) - Number(left.requiredAction !== null)
  if (actionOrder !== 0) return actionOrder
  const priorityOrder = right.organizationPriority - left.organizationPriority
  if (priorityOrder !== 0) return priorityOrder
  if (left.deadline !== right.deadline) {
    if (left.deadline === null) return 1
    if (right.deadline === null) return -1
    const deadlineOrder = new Date(left.deadline).getTime() - new Date(right.deadline).getTime()
    if (deadlineOrder !== 0) return deadlineOrder
  }
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}
