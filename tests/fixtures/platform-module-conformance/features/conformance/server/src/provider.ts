import type {
  PlatformActivityFreshness,
  PlatformActivityProvider,
  PlatformActivityProviderCapabilities,
} from '@eve-space/platform-module-contract/activity'
import type { PlatformCollectionStatus } from '@eve-space/platform-module-contract/server'
import type { ConformanceSnapshotReadPersistence } from './persistence.js'

type ConformanceActivityProviderCapabilities =
  PlatformActivityProviderCapabilities<ConformanceSnapshotReadPersistence>

export function conformanceActivityProvider(
  capabilities: ConformanceActivityProviderCapabilities,
): PlatformActivityProvider {
  return async (context) => {
    const character = context.characters.find(({ membership }) => membership === 'managed')
    if (!character) {
      return { activities: [], freshness: { collectedAt: null, state: 'unavailable' } }
    }

    const status = await capabilities.collectionStatus.read('conformance-status', {
      characterId: character.characterId,
      kind: 'character',
    })
    const snapshot = await capabilities.persistence.readConformanceSnapshot({
      characterId: character.characterId,
    })
    const freshness = activityFreshness(status)
    if (!snapshot) {
      return { activities: [], freshness }
    }

    capabilities.logger.info('conformance.provider.loaded', {
      characterId: character.characterId,
    })
    return {
      activities: [
        {
          id: `status:${character.characterId}`,
          kind: 'conformance-status',
          title: `${snapshot.pilotsOnline} pilots online`,
          summary: 'A bounded conformance activity from module-owned storage.',
          objective: null,
          state: 'Active',
          progress: null,
          reward: null,
          requiredAction: {
            kind: 'participation',
            label: 'Review activity',
            characterId: character.characterId,
          },
          organizationPriority: 10,
          deadline: null,
          eligibleCharacterIds: [character.characterId],
          participation: [
            { characterId: character.characterId, state: 'eligible', contribution: null },
          ],
          linkTarget: {
            pageId: 'conformance-activity-page',
            characterId: character.characterId,
          },
          freshness,
        },
      ],
      freshness,
    }
  }
}

function activityFreshness(status: PlatformCollectionStatus): PlatformActivityFreshness {
  if (status.status === 'current' || status.status === 'stale') {
    return { collectedAt: status.validatedAt, state: status.status }
  }
  if (status.status === 'authorization-required') {
    return { collectedAt: status.validatedAt, state: 'authorization-required' }
  }
  return { collectedAt: status.validatedAt, state: 'unavailable' }
}
