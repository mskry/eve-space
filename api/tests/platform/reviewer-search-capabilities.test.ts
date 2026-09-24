import { PlatformModuleHttpError } from '@eve-space/platform-module-server'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class ReviewerAccountSearchInputError extends TypeError {}
  return {
    ReviewerAccountSearchInputError,
    createSummaryReads: vi.fn(),
    resolveOrganizationReviewerTarget: vi.fn(),
    searchManagedOrganizationAccounts: vi.fn(),
  }
})

vi.mock('../../src/organization/reviewer-account-search.js', () => ({
  ReviewerAccountSearchInputError: mocks.ReviewerAccountSearchInputError,
  searchManagedOrganizationAccounts: mocks.searchManagedOrganizationAccounts,
}))
vi.mock('../../src/organization/reviewer-target.js', () => ({
  resolveOrganizationReviewerTarget: mocks.resolveOrganizationReviewerTarget,
}))
vi.mock('../../src/platform/module-reviewer-evidence-summary-capabilities.js', () => ({
  createPlatformReviewerEvidenceSummaryReads: mocks.createSummaryReads,
}))

import { createPlatformReviewerAccountSearch } from '../../src/platform/reviewer-search-capabilities.js'

beforeEach(() => vi.clearAllMocks())

test('translates invalid authenticated cursors into the typed validation response', async () => {
  mocks.searchManagedOrganizationAccounts.mockRejectedValueOnce(
    new mocks.ReviewerAccountSearchInputError(),
  )

  const failure = await createPlatformReviewerAccountSearch('member-audit', 7)
    .search({ cursor: 'valid-looking-but-unauthenticated' })
    .catch((error: unknown) => error)

  expect(failure).toBeInstanceOf(PlatformModuleHttpError)
  expect(failure).toMatchObject({
    body: {
      code: 'INVALID_REVIEWER_SEARCH_INPUT',
      message: 'Invalid reviewer account search input.',
    },
    status: 400,
  })
})

test('does not relabel unexpected reviewer search failures as validation errors', async () => {
  const unexpected = new Error('Database unavailable')
  mocks.searchManagedOrganizationAccounts.mockRejectedValueOnce(unexpected)

  await expect(createPlatformReviewerAccountSearch('member-audit', 7).search({})).rejects.toBe(
    unexpected,
  )
})

test('adds safe evidence summaries only after resolving each current search target', async () => {
  const item = {
    account: {
      mainCharacter: { characterId: 90_000_001, name: 'Pilot' },
      userId: '00000000-0000-4000-8000-000000000002',
    },
    block: { blocked: false },
    compliance: {
      accessValidUntil: null,
      evaluatedAt: '2026-09-18T10:00:00.000Z',
      evidenceAt: '2026-09-18T10:00:00.000Z',
      evidenceFreshness: 'fresh',
      reviewDeadline: null,
      state: 'compliant',
    },
    evidenceSections: [],
    managedAffiliation: {
      allianceId: null,
      characterId: 90_000_001,
      checkedAt: '2026-09-18T10:00:00.000Z',
      corporationId: 98_000_001,
      name: 'Pilot',
    },
    managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  } as const
  mocks.searchManagedOrganizationAccounts.mockResolvedValue({
    items: [item],
    nextCursor: null,
    organizationVersion: 7,
    status: 'available',
  })
  const target = { account: item.account }
  mocks.resolveOrganizationReviewerTarget.mockResolvedValue(target)
  const sections = [
    {
      resources: [{ resourceId: 'trained-skills', status: 'current', validatedAt: null }],
      sectionId: 'skills',
    },
  ]
  mocks.createSummaryReads.mockReturnValue({
    read: vi.fn().mockResolvedValue([{ characterId: 90_000_001, sections }]),
  })

  await expect(
    createPlatformReviewerAccountSearch('member-audit', 7).search({ limit: 25 }),
  ).resolves.toStrictEqual({
    items: [{ ...item, evidenceSections: sections }],
    nextCursor: null,
    organizationVersion: 7,
    status: 'available',
  })
  expect(mocks.resolveOrganizationReviewerTarget).toHaveBeenCalledWith({
    characterId: item.managedAffiliation.characterId,
    organizationVersion: 7,
    targetUserId: item.account.userId,
  })
  expect(mocks.createSummaryReads).toHaveBeenCalledWith({ moduleId: 'member-audit', target })
})
