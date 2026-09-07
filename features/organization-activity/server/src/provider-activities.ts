import type {
  PlatformActivity,
  PlatformActivityParticipation,
  PlatformActivityProviderCharacter,
} from '@eve-space/platform-module-contract'
import type { ActivitySourceRead } from './activity-source.js'
import type { ActivitySnapshot } from './snapshot.js'

export function combineActivitySources(
  sources: readonly ActivitySourceRead[],
  characters: readonly PlatformActivityProviderCharacter[],
  privateSources: readonly {
    readonly characterId: number
    readonly sources: readonly ActivitySourceRead[]
  }[],
): readonly PlatformActivity[] {
  const records = new Map<string, { snapshot: ActivitySnapshot; source: ActivitySourceRead }>()
  for (const source of sources)
    for (const snapshot of source.snapshots) {
      const existing = records.get(snapshot.id)
      if (!existing || (source.status.status === 'current' && snapshot.description !== null))
        records.set(snapshot.id, { snapshot, source })
    }
  for (const participation of privateSources)
    for (const source of participation.sources)
      for (const snapshot of source.snapshots)
        if (snapshot.kind === 'job' && !records.has(snapshot.id))
          records.set(snapshot.id, { snapshot, source })
  const activities: PlatformActivity[] = []
  for (const { snapshot, source } of records.values()) {
    if (snapshot.state !== 'Active') continue
    const managed = characters.filter(
      (character) =>
        character.membership === 'managed' &&
        (snapshot.kind !== 'project' || character.corporationId === snapshot.corporationId),
    )
    const participation = managed.map((character): PlatformActivityParticipation => {
      const resourceId =
        snapshot.kind === 'project'
          ? 'character-projects'
          : snapshot.kind === 'job'
            ? 'character-jobs'
            : 'character-campaigns'
      const privateSource = privateSources
        .find((item) => item.characterId === character.characterId)
        ?.sources.find((item) => item.resourceId === resourceId)
      if (privateSource?.status.status === 'authorization-required')
        return { characterId: character.characterId, state: 'authorization-required' }
      if (
        source.status.status !== 'current' ||
        character.affiliationFreshness !== 'fresh' ||
        privateSource?.status.status !== 'current'
      )
        return { characterId: character.characterId, state: 'unavailable' }
      const own = privateSource.snapshots.find(
        (item) => item.id === snapshot.id || item.campaignId === snapshot.id,
      )
      if (own?.committed) return { characterId: character.characterId, state: 'participating' }
      return {
        characterId: character.characterId,
        state: snapshot.eligibility === 'unrestricted' ? 'eligible' : 'unavailable',
      }
    })
    const eligibleCharacterIds = participation
      .filter((item) => item.state === 'eligible' || item.state === 'participating')
      .map((item) => item.characterId)
    const authorization = participation.find((item) => item.state === 'authorization-required')
    const selectedCharacter = eligibleCharacterIds[0] ?? authorization?.characterId ?? null
    activities.push({
      id: snapshot.id,
      kind: snapshot.kind,
      title: snapshot.title,
      summary: snapshot.description?.slice(0, 2000) ?? snapshot.objective,
      requiredAction: authorization
        ? {
            kind: 'authorization',
            label: 'Authorize this character to view participation',
            characterId: authorization.characterId,
          }
        : eligibleCharacterIds.length > 0
          ? {
              kind: 'participation',
              label: 'View participation in EVE Online',
              characterId: selectedCharacter,
            }
          : null,
      organizationPriority: 0,
      deadline: snapshot.deadline,
      eligibleCharacterIds,
      participation,
      linkTarget: {
        pageId: `organization-activity-${snapshot.kind === 'project' ? 'projects' : snapshot.kind === 'job' ? 'jobs' : 'campaigns'}`,
        characterId: selectedCharacter,
        activityId: snapshot.campaignId ?? snapshot.id,
        corporationId: snapshot.corporationId,
      },
      freshness: {
        state: source.status.status === 'current' ? 'current' : 'stale',
        collectedAt: source.status.validatedAt,
      },
    })
  }
  return activities
    .toSorted(
      (left, right) =>
        Number(Boolean(right.requiredAction)) - Number(Boolean(left.requiredAction)) ||
        (left.deadline ?? '9999').localeCompare(right.deadline ?? '9999') ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 100)
}
