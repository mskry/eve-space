import type {
  PlatformReviewerSearchRouteEnv,
  PlatformReviewerTargetRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { Hono } from 'hono'
import { expect, test, vi } from 'vitest'
import {
  memberAssetsRoutes,
  memberMailRoutes,
  memberSearchRoutes,
  memberSkillsRoutes,
  memberSummaryRoutes,
  memberWalletRoutes,
} from '../src/routes.js'

const characterTarget = {
  organizationVersion: 4,
  managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
  selection: {
    kind: 'character' as const,
    characterId: 90_000_001,
    characterLifecycleId: '11111111-1111-4111-8111-111111111111',
  },
  account: {
    userId: '22222222-2222-4222-8222-222222222222',
    mainCharacter: { characterId: 90_000_001, name: 'Pilot' },
  },
  characters: [],
  compliance: {
    state: 'compliant' as const,
    evidenceFreshness: 'fresh' as const,
    evidenceAt: '2026-09-17T10:00:00Z',
    reviewDeadline: null,
    accessValidUntil: null,
    evaluatedAt: '2026-09-17T10:00:00Z',
  },
  groups: [],
  block: { blocked: false },
}

test('validates and forwards bounded reviewer search filters', async () => {
  const search = vi.fn().mockResolvedValue({
    status: 'available',
    items: [],
    nextCursor: null,
  })
  const app = new Hono<PlatformReviewerSearchRouteEnv>()
    .use('*', async (context, next) => {
      context.set('platform', { reviewerSearch: { search } } as never)
      await next()
    })
    .route('/', memberSearchRoutes({} as never))

  const response = await app.request(
    '/?query=Pilot&corporationId=98000001&complianceState=compliant&blocked=true&limit=50',
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ status: 'available', items: [], nextCursor: null })
  expect(search).toHaveBeenCalledWith({
    query: 'Pilot',
    corporationId: 98_000_001,
    complianceState: 'compliant',
    blocked: true,
    limit: 50,
  })
  search.mockClear()
  const invalidResponses = await Promise.all(
    [
      `/?query=${'x'.repeat(81)}`,
      '/?query=bad%0Aquery',
      `/?cursor=${'A'.repeat(513)}`,
      '/?cursor=invalid%2Bcursor',
      '/?limit=51',
    ].map((path) => app.request(path)),
  )
  expect(invalidResponses.map(({ status }) => status)).toEqual([400, 400, 400, 400, 400])
  expect(search).not.toHaveBeenCalled()
})

test('returns only the bounded reviewer target summary', async () => {
  const target = {
    organizationVersion: 4,
    managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
    selection: { kind: 'account' },
    account: {
      userId: '22222222-2222-4222-8222-222222222222',
      mainCharacter: { characterId: 90_000_001, name: 'Pilot' },
    },
    characters: [],
    compliance: {
      state: 'compliant',
      evidenceFreshness: 'fresh',
      evidenceAt: '2026-09-17T10:00:00Z',
      reviewDeadline: null,
      accessValidUntil: null,
      evaluatedAt: '2026-09-17T10:00:00Z',
    },
    groups: [],
    block: { blocked: false },
  } as const
  const app = new Hono<PlatformReviewerTargetRouteEnv>()
    .use('*', async (context, next) => {
      context.set('platform', { reviewerTarget: target } as never)
      await next()
    })
    .route('/', memberSummaryRoutes({} as never))

  const response = await app.request('/')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    organizationVersion: 4,
    managedMemberLifecycleId: target.managedMemberLifecycleId,
    account: target.account,
    characters: [],
    compliance: target.compliance,
    groups: [],
    block: { blocked: false },
  })
})

test('returns collection status and persisted evidence for each character section', async () => {
  const cases = [
    {
      route: memberSkillsRoutes,
      resources: ['trained-skills', 'skill-queue'],
      evidenceInput: undefined,
      body: {
        trainedSkills: { resourceId: 'trained-skills' },
        skillQueue: { resourceId: 'skill-queue' },
      },
    },
    {
      route: memberAssetsRoutes,
      resources: ['assets'],
      evidenceInput: undefined,
      body: { status: { resourceId: 'assets' } },
    },
    {
      route: memberWalletRoutes,
      resources: ['wallet-balance', 'wallet-journal', 'wallet-transactions'],
      evidenceInput: { limit: 500 },
      body: {
        balance: { resourceId: 'wallet-balance' },
        journal: { resourceId: 'wallet-journal' },
        transactions: { resourceId: 'wallet-transactions' },
      },
    },
    {
      route: memberMailRoutes,
      resources: ['mail-headers', 'mail-details'],
      evidenceInput: { limit: 500 },
      body: {
        headers: { resourceId: 'mail-headers' },
        details: { resourceId: 'mail-details' },
      },
    },
  ] as const

  for (const testCase of cases) {
    const readStatus = vi.fn((resourceId: string) => ({ resourceId }))
    const readEvidence = vi.fn().mockResolvedValue({ records: [] })
    const app = new Hono<PlatformReviewerTargetRouteEnv>()
      .use('*', async (context, next) => {
        context.set('platform', {
          reviewerTarget: characterTarget,
          collectionStatus: { read: readStatus },
          evidence: { read: readEvidence },
        } as never)
        await next()
      })
      .route('/', testCase.route({} as never))

    const response = await app.request('/')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...testCase.body, evidence: { records: [] } })
    expect(readStatus.mock.calls).toEqual(
      testCase.resources.map((resourceId) => [resourceId, characterTarget.selection.characterId]),
    )
    expect(readEvidence).toHaveBeenCalledWith(testCase.evidenceInput)
  }
})

test('rejects character evidence routes without a character target or evidence capability', async () => {
  const accountTarget = { ...characterTarget, selection: { kind: 'account' as const } }
  const accountApp = new Hono<PlatformReviewerTargetRouteEnv>()
    .use('*', async (context, next) => {
      context.set('platform', { reviewerTarget: accountTarget } as never)
      await next()
    })
    .route('/', memberAssetsRoutes({} as never))
  expect((await accountApp.request('/')).status).toBe(500)

  const evidenceApp = new Hono<PlatformReviewerTargetRouteEnv>()
    .use('*', async (context, next) => {
      context.set('platform', {
        reviewerTarget: characterTarget,
        collectionStatus: { read: vi.fn().mockResolvedValue({}) },
      } as never)
      await next()
    })
    .route('/', memberAssetsRoutes({} as never))
  expect((await evidenceApp.request('/')).status).toBe(500)
})
