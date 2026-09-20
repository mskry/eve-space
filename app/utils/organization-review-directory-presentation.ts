import type {
  PlatformReviewerDirectoryAuditState,
  PlatformReviewerDirectoryComplianceState,
  PlatformReviewerDirectoryRow,
} from '@eve-space/platform-module-contract/reviewer-directory'
import { organizationComplianceLabels } from './organization-presentation'

const auditStateLabels = {
  'not-enabled': 'Not enabled',
  'authorization-required': 'Authorization required',
  unavailable: 'Unavailable',
  'never-collected': 'Never collected',
  stale: 'Stale',
  current: 'Current',
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
  if (timestamp === null) return { dateTime: null, compactLabel: 'Not recorded', exactLabel: null }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime()))
    return { dateTime: null, compactLabel: 'Unavailable', exactLabel: null }
  const timeZoneOptions = options.timeZone === undefined ? {} : { timeZone: options.timeZone }
  return {
    dateTime: timestamp,
    compactLabel: new Intl.DateTimeFormat(options.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...timeZoneOptions,
    }).format(date),
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
  if (block.blocked) return { state: 'blocked', label: 'Access blocked' } as const
  return { state: complianceState, label: organizationComplianceLabels[complianceState] }
}

export function organizationReviewDirectoryGroupOverflow(
  groups: PlatformReviewerDirectoryRow['groups'],
  visibleLimit = 2,
) {
  const boundedVisibleLimit =
    Number.isSafeInteger(visibleLimit) && visibleLimit > 0 ? visibleLimit : 0
  const visibleGroups = groups.slice(0, boundedVisibleLimit)
  return { visibleGroups, remainingCount: groups.length - visibleGroups.length }
}
