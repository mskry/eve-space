import { platformReviewerPanels } from '#build/eve-space-platform/reviewer-panels'

export function usePlatformReviewerPanels() {
  return {
    contributions: platformReviewerPanels,
    load(moduleId: string, contributionId: string) {
      const contribution = platformReviewerPanels.find(
        (candidate) =>
          candidate.moduleId === moduleId && candidate.contributionId === contributionId,
      )
      if (!contribution)
        throw new Error(`Reviewer panel ${moduleId}/${contributionId} is not installed`)
      return contribution.load()
    },
  }
}
