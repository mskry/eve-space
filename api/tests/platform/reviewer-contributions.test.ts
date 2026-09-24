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
            activationVersion: 1,
            disclosureVersion: 0,
            kind: 'workspace',
            moduleId: 'alpha',
            sectionId: 'overview',
          },
        ],
        shellNavigationOrder: { character: [], dashboard: [] },
      })),
    ).resolves.toStrictEqual([alpha])
  })
})

function contribution(
  moduleId: string,
  contributionId: string,
  sectionId: string,
): PlatformInstalledReviewerContributionDescriptor {
  return {
    audience: 'hr',
    contributionId,
    description: `Review ${moduleId}.`,
    icon: 'overview',
    label: `${moduleId} ${contributionId}`,
    moduleId,
    order: moduleId === 'alpha' ? 10 : 20,
    panelExport: `./reviewer/${contributionId}`,
    panelPackage: `@example/${moduleId}-nuxt`,
    publisherPackage: `@example/${moduleId}-manifest`,
    requiredPermission: `${moduleId}.review`,
    routeId: `${moduleId}-route`,
    routePath: `/api/modules/${moduleId}/accounts/:userId`,
    sectionId,
    target: 'managed-organization-account',
  }
}
