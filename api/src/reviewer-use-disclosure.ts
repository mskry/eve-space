import {
  isPlatformContributionId,
  isPlatformModuleId,
} from '@eve-space/platform-module-contract/identifiers'

const maxReviewerUseDisclosures = 64

export interface ReviewerUseDisclosure {
  readonly moduleId: string
  readonly sectionId: string
  readonly disclosureVersion: number
}

export interface ReviewerUseDisclosurePresentation extends ReviewerUseDisclosure {
  readonly title: string
  readonly purpose: string
  readonly fields: string
  readonly retention: string
}

const disclosurePresentationBySection = {
  assets: {
    fields: 'Asset types, quantities, locations, and eligible custom names.',
    purpose: 'Authorized organization reviewers may verify organization policy and readiness.',
    retention: 'Only the current complete asset snapshot is retained.',
    title: 'Assets',
  },
  mail: {
    fields:
      'Mail headers, parties, and sanitized plain-text message content. Raw markup is not retained.',
    purpose: 'Authorized organization reviewers may inspect mail evidence for compliance review.',
    retention: 'Mail evidence is retained for no more than 90 days.',
    title: 'Mail',
  },
  skills: {
    fields: 'Trained skills, skill levels, skill points, and queued training entries.',
    purpose: 'Authorized organization reviewers may verify training and skill readiness.',
    retention: 'Only the current complete skills and training-queue snapshots are retained.',
    title: 'Skills and training queue',
  },
  wallet: {
    fields: 'Wallet balance plus bounded journal and transaction records.',
    purpose:
      'Authorized organization reviewers may inspect financial evidence for compliance review.',
    retention:
      'The current balance and up to 90 days of journal and transaction records are retained.',
    title: 'Wallet',
  },
} as const

export function parseReviewerUseDisclosures(value: unknown): readonly ReviewerUseDisclosure[] {
  if (!Array.isArray(value) || value.length > maxReviewerUseDisclosures) {
    throw new Error('Stored OAuth state has invalid reviewer-use disclosures')
  }

  const seen = new Set<string>()
  const disclosures = value.map((candidate) => {
    if (!isReviewerUseDisclosure(candidate)) {
      throw new Error('Stored OAuth state has invalid reviewer-use disclosures')
    }
    const key = `${candidate.moduleId}/${candidate.sectionId}`
    if (seen.has(key)) {
      throw new Error('Stored OAuth state has duplicate reviewer-use disclosures')
    }
    seen.add(key)
    return candidate
  })
  return disclosures.toSorted(compareReviewerUseDisclosures)
}

export function presentReviewerUseDisclosures(
  disclosures: readonly ReviewerUseDisclosure[],
): readonly ReviewerUseDisclosurePresentation[] {
  return disclosures.map((disclosure) => {
    const presentation =
      disclosurePresentationBySection[
        disclosure.sectionId as keyof typeof disclosurePresentationBySection
      ]
    if (!presentation) {
      throw new Error(`Sensitive section ${disclosure.sectionId} has no reviewer-use disclosure`)
    }
    return { ...disclosure, ...presentation }
  })
}

function isReviewerUseDisclosure(value: unknown): value is ReviewerUseDisclosure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).length === 3 &&
    typeof record.moduleId === 'string' &&
    isPlatformModuleId(record.moduleId) &&
    typeof record.sectionId === 'string' &&
    isPlatformContributionId(record.sectionId) &&
    Number.isSafeInteger(record.disclosureVersion) &&
    Number(record.disclosureVersion) > 0
  )
}

function compareReviewerUseDisclosures(left: ReviewerUseDisclosure, right: ReviewerUseDisclosure) {
  return (
    left.moduleId.localeCompare(right.moduleId) || left.sectionId.localeCompare(right.sectionId)
  )
}
