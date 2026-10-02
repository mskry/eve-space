import type { PlatformAuthorizedOrganizationContext } from '@eve-space/platform-module-contract/server'
import type { PlatformInstalledOrganizationContributionAuthorization } from '@eve-space/platform-module-contract/installed'
import { sessionAdmissionDenial } from '../auth/read-admission.js'
import type { ReadAdmissionDenial } from '../auth/read-policy.js'
import type { SessionAccount } from '../auth/session-store.js'
import type { OrganizationSessionContext } from './access-policy.js'
import {
  authorizeOrganizationContribution,
  authorizeOrganizationReviewerContribution,
  type OrganizationContributionAuthorizationResult,
} from './module-authorization.js'

type OrganizationDenialReason = Extract<
  OrganizationContributionAuthorizationResult,
  { authorized: false }
>['reason']

export type OrganizationReadAdmission = (
  | ReadAdmissionDenial
  | {
      readonly admitted: true
      readonly organization: PlatformAuthorizedOrganizationContext
    }
) & { readonly reason?: OrganizationDenialReason }

const organizationDenial = (
  organization: OrganizationSessionContext | null,
  declaration: PlatformInstalledOrganizationContributionAuthorization,
  reason: OrganizationDenialReason,
  reviewer: boolean,
): ReadAdmissionDenial => {
  if (reason === 'blocked' || reason === 'compliance') {
    const blocked = reason === 'blocked'
    return {
      admitted: false,
      status: 403,
      body: {
        code: blocked ? 'ORGANIZATION_MEMBER_BLOCKED' : 'ORGANIZATION_COMPLIANCE_REQUIRED',
        message: blocked
          ? 'Organization access is blocked.'
          : 'Current organization compliance is required.',
        reviewDeadline: organization?.reviewDeadline?.toISOString() ?? null,
        state: organization?.state ?? 'pending',
      },
    }
  }
  if (reason === 'permission')
    return {
      admitted: false,
      status: 403,
      body: {
        code: 'ORGANIZATION_PERMISSION_REQUIRED',
        message: 'The required organization permission is not granted.',
      },
    }
  if (reviewer)
    return {
      admitted: false,
      status: 403,
      body: {
        code: 'ORGANIZATION_REVIEWER_REQUIRED',
        message: 'Organization reviewer authority is required.',
      },
    }
  if (declaration.audience === 'hr')
    return {
      admitted: false,
      status: 403,
      body: { code: 'ORGANIZATION_HR_REQUIRED', message: 'Organization HR authority is required.' },
    }
  return {
    admitted: false,
    status: 403,
    body: {
      code: 'ORGANIZATION_MANAGER_REQUIRED',
      message: 'Organization management is required.',
    },
  }
}

export const admitOrganizationRead = async (
  session: SessionAccount | null,
  organization: OrganizationSessionContext | null,
  declaration: PlatformInstalledOrganizationContributionAuthorization,
  reviewer = false,
): Promise<OrganizationReadAdmission> => {
  const denial = sessionAdmissionDenial(session)
  if (denial) return denial
  if (!organization) return organizationDenial(null, declaration, 'compliance', reviewer)
  const authorization = reviewer
    ? await authorizeOrganizationReviewerContribution(session!.userId, organization, declaration)
    : await authorizeOrganizationContribution(session!.userId, organization, declaration)
  if (!authorization.authorized)
    return {
      ...organizationDenial(organization, declaration, authorization.reason, reviewer),
      reason: authorization.reason,
    }
  return {
    admitted: true,
    organization: Object.freeze({
      ...authorization.context,
      ...(authorization.context.additionalRequiredPermissions && {
        additionalRequiredPermissions: Object.freeze([
          ...authorization.context.additionalRequiredPermissions,
        ]),
      }),
    }),
  }
}
