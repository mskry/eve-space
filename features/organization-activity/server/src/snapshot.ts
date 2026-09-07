import type { PlatformEsiOperationData } from '@eve-space/platform-module-server'

export interface ActivitySnapshot {
  readonly id: string
  readonly kind: 'project' | 'job' | 'campaign' | 'objective'
  readonly campaignId: string | null
  readonly corporationId: number | null
  readonly title: string
  readonly description: string | null
  readonly objective: string | null
  readonly state: string
  readonly progress: { readonly current: number; readonly desired: number } | null
  readonly reward: { readonly initial: number; readonly remaining: number } | null
  readonly deadline: string | null
  readonly eligibility: 'unrestricted' | 'restricted' | 'unknown'
  readonly contributed: number | null
  readonly committed: boolean | null
}

type Project = PlatformEsiOperationData<'GetCorporationsProjectsDetail'>
type Job = PlatformEsiOperationData<'GetFreelanceJobsDetail'>
type Campaign = PlatformEsiOperationData<'GetMilitaryCampaignsDetail'>
type Objective = PlatformEsiOperationData<'GetMilitaryCampaignsObjectivesDetail'>
type Summary = PlatformEsiOperationData<'GetCorporationsProjectsListing'>['projects'][number]

export function projectSnapshot(data: Project, corporationId: number): ActivitySnapshot {
  return {
    ...summarySnapshot(data, 'project', corporationId),
    description: data.details.description,
    objective: Object.keys(data.configuration)[0]?.replaceAll('_', ' ') ?? null,
    deadline: data.details.expires ?? null,
    eligibility: 'unrestricted',
  }
}

export function jobSnapshot(data: Job): ActivitySnapshot {
  const restrictions = data.access_and_visibility.restrictions
  return {
    ...summarySnapshot(data, 'job', data.details.creator.corporation.id),
    description: data.details.description,
    objective: data.configuration.method,
    deadline: data.details.expires ?? null,
    eligibility:
      data.access_and_visibility.acl_protected ||
      restrictions?.minimum_age !== undefined ||
      restrictions?.maximum_age !== undefined
        ? 'restricted'
        : 'unrestricted',
  }
}

export function summarySnapshot(
  data: Summary,
  kind: 'project' | 'job',
  corporationId: number | null,
): ActivitySnapshot {
  return {
    id: data.id,
    kind,
    campaignId: null,
    corporationId,
    title: data.name,
    description: null,
    objective: null,
    state: data.state,
    progress: { current: data.progress.current, desired: data.progress.desired },
    reward: data.reward ? { initial: data.reward.initial, remaining: data.reward.remaining } : null,
    deadline: null,
    eligibility: 'unknown',
    contributed: null,
    committed: null,
  }
}

export function campaignSnapshot(data: Campaign): ActivitySnapshot {
  return {
    id: data.id,
    kind: 'campaign',
    campaignId: null,
    corporationId: null,
    title: `Military campaign ${data.id}`,
    description: null,
    objective: null,
    state: data.state,
    progress: { current: data.progress, desired: 1 },
    reward: null,
    deadline: null,
    eligibility: 'unknown',
    contributed: null,
    committed: null,
  }
}

export function objectiveSnapshot(data: Objective, campaignId: string): ActivitySnapshot {
  return {
    ...campaignSnapshot(data),
    kind: 'objective',
    campaignId,
    title: `Campaign objective ${data.id}`,
  }
}
