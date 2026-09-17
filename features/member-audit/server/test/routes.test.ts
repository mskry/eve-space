import type {
  PlatformReviewerSearchRouteEnv,
  PlatformReviewerTargetRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { Hono } from 'hono'
import { expect, test, vi } from 'vitest'
import { memberSearchRoutes, memberSummaryRoutes } from '../src/routes.js'

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
