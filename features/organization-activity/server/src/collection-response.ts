import type {
  PlatformResourceOperationMethods,
  PlatformResourceOperationResult,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformCursorCheckpoint } from '@eve-space/platform-module-server'
import type {
  ActivityEsiOperation,
  ActivityOperationData,
  ActivityOperationId,
  ActivityProtocol,
} from './activity-protocol.js'
import {
  campaignSnapshot,
  jobSnapshot,
  objectiveSnapshot,
  projectSnapshot,
  summarySnapshot,
  type ActivitySnapshot,
} from './snapshot.js'

const collectionOperationHandlers = {
  'campaign-detail': async ({ request, operations }) => {
    const result = await requireOperation(
      operations,
      'organization-activity-campaign-detail',
    )({
      path: { campaign_id: pathString(request, 'campaign_id') },
    })
    return collected(result, single(campaignSnapshot(result.data)))
  },
  'campaign-list': async ({ request, operations }) => {
    const result = await requireOperation(operations, 'organization-activity-campaign-list')({})
    return collected(result, mapCampaignList(request, result.data))
  },
  'character-jobs': async ({ request, operations }) => {
    const result = await requireOperation(
      operations,
      'organization-activity-character-jobs',
    )({
      path: { character_id: pathInteger(request, 'character_id') },
    })
    return collected(result, {
      ...mapJobDetails(request, result.data.freelance_jobs, undefined, 'job-participation'),
      retainedIds: result.data.freelance_jobs.map((item) => item.id),
    })
  },
  'character-objectives': async ({ request, query, operations }) => {
    const result = await requireOperation(
      operations,
      'organization-activity-character-objectives',
    )({
      path: { character_id: pathInteger(request, 'character_id') },
      ...withQuery(query),
    })
    return collected(result, {
      snapshots: [],
      cursor: result.data.cursor,
      count: result.data.objectives.length,
      requests: result.data.objectives.map((item) =>
        detail(request, 'objective-participation', { ...request.path, objective_id: item.id }),
      ),
    })
  },
  'corporation-jobs': async ({ request, query, operations }) => {
    const corporationId = pathInteger(request, 'corporation_id')
    const result = await requireOperation(
      operations,
      'organization-activity-corporation-jobs',
    )({
      path: { corporation_id: corporationId },
      ...withQuery(query),
    })
    const summaries = result.data.freelance_jobs.map((item) =>
      summarySnapshot(item, 'job', corporationId),
    )
    return collected(result, {
      snapshots: summaries,
      requests: [],
      cursor: result.data.cursor,
      count: summaries.length,
    })
  },
  'job-detail': async ({ request, operations }) => {
    const result = await requireOperation(
      operations,
      'organization-activity-job-detail',
    )({
      path: { job_id: pathString(request, 'job_id') },
    })
    return collected(result, single(jobSnapshot(result.data)))
  },
  'job-list': async ({ request, query, operations }) => {
    const result = await requireOperation(
      operations,
      'organization-activity-job-list',
    )({
      ...withQuery(query),
    })
    return collected(
      result,
      mapJobDetails(request, result.data.freelance_jobs, result.data.cursor, 'job-detail'),
    )
  },
  'job-participation': async ({ request, operations }) => {
    const result = await requireOperation(
      operations,
      'organization-activity-job-participation',
    )({
      path: {
        character_id: pathInteger(request, 'character_id'),
        job_id: pathString(request, 'job_id'),
      },
    })
    return collected(
      result,
      single({
        ...requiredSnapshot(request),
        contributed: result.data.contributed,
        committed: result.data.state === 'Committed',
      }),
    )
  },
  'objective-detail': async ({ request, operations }) => {
    const campaignId = pathString(request, 'campaign_id')
    const result = await requireOperation(
      operations,
      'organization-activity-objective-detail',
    )({
      path: { campaign_id: campaignId, objective_id: pathString(request, 'objective_id') },
    })
    return collected(result, single(objectiveSnapshot(result.data, campaignId)))
  },
  'objective-list': async ({ request, query, operations }) => {
    const result = await requireOperation(
      operations,
      'organization-activity-objective-list',
    )({
      path: { campaign_id: pathString(request, 'campaign_id') },
      ...withQuery(query),
    })
    return collected(result, {
      snapshots: [],
      cursor: result.data.cursor,
      count: result.data.objectives.length,
      requests: result.data.objectives.map((item) =>
        detail(request, 'objective-detail', { ...request.path, objective_id: item.id }),
      ),
    })
  },
  'objective-participation': async ({ request, operations }) => {
    const result = await requireOperation(
      operations,
      'organization-activity-objective-participation',
    )({
      path: {
        character_id: pathInteger(request, 'character_id'),
        objective_id: pathString(request, 'objective_id'),
      },
    })
    const data = result.data
    return collected(
      result,
      single({
        ...campaignSnapshot({ id: data.id, progress: 0, state: 'Unspecified' }),
        kind: 'objective',
        campaignId: data.campaign_id,
        contributed: data.contributed,
        committed: data.is_committed,
        eligibility: data.is_committed ? 'unrestricted' : 'unknown',
      }),
    )
  },
  'project-contribution': async ({ request, operations }) => {
    const result = await requireOperation(
      operations,
      'organization-activity-project-contribution',
    )({
      path: {
        corporation_id: pathInteger(request, 'corporation_id'),
        project_id: pathString(request, 'project_id'),
        character_id: pathInteger(request, 'character_id'),
      },
    })
    return collected(
      result,
      single({
        ...requiredSnapshot(request),
        contributed: result.data.contributed,
        committed: result.data.contributed > 0,
        eligibility: 'unrestricted',
      }),
    )
  },
  'project-detail': async ({ request, operations }) => {
    const corporationId = pathInteger(request, 'corporation_id')
    const result = await requireOperation(
      operations,
      'organization-activity-project-detail',
    )({
      path: { corporation_id: corporationId, project_id: pathString(request, 'project_id') },
    })
    return collected(result, single(projectSnapshot(result.data, corporationId)))
  },
  'project-list': async ({ request, query, operations, profile }) => {
    const corporationId = pathInteger(request, 'corporation_id')
    const result = await requireOperation(
      operations,
      'organization-activity-project-list',
    )({
      path: { corporation_id: corporationId },
      ...withQuery(query),
    })
    const detailOperation =
      profile === 'character-projects' ? 'project-contribution' : 'project-detail'
    return collected(result, {
      snapshots: [],
      cursor: result.data.cursor,
      count: result.data.projects.length,
      requests: result.data.projects.map((item) =>
        detail(
          request,
          detailOperation,
          { ...request.path, project_id: item.id },
          summarySnapshot(item, 'project', corporationId),
        ),
      ),
    })
  },
} satisfies { readonly [Operation in ActivityOperationId]: CollectionOperationHandler }

export interface CollectionRequest {
  readonly operation: ActivityOperationId
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

export interface CollectionExecution {
  readonly response: CollectionResponse
  readonly validatedAt: string
}

export type CollectionCursorQuery = {
  readonly limit: number
  readonly before?: string
  readonly after?: string
}

export type ActivityOperationMethods = Partial<
  PlatformResourceOperationMethods<ActivityProtocol<ActivityOperationId>>
>

interface CollectionOperationInput {
  readonly request: CollectionRequest
  readonly query: CollectionCursorQuery | undefined
  readonly operations: ActivityOperationMethods
  readonly profile: string
}

type CollectionOperationHandler = (input: CollectionOperationInput) => Promise<CollectionExecution>

export function executeCollectionOperation(
  input: CollectionOperationInput,
): Promise<CollectionExecution> {
  return collectionOperationHandlers[input.request.operation](input)
}

function mapCampaignList(
  request: CollectionRequest,
  data: ActivityOperationData<'campaign-list'>,
): CollectionResponse {
  const activeCampaigns = data.campaigns.filter((item) => item.state === 'Active')
  return {
    count: data.campaigns.length,
    requests: activeCampaigns.flatMap((item) => [
      detail(request, 'campaign-detail', { campaign_id: item.id }),
      {
        ...detail(request, 'objective-list', { campaign_id: item.id }),
        list: 'objectives',
        cursorKey: item.id,
      },
    ]),
    retainedCampaignIds: activeCampaigns.map((item) => item.id),
    retainedIds: data.campaigns.map((item) => item.id),
    snapshots: data.campaigns.map((item) => campaignSnapshot(item)),
  }
}

function mapJobDetails(
  request: CollectionRequest,
  jobs: ActivityOperationData<'job-list'>['freelance_jobs'],
  cursor: CollectionResponse['cursor'],
  detailOperation: 'job-detail' | 'job-participation',
): CollectionResponse {
  const corporationId = optionalPathInteger(request, 'corporation_id')
  const summaries = jobs.map((item) => summarySnapshot(item, 'job', corporationId))
  return {
    count: summaries.length,
    cursor,
    requests: summaries.map((item) =>
      detail(request, detailOperation, { ...request.path, job_id: item.id }, item),
    ),
    snapshots: [],
  }
}

function requireOperation<Operation extends ActivityEsiOperation>(
  operations: ActivityOperationMethods,
  operation: Operation,
) {
  const method = operations[operation]
  if (!method) {
    throw new Error(`Activity collection operation ${operation} is undeclared`)
  }
  return method
}

function collected(
  result: PlatformResourceOperationResult<unknown>,
  response: CollectionResponse,
): CollectionExecution {
  return { response, validatedAt: result.validatedAt }
}

function detail(
  request: CollectionRequest,
  operation: ActivityOperationId,
  path: Readonly<Record<string, string | number>>,
  snapshot?: ActivitySnapshot,
): CollectionRequest {
  return { operation, path, replace: request.replace, snapshot }
}

function withQuery(query: CollectionCursorQuery | undefined) {
  return query ? { query } : {}
}

function single(snapshot: ActivitySnapshot): CollectionResponse {
  return { count: 1, requests: [], snapshots: [snapshot] }
}

function requiredSnapshot(request: CollectionRequest) {
  if (!request.snapshot) {
    throw new Error('Participation requires an activity identity')
  }
  return request.snapshot
}

function pathString(request: CollectionRequest, field: string) {
  const value = request.path[field]
  if (typeof value !== 'string') {
    throw new TypeError(`Activity collection request lacks ${field}`)
  }
  return value
}

function pathInteger(request: CollectionRequest, field: string) {
  const value = optionalPathInteger(request, field)
  if (value === null) {
    throw new Error(`Activity collection request lacks ${field}`)
  }
  return value
}

function optionalPathInteger(request: CollectionRequest, field: string) {
  const value = request.path[field]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}
