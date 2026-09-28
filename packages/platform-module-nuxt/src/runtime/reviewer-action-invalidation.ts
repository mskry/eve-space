import { inject, provide, type InjectionKey } from 'vue'

export type PlatformReviewerActionInvalidation = () => Promise<void>

const reviewerActionInvalidationKey: InjectionKey<PlatformReviewerActionInvalidation> = Symbol(
  'platform-reviewer-action-invalidation',
)

export const providePlatformReviewerActionInvalidation = (
  invalidate: PlatformReviewerActionInvalidation,
) => provide(reviewerActionInvalidationKey, invalidate)

export const usePlatformReviewerActionInvalidation = () => inject(reviewerActionInvalidationKey)
