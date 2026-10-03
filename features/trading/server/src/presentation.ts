import type { PlatformInventoryView } from '@eve-space/platform-module-contract/inventory'
import type { PlatformGraphQLReadInput } from '@eve-space/platform-module-contract/graphql'
import { z } from 'zod'

const pageSchema = z.object({ rows: z.array(z.unknown()).max(100) })

export const projectRows = (parent: PlatformGraphQLReadInput['parent']) =>
  pageSchema.parse(parent).rows

export const presentView = (view: PlatformInventoryView) => ({
  ...view,
  coverageCounts: {
    includedCurrent: view.coverageCounts['included-current'],
    includedStale: view.coverageCounts['included-stale'],
    authorizationRequired: view.coverageCounts['authorization-required'],
    neverCollected: view.coverageCounts['never-collected'],
    unavailable: view.coverageCounts.unavailable,
    incomplete: view.coverageCounts.incomplete,
    beyondRetention: view.coverageCounts['beyond-retention'],
    conflictingSource: view.coverageCounts['conflicting-source'],
  },
})
