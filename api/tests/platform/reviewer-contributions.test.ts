import type { PlatformInstalledReviewerContributionDescriptor } from '@eve-space/platform-module-contract/installed'
import { describe, expect, test } from 'vitest'
import {
  listAvailableReviewerContributions,
  requireInstalledReviewerContribution,
} from '../../src/platform/reviewer-contributions.js'

const alpha = contribution('alpha', 'overview', 'overview')
const beta = contribution('beta', 'details', 'details')

describe('installed reviewer contributions', () => {
  test('requires the complete immutable generated descriptor identity', () => {
    expect(requireInstalledReviewerContribution(alpha, [alpha, beta])).toBe(alpha)
    expect(() =>
      requireInstalledReviewerContribution({ ...alpha, routePath: '/api/modules/forged' }, [
        alpha,
        beta,
      ]),
    ).toThrow('Reviewer contribution descriptor is not installed')
  })

  test('keeps module and section availability independent', async () => {
    await expect(
      listAvailableReviewerContributions([alpha, beta], async () => ({
        enabledModuleIds: ['alpha', 'beta'],
        enabledSections: [
          {
            moduleId: 'alpha',
            sectionId: 'overview',
            kind: 'workspace',
            disclosureVersion: 0,
            activationVersion: 1,
          },
        ],
        shellNavigationOrder: { dashboard: [], character: [] },
      })),
    ).resolves.toEqual([alpha])
  })
})

function contribution(
  moduleId: string,
  contributionId: string,
  sectionId: string,
): PlatformInstalledReviewerContributionDescriptor {
  return {
    publisherPackage: `@example/${moduleId}-manifest`,
    moduleId,
    contributionId,
    routeId: `${moduleId}-route`,
    routePath: `/api/modules/${moduleId}/accounts/:userId`,
    sectionId,
    audience: 'hr',
    requiredPermission: `${moduleId}.review`,
    target: 'managed-organization-account',
    panelPackage: `@example/${moduleId}-nuxt`,
    panelExport: `./reviewer/${contributionId}`,
    label: `${moduleId} ${contributionId}`,
    description: `Review ${moduleId}.`,
    icon: 'overview',
    order: moduleId === 'alpha' ? 10 : 20,
  }
}
