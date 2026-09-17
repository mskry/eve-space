import { PlatformModuleHttpError } from '@eve-space/platform-module-server'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class ReviewerAccountSearchInputError extends TypeError {}
  return {
    ReviewerAccountSearchInputError,
    searchManagedOrganizationAccounts: vi.fn(),
  }
})

vi.mock('../../src/organization/reviewer-account-search.js', () => ({
  ReviewerAccountSearchInputError: mocks.ReviewerAccountSearchInputError,
  searchManagedOrganizationAccounts: mocks.searchManagedOrganizationAccounts,
}))

import { createPlatformReviewerAccountSearch } from '../../src/platform/reviewer-search-capabilities.js'

beforeEach(() => vi.clearAllMocks())

test('translates invalid authenticated cursors into the typed validation response', async () => {
  mocks.searchManagedOrganizationAccounts.mockRejectedValueOnce(
    new mocks.ReviewerAccountSearchInputError(),
  )

  const failure = await createPlatformReviewerAccountSearch(7)
    .search({ cursor: 'valid-looking-but-unauthenticated' })
    .catch((error: unknown) => error)

  expect(failure).toBeInstanceOf(PlatformModuleHttpError)
  expect(failure).toMatchObject({
    status: 400,
    body: {
      code: 'INVALID_REVIEWER_SEARCH_INPUT',
      message: 'Invalid reviewer account search input.',
    },
  })
})

test('does not relabel unexpected reviewer search failures as validation errors', async () => {
  const unexpected = new Error('Database unavailable')
  mocks.searchManagedOrganizationAccounts.mockRejectedValueOnce(unexpected)

  await expect(createPlatformReviewerAccountSearch(7).search({})).rejects.toBe(unexpected)
})
