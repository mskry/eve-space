import type {
  PlatformActivityFreshness,
  PlatformActivityProvider,
  PlatformActivityProviderCapabilities,
  PlatformCollectionStatus,
  PlatformModuleResourceTransaction,
} from '@eve-space/platform-module-contract'

interface SnapshotRow {
  readonly character_id: number
  readonly pilots_online: number
  readonly validated_at: string
}

export function conformanceActivityProvider(
  capabilities: PlatformActivityProviderCapabilities<PlatformModuleResourceTransaction>,
): PlatformActivityProvider {
  return async (context) => {
    const character = context.characters.find(({ membership }) => membership === 'managed')
    if (!character)
      return { activities: [], freshness: { state: 'unavailable', collectedAt: null } }

    const status = await capabilities.collectionStatus.read('conformance-status', {
      kind: 'character',
      characterId: character.characterId,
    })
    const rows = await capabilities.persistence.transaction((transaction) =>
      transaction.query<SnapshotRow>(
        `select character_id, pilots_online, validated_at
         from conformance_snapshots
         where character_id = $1`,
        [character.characterId],
      ),
    )
    const snapshot = rows[0]
    const freshness = activityFreshness(status)
    if (!snapshot) return { activities: [], freshness }

    capabilities.logger.info('conformance.provider.loaded', {
      characterId: character.characterId,
    })
    return {
      freshness,
      activities: [
        {
          id: `status:${character.characterId}`,
          kind: 'conformance-status',
          title: `${snapshot.pilots_online} pilots online`,
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
    }
  }
}

function activityFreshness(status: PlatformCollectionStatus): PlatformActivityFreshness {
  if (status.status === 'current' || status.status === 'stale')
    return { state: status.status, collectedAt: status.validatedAt }
  if (status.status === 'authorization-required')
    return { state: 'authorization-required', collectedAt: status.validatedAt }
  return { state: 'unavailable', collectedAt: status.validatedAt }
}
