import type {
  PlatformActivity,
  PlatformActivityParticipation,
  PlatformActivityProviderCharacter,
} from '@eve-space/platform-module-contract/activity'
import type { ActivitySourceRead } from './activity-source.js'
import type { ActivitySnapshot } from './snapshot.js'

const activityKindMetadata = {
  campaign: {
    pageId: 'organization-activity-campaigns',
    resourceId: 'character-campaigns',
  },
  job: { pageId: 'organization-activity-jobs', resourceId: 'character-jobs' },
  objective: {
    pageId: 'organization-activity-campaigns',
    resourceId: 'character-campaigns',
  },
  project: {
    pageId: 'organization-activity-projects',
    resourceId: 'character-projects',
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
    if (activity) {
      activities.push(activity)
    }
  }
  return activities.toSorted(compareActivities).slice(0, 100)
}

function collectSourceRecords(
  sources: readonly ActivitySourceRead[],
  records: Map<string, ActivityRecord>,
) {
  for (const source of sources) {
    for (const snapshot of source.snapshots) {
      const existing = records.get(snapshot.id)
      if (!existing || (source.status.status === 'current' && snapshot.description !== null))
        records.set(snapshot.id, { snapshot, source })
    }
  }
}

function collectPrivateJobRecords(
  privateSources: readonly CharacterActivitySources[],
  records: Map<string, ActivityRecord>,
) {
  for (const participation of privateSources) {
    for (const source of participation.sources)
      for (const snapshot of source.snapshots)
        if (snapshot.kind === 'job' && !records.has(snapshot.id))
          records.set(snapshot.id, { snapshot, source })
  }
}

function createActivity(
  { snapshot, source }: ActivityRecord,
  characters: readonly PlatformActivityProviderCharacter[],
  privateSources: readonly CharacterActivitySources[],
): PlatformActivity | null {
  if (snapshot.state !== 'Active') {
    return null
  }
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
    deadline: snapshot.deadline,
    eligibleCharacterIds,
    freshness: {
      collectedAt: source.status.validatedAt,
      state: source.status.status === 'current' ? 'current' : 'stale',
    },
    id: snapshot.id,
    kind: snapshot.kind,
    linkTarget: {
      activityId: snapshot.campaignId ?? snapshot.id,
      characterId: selectedCharacter,
      corporationId: snapshot.corporationId,
      pageId: activityKindMetadata[snapshot.kind].pageId,
    },
    objective: snapshot.objective,
    organizationPriority: 0,
    participation,
    progress: snapshot.progress,
    requiredAction: requiredActionFor(authorization, selectedCharacter),
    reward: snapshot.reward,
    state: snapshot.state,
    summary: snapshot.description?.slice(0, 2000) ?? snapshot.objective,
    title: snapshot.title,
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
  if (privateSource?.status.status === 'authorization-required') {
    return {
      characterId: character.characterId,
      contribution: null,
      state: 'authorization-required',
    }
  }
  if (
    source.status.status !== 'current' ||
    character.affiliationFreshness !== 'fresh' ||
    privateSource?.status.status !== 'current'
  ) {
    return { characterId: character.characterId, contribution: null, state: 'unavailable' }
  }
  const own = privateSource.snapshots.find((item) => item.id === snapshot.id)
  const participatingObjective =
    snapshot.kind === 'campaign'
      ? privateSource.snapshots.find(
          (item) => item.campaignId === snapshot.id && item.committed === true,
        )
      : undefined
  if (own?.committed || participatingObjective) {
    return {
      characterId: character.characterId,
      contribution: snapshot.kind === 'campaign' ? null : (own?.contributed ?? null),
      state: 'participating',
    }
  }
  return {
    characterId: character.characterId,
    contribution: own?.contributed ?? null,
    state: snapshot.eligibility === 'unrestricted' ? 'eligible' : 'unavailable',
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
  if (authorization) {
    return {
      characterId: authorization.characterId,
      kind: 'authorization',
      label: 'Authorize this character to view participation',
    }
  }
  if (selectedCharacter !== null) {
    return {
      characterId: selectedCharacter,
      kind: 'participation',
      label: 'View participation in EVE Online',
    }
  }
  return null
}
