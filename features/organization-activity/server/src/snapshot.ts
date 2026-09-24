import type { ActivityOperationData } from './activity-protocol.js'

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

type Project = ActivityOperationData<'project-detail'>
type Job = ActivityOperationData<'job-detail'>
type Campaign = ActivityOperationData<'campaign-detail'>
type Objective = ActivityOperationData<'objective-detail'>
type Summary = ActivityOperationData<'project-list'>['projects'][number]

export function projectSnapshot(data: Project, corporationId: number): ActivitySnapshot {
  return {
    ...summarySnapshot(data, 'project', corporationId),
    deadline: data.details.expires ?? null,
    description: data.details.description,
    eligibility: 'unrestricted',
    objective: Object.keys(data.configuration)[0]?.replaceAll('_', ' ') ?? null,
  }
}

export function jobSnapshot(data: Job): ActivitySnapshot {
  const restrictions = data.access_and_visibility.restrictions
  return {
    ...summarySnapshot(data, 'job', data.details.creator.corporation.id),
    deadline: data.details.expires ?? null,
    description: data.details.description,
    eligibility:
      data.access_and_visibility.acl_protected ||
      restrictions?.minimum_age !== undefined ||
      restrictions?.maximum_age !== undefined
        ? 'restricted'
        : 'unrestricted',
    objective: data.configuration.method,
  }
}

export function summarySnapshot(
  data: Summary,
  kind: 'project' | 'job',
  corporationId: number | null,
): ActivitySnapshot {
  return {
    campaignId: null,
    committed: null,
    contributed: null,
    corporationId,
    deadline: null,
    description: null,
    eligibility: 'unknown',
    id: data.id,
    kind,
    objective: null,
    progress: { current: data.progress.current, desired: data.progress.desired },
    reward: data.reward ? { initial: data.reward.initial, remaining: data.reward.remaining } : null,
    state: data.state,
    title: data.name,
  }
}

export function campaignSnapshot(data: Campaign): ActivitySnapshot {
  return {
    campaignId: null,
    committed: null,
    contributed: null,
    corporationId: null,
    deadline: null,
    description: null,
    eligibility: 'unknown',
    id: data.id,
    kind: 'campaign',
    objective: null,
    progress: { current: data.progress, desired: 1 },
    reward: null,
    state: data.state,
    title: `Military campaign ${data.id}`,
  }
}

export function objectiveSnapshot(data: Objective, campaignId: string): ActivitySnapshot {
  return {
    ...campaignSnapshot(data),
    campaignId,
    kind: 'objective',
    title: `Campaign objective ${data.id}`,
  }
}
