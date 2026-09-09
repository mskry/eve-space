import type {
  PlatformActivity,
  PlatformActivityParticipation,
  PlatformActivityProviderCharacter,
} from '@eve-space/platform-module-contract'
import type { ActivitySourceRead } from './activity-source.js'
import type { ActivitySnapshot } from './snapshot.js'

const activityKindMetadata = {
  project: {
    resourceId: 'character-projects',
    pageId: 'organization-activity-projects',
  },
  job: { resourceId: 'character-jobs', pageId: 'organization-activity-jobs' },
  campaign: {
    resourceId: 'character-campaigns',
    pageId: 'organization-activity-campaigns',
  },
  objective: {
    resourceId: 'character-campaigns',
    pageId: 'organization-activity-campaigns',
  },
} as const satisfies Record<
  ActivitySnapshot['kind'],
  { readonly resourceId: string; readonly pageId: string }
>

interface CharacterActivitySources {
  readonly characterId: number
  readonly sources: readonly ActivitySourceRead[]
}

interface ActivityRecord {
  readonly snapshot: ActivitySnapshot
  readonly source: ActivitySourceRead
}

export function combineActivitySources(
  sources: readonly ActivitySourceRead[],
  characters: readonly PlatformActivityProviderCharacter[],
  privateSources: readonly CharacterActivitySources[],
): readonly PlatformActivity[] {
  const records = new Map<string, ActivityRecord>()
  collectSourceRecords(sources, records)
  collectPrivateJobRecords(privateSources, records)
  const activities: PlatformActivity[] = []
  for (const record of records.values()) {
    const activity = createActivity(record, characters, privateSources)
    if (activity) activities.push(activity)
  }
  return activities.toSorted(compareActivities).slice(0, 100)
}

function collectSourceRecords(
  sources: readonly ActivitySourceRead[],
  records: Map<string, ActivityRecord>,
) {
  for (const source of sources)
    for (const snapshot of source.snapshots) {
      const existing = records.get(snapshot.id)
      if (!existing || (source.status.status === 'current' && snapshot.description !== null))
        records.set(snapshot.id, { snapshot, source })
    }
}

function collectPrivateJobRecords(
  privateSources: readonly CharacterActivitySources[],
  records: Map<string, ActivityRecord>,
) {
  for (const participation of privateSources)
    for (const source of participation.sources)
      for (const snapshot of source.snapshots)
        if (snapshot.kind === 'job' && !records.has(snapshot.id))
          records.set(snapshot.id, { snapshot, source })
}

function createActivity(
  { snapshot, source }: ActivityRecord,
  characters: readonly PlatformActivityProviderCharacter[],
  privateSources: readonly CharacterActivitySources[],
): PlatformActivity | null {
  if (snapshot.state !== 'Active') return null
  const managed = characters.filter(
    (character) =>
      character.membership === 'managed' &&
      (snapshot.kind !== 'project' || character.corporationId === snapshot.corporationId),
  )
  const participation = managed.map((character) =>
    createParticipation(snapshot, source, character, privateSources),
  )
  const eligibleCharacterIds = participation
    .filter((item) => item.state === 'eligible' || item.state === 'participating')
    .map((item) => item.characterId)
  const authorization = participation.find((item) => item.state === 'authorization-required')
  const selectedCharacter = eligibleCharacterIds[0] ?? authorization?.characterId ?? null
  return {
    id: snapshot.id,
    kind: snapshot.kind,
    title: snapshot.title,
    summary: snapshot.description?.slice(0, 2000) ?? snapshot.objective,
    objective: snapshot.objective,
    state: snapshot.state,
    progress: snapshot.progress,
    reward: snapshot.reward,
    requiredAction: requiredActionFor(authorization, selectedCharacter),
    organizationPriority: 0,
    deadline: snapshot.deadline,
    eligibleCharacterIds,
    participation,
    linkTarget: {
      pageId: activityKindMetadata[snapshot.kind].pageId,
      characterId: selectedCharacter,
      activityId: snapshot.campaignId ?? snapshot.id,
      corporationId: snapshot.corporationId,
    },
    freshness: {
      state: source.status.status === 'current' ? 'current' : 'stale',
      collectedAt: source.status.validatedAt,
    },
  }
}

function createParticipation(
  snapshot: ActivitySnapshot,
  source: ActivitySourceRead,
  character: PlatformActivityProviderCharacter,
  privateSources: readonly CharacterActivitySources[],
): PlatformActivityParticipation {
  const resourceId = activityKindMetadata[snapshot.kind].resourceId
  const privateSource = privateSources
    .find((item) => item.characterId === character.characterId)
    ?.sources.find((item) => item.resourceId === resourceId)
  if (privateSource?.status.status === 'authorization-required')
    return {
      characterId: character.characterId,
      state: 'authorization-required',
      contribution: null,
    }
  if (
    source.status.status !== 'current' ||
    character.affiliationFreshness !== 'fresh' ||
    privateSource?.status.status !== 'current'
  )
    return { characterId: character.characterId, state: 'unavailable', contribution: null }
  const own = privateSource.snapshots.find((item) => item.id === snapshot.id)
  const participatingObjective =
    snapshot.kind === 'campaign'
      ? privateSource.snapshots.find(
          (item) => item.campaignId === snapshot.id && item.committed === true,
        )
      : undefined
  if (own?.committed || participatingObjective)
    return {
      characterId: character.characterId,
      state: 'participating',
      contribution: snapshot.kind === 'campaign' ? null : (own?.contributed ?? null),
    }
  return {
    characterId: character.characterId,
    state: snapshot.eligibility === 'unrestricted' ? 'eligible' : 'unavailable',
    contribution: own?.contributed ?? null,
  }
}

function compareActivities(left: PlatformActivity, right: PlatformActivity) {
  return (
    Number(Boolean(right.requiredAction)) - Number(Boolean(left.requiredAction)) ||
    (left.deadline ?? '9999').localeCompare(right.deadline ?? '9999') ||
    left.id.localeCompare(right.id)
  )
}

function requiredActionFor(
  authorization: PlatformActivityParticipation | undefined,
  selectedCharacter: number | null,
): PlatformActivity['requiredAction'] {
  if (authorization)
    return {
      kind: 'authorization',
      label: 'Authorize this character to view participation',
      characterId: authorization.characterId,
    }
  if (selectedCharacter !== null)
    return {
      kind: 'participation',
      label: 'View participation in EVE Online',
      characterId: selectedCharacter,
    }
  return null
}
