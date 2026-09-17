import type { PlatformReviewerAccountSearch } from '@eve-space/platform-module-contract/server'
import { platformModuleError } from '@eve-space/platform-module-server'
import {
  ReviewerAccountSearchInputError,
  searchManagedOrganizationAccounts,
} from '../organization/reviewer-account-search.js'

export function createPlatformReviewerAccountSearch(
  organizationVersion: number,
): PlatformReviewerAccountSearch {
  return {
    async search(filters) {
      try {
        return await searchManagedOrganizationAccounts({ organizationVersion, filters })
      } catch (error) {
        if (error instanceof ReviewerAccountSearchInputError)
          throw platformModuleError(400, {
            code: 'INVALID_REVIEWER_SEARCH_INPUT',
            message: 'Invalid reviewer account search input.',
          })
        throw error
      }
    },
  }
}
