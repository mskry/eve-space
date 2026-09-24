import type { PlatformReviewerTargetRouteEnv } from '@eve-space/platform-module-contract/server'
import { Hono } from 'hono'
import { expect, test, vi } from 'vitest'
import {
  memberAssetsRoutes,
  memberBlockRoutes,
  memberGroupRoutes,
  memberMailRoutes,
  memberSkillsRoutes,
  memberSummaryRoutes,
  memberWalletRoutes,
} from '../src/routes.js'

const characterTarget = {
  account: {
    mainCharacter: { characterId: 90_000_001, name: 'Pilot' },
    userId: '22222222-2222-4222-8222-222222222222',
  },
  block: { blocked: false },
  characters: [],
  compliance: {
    accessValidUntil: null,
    evaluatedAt: '2026-09-17T10:00:00Z',
    evidenceAt: '2026-09-17T10:00:00Z',
    evidenceFreshness: 'fresh' as const,
    reviewDeadline: null,
    state: 'compliant' as const,
  },
  groups: [],
  managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
  organizationVersion: 4,
  selection: {
    characterId: 90_000_001,
    characterLifecycleId: '11111111-1111-4111-8111-111111111111',
    kind: 'character' as const,
  },
}

test('returns only the bounded reviewer target summary', async () => {
  const target = {
    account: {
      mainCharacter: { characterId: 90_000_001, name: 'Pilot' },
      userId: '22222222-2222-4222-8222-222222222222',
    },
    block: { blocked: false },
    characters: [],
    compliance: {
      accessValidUntil: null,
      evaluatedAt: '2026-09-17T10:00:00Z',
      evidenceAt: '2026-09-17T10:00:00Z',
      evidenceFreshness: 'fresh',
      reviewDeadline: null,
      state: 'compliant',
    },
    groups: [
      {
        groupId: '44444444-4444-4444-8444-444444444444',
        assignmentId: '55555555-5555-4555-8555-555555555555',
        name: 'Registration compliant',
        restricted: false,
        managementMode: 'compliance',
        readOnly: true,
        assignedAt: '2026-09-17T10:00:00Z',
        expiresAt: null,
      },
    ],
    managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
    organizationVersion: 4,
    selection: { kind: 'account' },
  } as const
  const app = new Hono<PlatformReviewerTargetRouteEnv>()
    .use('*', async (context, next) => {
      context.set('platform', {
        evidenceSummary: { read: vi.fn().mockResolvedValue([{ characterId: 90_000_001 }]) },
        reviewerTarget: target,
      } as never)
      await next()
    })
    .route('/', memberSummaryRoutes({} as never))

  const response = await app.request('/')
  expect(response.status).toBe(200)
  expect(await response.json()).toStrictEqual({
    account: target.account,
    block: { blocked: false },
    characters: [],
    compliance: target.compliance,
    evidence: [{ characterId: 90_000_001 }],
    groups: target.groups,
    managedMemberLifecycleId: target.managedMemberLifecycleId,
    organizationVersion: 4,
  })
})

test('returns collection status and persisted evidence for each character section', async () => {
  const cases = [
    {
      body: {
        trainedSkills: { resourceId: 'trained-skills' },
      },
      evidenceInput: undefined,
      resources: ['trained-skills'],
      route: memberSkillsRoutes,
    },
    {
      body: { status: { resourceId: 'assets' } },
      evidenceInput: undefined,
      resources: ['assets'],
      route: memberAssetsRoutes,
    },
    {
      body: {
        balance: { resourceId: 'wallet-balance' },
        journal: { resourceId: 'wallet-journal' },
        transactions: { resourceId: 'wallet-transactions' },
      },
      evidenceInput: { limit: 500 },
      resources: ['wallet-balance', 'wallet-journal', 'wallet-transactions'],
      route: memberWalletRoutes,
    },
    {
      body: {
        details: { resourceId: 'mail-details' },
        headers: { resourceId: 'mail-headers' },
      },
      evidenceInput: { limit: 500 },
      resources: ['mail-headers', 'mail-details'],
      route: memberMailRoutes,
    },
  ] as const

  for (const testCase of cases) {
    const readStatus = vi.fn((resourceId: string) => ({ resourceId }))
    const readEvidence = vi.fn().mockResolvedValue({ records: [] })
    const app = new Hono<PlatformReviewerTargetRouteEnv>()
      .use('*', async (context, next) => {
        context.set('platform', {
          collectionStatus: { read: readStatus },
          evidence: { read: readEvidence },
          reviewerTarget: characterTarget,
        } as never)
        await next()
      })
      .route('/', testCase.route({} as never))

    const response = await app.request('/')

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual({ ...testCase.body, evidence: { records: [] } })
    expect(readStatus.mock.calls).toStrictEqual(
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
        collectionStatus: { read: vi.fn().mockResolvedValue({}) },
        reviewerTarget: characterTarget,
      } as never)
      await next()
    })
    .route('/', memberAssetsRoutes({} as never))
  expect((await evidenceApp.request('/')).status).toBe(500)
})

test('validates and forwards bounded ordinary-group assignment and revocation commands', async () => {
  const assignOrdinaryGroup = vi.fn().mockResolvedValue({
    assignmentId: '55555555-5555-4555-8555-555555555555',
    decision: 'assigned',
    expiresAt: '2026-10-01T00:00:00.000Z',
    groupId: '44444444-4444-4444-8444-444444444444',
  })
  const revokeOrdinaryGroup = vi.fn().mockResolvedValue({
    assignmentId: '55555555-5555-4555-8555-555555555555',
    decision: 'revoked',
    groupId: '44444444-4444-4444-8444-444444444444',
    revokedAt: '2026-09-18T12:00:00.000Z',
  })
  const app = new Hono<
    PlatformReviewerTargetRouteEnv<readonly ['assign-ordinary-group', 'revoke-ordinary-group']>
  >()
    .use('*', async (context, next) => {
      context.set('platform', {
        organizationCommands: { assignOrdinaryGroup, revokeOrdinaryGroup },
        reviewerTarget: characterTarget,
      } as never)
      await next()
    })
    .route('/groups', memberGroupRoutes({} as never))

  const current = await app.request('/groups')
  expect(current.status).toBe(200)
  expect(await current.json()).toStrictEqual({ groups: characterTarget.groups })

  const assigned = await app.request('/groups/44444444-4444-4444-8444-444444444444', {
    body: JSON.stringify({
      reason: '  Approved after review.  ',
      expiresAt: '2026-10-01T00:00:00.000Z',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  expect(assigned.status).toBe(201)
  expect(assignOrdinaryGroup).toHaveBeenCalledWith({
    expiresAt: '2026-10-01T00:00:00.000Z',
    groupId: '44444444-4444-4444-8444-444444444444',
    reason: 'Approved after review.',
  })

  const revoked = await app.request(
    '/groups/44444444-4444-4444-8444-444444444444/assignments/55555555-5555-4555-8555-555555555555',
    {
      body: JSON.stringify({ reason: 'Review access ended.' }),
      headers: { 'content-type': 'application/json' },
      method: 'DELETE',
    },
  )
  expect(revoked.status).toBe(200)
  expect(revokeOrdinaryGroup).toHaveBeenCalledWith({
    assignmentId: '55555555-5555-4555-8555-555555555555',
    groupId: '44444444-4444-4444-8444-444444444444',
    reason: 'Review access ended.',
  })

  const forged = await app.request('/groups/44444444-4444-4444-8444-444444444444', {
    body: JSON.stringify({ reason: 'Attempted target substitution.', targetUserId: 'other-user' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  expect(forged.status).toBe(400)
})

test('validates and forwards bounded block and unblock commands', async () => {
  const blockMember = vi.fn().mockResolvedValue({
    blockId: '66666666-6666-4666-8666-666666666666',
    blockedAt: '2026-09-18T12:00:00.000Z',
    decision: 'blocked',
  })
  const unblockMember = vi.fn().mockResolvedValue({
    blockId: '66666666-6666-4666-8666-666666666666',
    decision: 'unblocked',
    unblockedAt: '2026-09-18T12:10:00.000Z',
  })
  const app = new Hono<
    PlatformReviewerTargetRouteEnv<readonly ['block-member', 'unblock-member']>
  >()
    .use('*', async (context, next) => {
      context.set('platform', {
        organizationCommands: { blockMember, unblockMember },
        reviewerTarget: characterTarget,
      } as never)
      await next()
    })
    .route('/block', memberBlockRoutes({} as never))

  const current = await app.request('/block')
  expect(current.status).toBe(200)
  expect(await current.json()).toStrictEqual({ block: characterTarget.block })

  const blocked = await app.request('/block', {
    body: JSON.stringify({ reason: 'Immediate protected-access removal.' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  expect(blocked.status).toBe(201)
  expect(blockMember).toHaveBeenCalledWith({ reason: 'Immediate protected-access removal.' })

  const unblocked = await app.request('/block', {
    body: JSON.stringify({ reason: 'Current compliance may be reevaluated.' }),
    headers: { 'content-type': 'application/json' },
    method: 'DELETE',
  })
  expect(unblocked.status).toBe(200)
  expect(unblockMember).toHaveBeenCalledWith({ reason: 'Current compliance may be reevaluated.' })
})
