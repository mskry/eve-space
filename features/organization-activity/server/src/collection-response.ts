import type {
  PlatformEsiOperationData,
  PlatformCursorCheckpoint,
} from '@eve-space/platform-module-server'
import {
  campaignSnapshot,
  jobSnapshot,
  objectiveSnapshot,
  projectSnapshot,
  summarySnapshot,
  type ActivitySnapshot,
} from './snapshot.js'

export interface CollectionRequest {
  readonly operation: string
  readonly path: Readonly<Record<string, string | number>>
  readonly list?: string
  readonly cursorKey?: string
  readonly cursor?: PlatformCursorCheckpoint
  readonly replace: boolean
  readonly snapshot?: ActivitySnapshot
  readonly validatedAt?: string
}

export interface CollectionResponse {
  readonly snapshots: readonly ActivitySnapshot[]
  readonly requests: readonly CollectionRequest[]
  readonly cursor?: { readonly before?: string; readonly after?: string }
  readonly count: number
  readonly retainedIds?: readonly string[]
  readonly retainedCampaignIds?: readonly string[]
}

export function mapCollectionResponse(
  request: CollectionRequest,
  value: unknown,
  profile: string,
): CollectionResponse {
  const path = request.path
  const detail = (
    operation: string,
    parameters: Record<string, string | number>,
    snapshot?: ActivitySnapshot,
  ): CollectionRequest => ({
    operation,
    path: parameters,
    replace: request.replace,
    snapshot,
  })
  switch (request.operation) {
    case 'campaign-list': {
      const data = value as PlatformEsiOperationData<'GetMilitaryCampaignsListing'>
      const activeCampaigns = data.campaigns.filter((item) => item.state === 'Active')
      return {
        retainedIds: data.campaigns.map((item) => item.id),
        retainedCampaignIds: activeCampaigns.map((item) => item.id),
        snapshots: data.campaigns.map(campaignSnapshot),
        count: data.campaigns.length,
        requests: activeCampaigns.flatMap((item) => [
          detail('campaign-detail', { campaign_id: item.id }),
          {
            ...detail('objective-list', { campaign_id: item.id }),
            list: 'objectives',
            cursorKey: item.id,
          },
        ]),
      }
    }
    case 'campaign-detail':
      return single(
        campaignSnapshot(value as PlatformEsiOperationData<'GetMilitaryCampaignsDetail'>),
      )
    case 'objective-list': {
      const data = value as PlatformEsiOperationData<'GetMilitaryCampaignsObjectivesListing'>
      return {
        snapshots: [],
        cursor: data.cursor,
        count: data.objectives.length,
        requests: data.objectives.map((item) =>
          detail('objective-detail', { ...path, objective_id: item.id }),
        ),
      }
    }
    case 'objective-detail':
      return single(
        objectiveSnapshot(
          value as PlatformEsiOperationData<'GetMilitaryCampaignsObjectivesDetail'>,
          String(path.campaign_id),
        ),
      )
    case 'job-list':
    case 'corporation-jobs':
    case 'character-jobs': {
      const data = value as PlatformEsiOperationData<'GetFreelanceJobsListing'>
      const summaries = data.freelance_jobs.map((item) =>
        summarySnapshot(item, 'job', Number(path.corporation_id) || null),
      )
      if (request.operation === 'corporation-jobs')
        return { snapshots: summaries, requests: [], cursor: data.cursor, count: summaries.length }
      return {
        retainedIds:
          request.operation === 'character-jobs' ? summaries.map((item) => item.id) : undefined,
        snapshots: [],
        cursor: data.cursor,
        count: summaries.length,
        requests: summaries.map((item) =>
          detail(
            request.operation === 'character-jobs' ? 'job-participation' : 'job-detail',
            { ...path, job_id: item.id },
            item,
          ),
        ),
      }
    }
    case 'job-detail':
      return single(jobSnapshot(value as PlatformEsiOperationData<'GetFreelanceJobsDetail'>))
    case 'job-participation': {
      const data = value as PlatformEsiOperationData<'GetCharactersFreelanceJobsParticipation'>
      return single({
        ...requiredSnapshot(request),
        contributed: data.contributed,
        committed: data.state === 'Committed',
      })
    }
    case 'project-list': {
      const data = value as PlatformEsiOperationData<'GetCorporationsProjectsListing'>
      return {
        snapshots: [],
        cursor: data.cursor,
        count: data.projects.length,
        requests: data.projects.map((item) =>
          detail(
            profile === 'character-projects' ? 'project-contribution' : 'project-detail',
            { ...path, project_id: item.id },
            summarySnapshot(item, 'project', Number(path.corporation_id)),
          ),
        ),
      }
    }
    case 'project-detail':
      return single(
        projectSnapshot(
          value as PlatformEsiOperationData<'GetCorporationsProjectsDetail'>,
          Number(path.corporation_id),
        ),
      )
    case 'project-contribution': {
      const data = value as PlatformEsiOperationData<'GetCorporationsProjectsContribution'>
      return single({
        ...requiredSnapshot(request),
        contributed: data.contributed,
        committed: data.contributed > 0,
        eligibility: 'unrestricted',
      })
    }
    case 'character-objectives': {
      const data =
        value as PlatformEsiOperationData<'GetCharactersMilitaryCampaignsObjectivesListing'>
      return {
        snapshots: [],
        cursor: data.cursor,
        count: data.objectives.length,
        requests: data.objectives.map((item) =>
          detail('objective-participation', { ...path, objective_id: item.id }),
        ),
      }
    }
    case 'objective-participation': {
      const data =
        value as PlatformEsiOperationData<'GetCharactersMilitaryCampaignsObjectivesParticipation'>
      return single({
        ...campaignSnapshot({ id: data.id, progress: 0, state: 'Unspecified' }),
        kind: 'objective',
        campaignId: data.campaign_id,
        contributed: data.contributed,
        committed: data.is_committed,
        eligibility: data.is_committed ? 'unrestricted' : 'unknown',
      })
    }
    default:
      throw new Error('Unknown activity collection operation')
  }
}

function single(snapshot: ActivitySnapshot): CollectionResponse {
  return { snapshots: [snapshot], requests: [], count: 1 }
}

function requiredSnapshot(request: CollectionRequest) {
  if (!request.snapshot) throw new Error('Participation requires an activity identity')
  return request.snapshot
}
