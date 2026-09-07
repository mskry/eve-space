import { expect, test, vi } from 'vitest'
import * as operations from '../src/operations.js'
import * as resources from '../src/resources.js'
import { mapCollectionResponse } from '../src/collection-response.js'
import { jobSnapshot, projectSnapshot } from '../src/snapshot.js'
import { organizationActivityProvider } from '../src/provider.js'

const id = '11111111-1111-4111-8111-111111111111'
const now = '2026-09-07T10:00:00.000Z'
const summary = {
  id,
  name: 'Supplies',
  state: 'Active' as const,
  last_modified: now,
  progress: { current: 1, desired: 10 },
  reward: { initial: 100, remaining: 90 },
}
const campaign = { id, progress: 20, state: 'Active', last_modified: now }
const objective = { ...campaign, participants: { committed: 1, contributors: 1, total: 1 } }
const participation = {
  id,
  campaign_id: id,
  contributed: 1,
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
  configuration: { method: 'delivery', parameters: {}, version: 1 },
  access_and_visibility: { acl_protected: false },
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
    { objectives: [objective], cursor: { after: 'after' } },
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
    { contributed: 1, state: 'Committed', id, last_modified: now },
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
    { corporation_id: 9801, project_id: id, character_id: 9001 },
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

test.each(fixtures.map(([operation, name, fixture, path]) => ({ operation, name, fixture, path })))(
  'validates SDK fixtures for $name and maps intentional DTOs',
  ({ operation, name, fixture, path }) => {
    const response = operation.descriptor.transport.successResponses.find(
      (item) => item.status === 200,
    )
    expect(response?.body).toBe('json')
    if (!response || response.body !== 'json') throw new Error('Missing SDK response schema')
    const data = response.schema.parse(fixture)
    expect(() => response.schema.parse({})).toThrow(/Invalid input/)
    expect(() =>
      operation.descriptor.requestSchema.parse(Object.keys(path).length ? { path } : {}),
    ).not.toThrow()
    const mapped = mapCollectionResponse(
      { operation: name, path, replace: true, snapshot: projectSnapshot(project, 9801) },
      data,
      'corporation-projects',
    )
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
  ).toMatchObject({ objective: null, deadline: null })
})

test('all resource definitions execute only through bounded collection and materialization', async () => {
  for (const resource of Object.values(resources)) {
    expect(resource.request()).toEqual({})
    expect(() => resource.map()).toThrow('bounded collection')
    const execute = vi.fn().mockResolvedValue({
      data: { campaigns: [], projects: [], freelance_jobs: [], objectives: [] },
      validatedAt: now,
    })
    const result = await resource.collect({
      subject: { kind: 'character', characterId: 9001, lifecycleId: id },
      corporationId: 9801,
      organizationVersion: 7,
      authorizationGeneration: 4,
      requestBudget: 32,
      execute,
      capabilities: {
        persistence: {
          transaction: (fn: (tx: { query: () => Promise<unknown[]> }) => unknown) =>
            fn({ query: async () => [] }),
        },
      },
    } as never)
    expect(result.complete).toBe(true)
    expect(execute).toHaveBeenCalledOnce()
  }
})

test.each(['current', 'stale', 'unavailable'])(
  'provider reports %s independently and never reads external participation',
  async (status) => {
    const read = vi.fn().mockResolvedValue({
      status,
      subjectLifecycleId: status === 'unavailable' ? undefined : id,
      authorizationGeneration: null,
      validatedAt: status === 'unavailable' ? null : now,
      lastFailureClass: null,
    })
    const provider = organizationActivityProvider({
      collectionStatus: { read },
      persistence: {
        transaction: (fn: (tx: { query: () => Promise<unknown[]> }) => unknown) =>
          fn({ query: async () => [] }),
      },
    } as never)
    const result = await provider({
      organizationVersion: 7,
      characters: [
        { characterId: 9001, corporationId: 9801, membership: 'managed' },
        { characterId: 9002, corporationId: 9802, membership: 'approved-external' },
      ],
    } as never)
    expect(result.freshness.state).toBe(status)
    expect(
      read.mock.calls.some(
        ([, subject]) => subject.characterId === 9002 || subject.corporationId === 9802,
      ),
    ).toBe(false)
  },
)
