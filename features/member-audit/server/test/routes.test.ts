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
    block: { blocked: false },
  } as const
  const app = new Hono<PlatformReviewerTargetRouteEnv>()
    .use('*', async (context, next) => {
      context.set('platform', {
        reviewerTarget: target,
        evidenceSummary: { read: vi.fn().mockResolvedValue([{ characterId: 90_000_001 }]) },
      } as never)
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
    groups: target.groups,
    block: { blocked: false },
    evidence: [{ characterId: 90_000_001 }],
  })
})

test('returns collection status and persisted evidence for each character section', async () => {
  const cases = [
    {
      route: memberSkillsRoutes,
      resources: ['trained-skills'],
      evidenceInput: undefined,
      body: {
        trainedSkills: { resourceId: 'trained-skills' },
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

test('validates and forwards bounded ordinary-group assignment and revocation commands', async () => {
  const assignOrdinaryGroup = vi.fn().mockResolvedValue({
    decision: 'assigned',
    groupId: '44444444-4444-4444-8444-444444444444',
    assignmentId: '55555555-5555-4555-8555-555555555555',
    expiresAt: '2026-10-01T00:00:00.000Z',
  })
  const revokeOrdinaryGroup = vi.fn().mockResolvedValue({
    decision: 'revoked',
    groupId: '44444444-4444-4444-8444-444444444444',
    assignmentId: '55555555-5555-4555-8555-555555555555',
    revokedAt: '2026-09-18T12:00:00.000Z',
  })
  const app = new Hono<
    PlatformReviewerTargetRouteEnv<readonly ['assign-ordinary-group', 'revoke-ordinary-group']>
  >()
    .use('*', async (context, next) => {
      context.set('platform', {
        reviewerTarget: characterTarget,
        organizationCommands: { assignOrdinaryGroup, revokeOrdinaryGroup },
      } as never)
      await next()
    })
    .route('/groups', memberGroupRoutes({} as never))

  const current = await app.request('/groups')
  expect(current.status).toBe(200)
  expect(await current.json()).toEqual({ groups: characterTarget.groups })

  const assigned = await app.request('/groups/44444444-4444-4444-8444-444444444444', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reason: '  Approved after review.  ',
      expiresAt: '2026-10-01T00:00:00.000Z',
    }),
  })
  expect(assigned.status).toBe(201)
  expect(assignOrdinaryGroup).toHaveBeenCalledWith({
    groupId: '44444444-4444-4444-8444-444444444444',
    reason: 'Approved after review.',
    expiresAt: '2026-10-01T00:00:00.000Z',
  })

  const revoked = await app.request(
    '/groups/44444444-4444-4444-8444-444444444444/assignments/55555555-5555-4555-8555-555555555555',
    {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Review access ended.' }),
    },
  )
  expect(revoked.status).toBe(200)
  expect(revokeOrdinaryGroup).toHaveBeenCalledWith({
    groupId: '44444444-4444-4444-8444-444444444444',
    assignmentId: '55555555-5555-4555-8555-555555555555',
    reason: 'Review access ended.',
  })

  const forged = await app.request('/groups/44444444-4444-4444-8444-444444444444', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Attempted target substitution.', targetUserId: 'other-user' }),
  })
  expect(forged.status).toBe(400)
})

test('validates and forwards bounded block and unblock commands', async () => {
  const blockMember = vi.fn().mockResolvedValue({
    decision: 'blocked',
    blockId: '66666666-6666-4666-8666-666666666666',
    blockedAt: '2026-09-18T12:00:00.000Z',
  })
  const unblockMember = vi.fn().mockResolvedValue({
    decision: 'unblocked',
    blockId: '66666666-6666-4666-8666-666666666666',
    unblockedAt: '2026-09-18T12:10:00.000Z',
  })
  const app = new Hono<
    PlatformReviewerTargetRouteEnv<readonly ['block-member', 'unblock-member']>
  >()
    .use('*', async (context, next) => {
      context.set('platform', {
        reviewerTarget: characterTarget,
        organizationCommands: { blockMember, unblockMember },
      } as never)
      await next()
    })
    .route('/block', memberBlockRoutes({} as never))

  const current = await app.request('/block')
  expect(current.status).toBe(200)
  expect(await current.json()).toEqual({ block: characterTarget.block })

  const blocked = await app.request('/block', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Immediate protected-access removal.' }),
  })
  expect(blocked.status).toBe(201)
  expect(blockMember).toHaveBeenCalledWith({ reason: 'Immediate protected-access removal.' })

  const unblocked = await app.request('/block', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Current compliance may be reevaluated.' }),
  })
  expect(unblocked.status).toBe(200)
  expect(unblockMember).toHaveBeenCalledWith({ reason: 'Current compliance may be reevaluated.' })
})
