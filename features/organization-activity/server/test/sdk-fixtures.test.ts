import { expect, test, vi } from 'vitest'
import * as operations from '../src/operations.js'
import * as resources from '../src/resources.js'
import { executeCollectionOperation } from '../src/collection-response.js'
import { jobSnapshot, projectSnapshot } from '../src/snapshot.js'
import { organizationActivityProvider } from '../src/provider.js'

const id = '11111111-1111-4111-8111-111111111111'
const now = '2026-09-07T10:00:00.000Z'
const summary = {
  id,
  last_modified: now,
  name: 'Supplies',
  progress: { current: 1, desired: 10 },
  reward: { initial: 100, remaining: 90 },
  state: 'Active' as const,
}
const campaign = { id, last_modified: now, progress: 20, state: 'Active' }
const objective = { ...campaign, participants: { committed: 1, contributors: 1, total: 1 } }
const participation = {
  campaign_id: id,
  contributed: 1,
  id,
  is_committed: true,
  last_modified: now,
}
const project = {
  ...summary,
  configuration: { manual: {} },
  creator: { id: 9001, name: 'Creator' },
  details: {
    career: 'Industrialist' as const,
    created: now,
    description: 'Deliver supplies',
    expires: now,
  },
}
const job = {
  ...summary,
  access_and_visibility: { acl_protected: false },
  configuration: { method: 'delivery', parameters: {}, version: 1 },
  details: {
    ...project.details,
    creator: {
      character: { id: 9001, name: 'Creator' },
      corporation: { id: 9801, name: 'Corporation' },
    },
  },
}
const fixtures = [
  [operations.campaignListOperation, 'campaign-list', { campaigns: [campaign] }, {}],
  [operations.campaignDetailOperation, 'campaign-detail', campaign, { campaign_id: id }],
  [
    operations.objectiveListOperation,
    'objective-list',
    { cursor: { after: 'after' }, objectives: [objective] },
    { campaign_id: id },
  ],
  [
    operations.objectiveDetailOperation,
    'objective-detail',
    objective,
    { campaign_id: id, objective_id: id },
  ],
  [operations.jobListOperation, 'job-list', { freelance_jobs: [summary] }, {}],
  [operations.jobDetailOperation, 'job-detail', job, { job_id: id }],
  [
    operations.corporationJobsOperation,
    'corporation-jobs',
    { freelance_jobs: [summary] },
    { corporation_id: 9801 },
  ],
  [
    operations.characterJobsOperation,
    'character-jobs',
    { freelance_jobs: [summary] },
    { character_id: 9001 },
  ],
  [
    operations.jobParticipationOperation,
    'job-participation',
    { contributed: 1, id, last_modified: now, state: 'Committed' },
    { character_id: 9001, job_id: id },
  ],
  [
    operations.projectListOperation,
    'project-list',
    { projects: [summary] },
    { corporation_id: 9801 },
  ],
  [
    operations.projectDetailOperation,
    'project-detail',
    project,
    { corporation_id: 9801, project_id: id },
  ],
  [
    operations.projectContributionOperation,
    'project-contribution',
    { contributed: 1 },
    { character_id: 9001, corporation_id: 9801, project_id: id },
  ],
  [
    operations.characterObjectivesOperation,
    'character-objectives',
    { objectives: [participation] },
    { character_id: 9001 },
  ],
  [
    operations.objectiveParticipationOperation,
    'objective-participation',
    participation,
    { character_id: 9001, objective_id: id },
  ],
] as const

test.each(fixtures.map(([operation, name, fixture, path]) => ({ fixture, name, operation, path })))(
  'validates SDK fixtures for $name and maps intentional DTOs',
  async ({ operation, name, fixture, path }) => {
    const response = operation.descriptor.transport.successResponses.find(
      (item) => item.status === 200,
    )
    expect(response?.body).toBe('json')
    if (!response || response.body !== 'json') {
      throw new Error('Missing SDK response schema')
    }
    const data = response.schema.parse(fixture)
    expect(() => response.schema.parse({})).toThrow(/Invalid input/)
    const method = vi.fn(async (_inputs: unknown) => ({ data, validatedAt: now }))
    const { response: mapped } = await executeCollectionOperation({
      operations: { [`organization-activity-${name}`]: method },
      profile: 'corporation-projects',
      query: undefined,
      request: { operation: name, path, replace: true, snapshot: projectSnapshot(project, 9801) },
    })
    expect(method).toHaveBeenCalledOnce()
    const inputs = method.mock.calls[0]?.[0]
    expect(inputs).toStrictEqual(Object.keys(path).length ? { path } : {})
    expect(() => operation.descriptor.requestSchema.parse(inputs)).not.toThrow()
    expect(mapped.count).toBeGreaterThan(0)
    for (const snapshot of mapped.snapshots) {
      expect(snapshot).not.toHaveProperty('access_and_visibility')
      expect(snapshot).not.toHaveProperty('creator')
      expect(snapshot).not.toHaveProperty('participants')
    }
  },
)

test('does not infer eligibility through ACL or age restrictions', () => {
  expect(jobSnapshot(job).eligibility).toBe('unrestricted')
  expect(jobSnapshot({ ...job, access_and_visibility: { acl_protected: true } }).eligibility).toBe(
    'restricted',
  )
  expect(
    jobSnapshot({
      ...job,
      access_and_visibility: { acl_protected: false, restrictions: { minimum_age: 10 } },
    }).eligibility,
  ).toBe('restricted')
  expect(
    projectSnapshot(
      { ...project, configuration: {}, details: { ...project.details, expires: undefined } },
      9801,
    ),
  ).toMatchObject({ deadline: null, objective: null })
})

test('all resource definitions execute only through bounded collection and materialization', async () => {
  for (const resource of Object.values(resources)) {
    expect(resource.mode).toBe('bounded-collection')
    expect(resource).not.toHaveProperty('request')
    expect(resource).not.toHaveProperty('map')
    const execute = vi.fn().mockResolvedValue({
      data: { campaigns: [], freelance_jobs: [], objectives: [], projects: [] },
      validatedAt: now,
    })
    const subject =
      resource === resources.corporationJobsResource ||
      resource === resources.corporationProjectsResource
        ? { corporationId: 9801, kind: 'corporation', lifecycleId: id }
        : { characterId: 9001, kind: 'character', lifecycleId: id }
    // SAFETY: every declared resource receives its matching subject and operation capability fixture.
    const result = await resource.collect({
      authorizationGeneration: 4,
      capabilities: {
        persistence: { readActivityCheckpoint: vi.fn().mockResolvedValue(null) },
      },
      corporationId: 9801,
      ...(subject.kind === 'corporation' && {
        continuationAuthorityBinding: `v1:${'a'.repeat(64)}`,
      }),
      operations: new Proxy(
        {},
        { get: (_target, operationId) => (inputs: unknown) => execute(operationId, inputs) },
      ),
      organizationVersion: 7,
      requestBudget: 32,
      subject,
    } as never)
    expect(result.complete).toBe(true)
    expect(execute).toHaveBeenCalledOnce()
  }
})

test.each(['current', 'stale', 'unavailable'])(
  'provider reports %s independently and never reads external participation',
  async (status) => {
    const read = vi.fn().mockResolvedValue({
      authorizationGeneration: null,
      lastFailureClass: null,
      status,
      subjectLifecycleId: status === 'unavailable' ? undefined : id,
      validatedAt: status === 'unavailable' ? null : now,
    })
    const provider = organizationActivityProvider({
      collectionStatus: { read },
      persistence: { readActivitySnapshots: vi.fn().mockResolvedValue([]) },
    } as never)
    const result = await provider({
      characters: [
        { characterId: 9001, corporationId: 9801, membership: 'managed' },
        { characterId: 9002, corporationId: 9802, membership: 'approved-external' },
      ],
      organizationVersion: 7,
    } as never)
    expect(result.freshness.state).toBe(status)
    expect(
      read.mock.calls.some(
        ([, subject]) => subject.characterId === 9002 || subject.corporationId === 9802,
      ),
    ).toBe(false)
  },
)
