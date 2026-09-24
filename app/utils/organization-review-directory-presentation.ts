import type {
  PlatformReviewerDirectoryAuditState,
  PlatformReviewerDirectoryComplianceState,
  PlatformReviewerDirectoryRow,
} from '@eve-space/platform-module-contract/reviewer-directory'
import { organizationComplianceLabels } from './organization-presentation'

const auditStateLabels = {
  'authorization-required': 'Authorization required',
  current: 'Current',
  'never-collected': 'Never collected',
  'not-enabled': 'Not enabled',
  stale: 'Stale',
  unavailable: 'Unavailable',
} as const satisfies Record<PlatformReviewerDirectoryAuditState, string>

export interface OrganizationReviewDirectoryFormattedDate {
  readonly dateTime: string | null
  readonly compactLabel: string
  readonly exactLabel: string | null
}

export function formatOrganizationReviewDirectoryDate(
  timestamp: string | null,
  options: { readonly locale?: Intl.LocalesArgument; readonly timeZone?: string } = {},
): OrganizationReviewDirectoryFormattedDate {
  if (timestamp === null) {
    return { compactLabel: 'Not recorded', dateTime: null, exactLabel: null }
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return { compactLabel: 'Unavailable', dateTime: null, exactLabel: null }
  }
  const timeZoneOptions = options.timeZone === undefined ? {} : { timeZone: options.timeZone }
  return {
    compactLabel: new Intl.DateTimeFormat(options.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...timeZoneOptions,
    }).format(date),
    dateTime: timestamp,
    exactLabel: new Intl.DateTimeFormat(options.locale, {
      dateStyle: 'full',
      timeStyle: 'long',
      ...timeZoneOptions,
    }).format(date),
  }
}

export function organizationReviewDirectoryAuditStateLabel(
  state: PlatformReviewerDirectoryAuditState,
) {
  return auditStateLabels[state]
}

export function organizationReviewDirectoryAccess(
  complianceState: PlatformReviewerDirectoryComplianceState,
  block: PlatformReviewerDirectoryRow['block'],
) {
  if (block.blocked) {
    return { label: 'Access blocked', state: 'blocked' } as const
  }
  return { label: organizationComplianceLabels[complianceState], state: complianceState }
}

export function organizationReviewDirectoryGroupOverflow(
  groups: PlatformReviewerDirectoryRow['groups'],
  visibleLimit = 2,
) {
  const boundedVisibleLimit =
    Number.isSafeInteger(visibleLimit) && visibleLimit > 0 ? visibleLimit : 0
  const visibleGroups = groups.slice(0, boundedVisibleLimit)
  return { remainingCount: groups.length - visibleGroups.length, visibleGroups }
}
