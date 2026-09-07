import type {
  PlatformActivityProviderFactory,
  PlatformCollectionStatusSubject,
} from '@eve-space/platform-module-contract'
import { readActivitySnapshots } from './snapshot-reads.js'
import type { ActivitySourceRead } from './activity-source.js'
import { combineActivitySources } from './provider-activities.js'
import { mapWithConcurrency } from './bounded-map.js'

const maximumConcurrentReads = 4

type SourceRequest = {
  resourceId: string
  subject: PlatformCollectionStatusSubject
  characterId?: number
}

export const organizationActivityProvider: PlatformActivityProviderFactory =
  (capabilities) => async (context) => {
    const characters = context.characters.filter((character) => character.membership === 'managed')
    const corporationIds = [...new Set(characters.map((character) => character.corporationId))]
    const requests: SourceRequest[] = ['campaigns', 'public-jobs'].map((resourceId) => ({
      resourceId,
      subject: { kind: 'deployment', deploymentId: 1 },
    }))
    for (const corporationId of corporationIds)
      for (const resourceId of ['corporation-projects', 'corporation-jobs'])
        requests.push({ resourceId, subject: { kind: 'corporation', corporationId } })
    for (const { characterId } of characters)
      for (const resourceId of ['character-projects', 'character-jobs', 'character-campaigns'])
        requests.push({ resourceId, characterId, subject: { kind: 'character', characterId } })
    const reads = await mapWithConcurrency(
      requests,
      maximumConcurrentReads,
      async (request) => ({
        characterId: request.characterId,
        source: await readActivitySnapshots(
          capabilities,
          context.organizationVersion,
          request.resourceId,
          request.subject,
        ),
      }),
      context.signal,
    )
    const sources = reads
      .filter((read) => read.characterId === undefined)
      .map((read) => read.source)
    const participation = characters.map(({ characterId }) => ({
      characterId,
      sources: reads.filter((read) => read.characterId === characterId).map((read) => read.source),
    }))
    const collectedAt =
      sources
        .flatMap((source) => (source.status.validatedAt ? [source.status.validatedAt] : []))
        .toSorted((left, right) => left.localeCompare(right))[0] ?? null
    return {
      activities: combineActivitySources(sources, characters, participation),
      freshness: { state: sourceFreshness(sources, collectedAt), collectedAt },
    }
  }

function sourceFreshness(sources: readonly ActivitySourceRead[], collectedAt: string | null) {
  if (!collectedAt) return 'unavailable' as const
  return sources.every((source) => source.status.status === 'current')
    ? ('current' as const)
    : ('stale' as const)
}
