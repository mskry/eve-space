import type { PlatformReviewerAccountSearch } from '@eve-space/platform-module-contract/server'
import { platformModuleError } from '@eve-space/platform-module-server'
import {
  ReviewerAccountSearchInputError,
  searchManagedOrganizationAccounts,
} from '../organization/reviewer-account-search.js'
import { resolveOrganizationReviewerTarget } from '../organization/reviewer-target.js'
import { createPlatformReviewerEvidenceSummaryReads } from './module-reviewer-evidence-summary-capabilities.js'

const summaryConcurrency = 4

export function createPlatformReviewerAccountSearch(
  moduleId: string,
  organizationVersion: number,
): PlatformReviewerAccountSearch {
  return {
    async search(filters) {
      try {
        const page = await searchManagedOrganizationAccounts({ organizationVersion, filters })
        if (page.status === 'unavailable' || page.items.length === 0) return page
        const items = await mapWithConcurrency(page.items, summaryConcurrency, async (item) => {
          const target = await resolveOrganizationReviewerTarget({
            organizationVersion,
            targetUserId: item.account.userId,
            characterId: item.managedAffiliation.characterId,
          })
          if (!target) return null
          const [summary] = await createPlatformReviewerEvidenceSummaryReads({
            moduleId,
            target,
          }).read()
          return { ...item, evidenceSections: summary?.sections ?? [] }
        })
        return { ...page, items: items.filter((item) => item !== null) }
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

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
) {
  const outputs: Output[] = []
  async function run(index: number): Promise<void> {
    if (index >= inputs.length) return
    outputs[index] = await operation(inputs[index]!)
    return run(index + concurrency)
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, (_, index) => run(index)),
  )
  return outputs
}
