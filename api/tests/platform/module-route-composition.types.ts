import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOwnedCharacterRouteEnv,
  PlatformAssignOrdinaryGroupInput,
  PlatformAssignOrdinaryGroupResult,
  PlatformBlockMemberResult,
  PlatformReviewerSearchRouteEnv,
  PlatformReviewerTargetRouteEnv,
} from '@eve-space/platform-module-contract/server'
import type { PlatformInstalledReviewerContributionDescriptor } from '@eve-space/platform-module-contract/installed'
import type { InferResponseType } from 'hono/client'
import { hc } from 'hono/client'
import { Hono } from 'hono'
import {
  composePlatformReviewerContributionRoute,
  platformModuleRouteComposers,
} from '../../src/platform/module-route-composition.js'

const authenticatedSessionRoute = new Hono<PlatformAuthenticatedSessionRouteEnv>().get(
  '/status',
  (context) => context.json({ status: 'ok' as const }),
)
const ownedCharacterRoute = new Hono<PlatformOwnedCharacterRouteEnv>().get(
  '/character',
  (context) => context.json({ characterId: context.var.platform.authorization.characterId }),
)
const reviewerTargetRoute = new Hono<PlatformReviewerTargetRouteEnv>().get(
  '/target',
  async (context) => {
    const platform = context.var.platform
    // @ts-expect-error reviewer targets receive no token capability
    void platform.tokens
    // @ts-expect-error reviewer targets receive no generic organization store
    void platform.organizationStore
    // @ts-expect-error sensitive access recording is host-owned
    void platform.audit
    // @ts-expect-error reviewer targets receive no owner-only core reads
    void platform.coreReads
    const status = await platform.collectionStatus.read('skills', 9001)
    // @ts-expect-error reviewer collection status never exposes another user's reauthorization path
    void status.reauthorizationPath
    // @ts-expect-error reviewer targets are immutable data, not generic lookups
    void platform.reviewerTarget.load
    return context.json({
      targetUserId: platform.reviewerTarget.account.userId,
      managedMemberLifecycleId: platform.reviewerTarget.managedMemberLifecycleId,
    })
  },
)
const reviewerSearchRoute = new Hono<PlatformReviewerSearchRouteEnv>().get('/search', (context) => {
  const platform = context.var.platform
  // @ts-expect-error reviewer search receives no target detail context
  void platform.reviewerTarget
  // @ts-expect-error reviewer search receives no collection-status capability
  void platform.collectionStatus
  // @ts-expect-error reviewer search receives no generic persistence capability
  void platform.persistence
  return context.json({ hasSearch: typeof platform.reviewerSearch.search === 'function' })
})
const groupCommandRoute = new Hono<
  PlatformReviewerTargetRouteEnv<readonly ['assign-ordinary-group', 'revoke-ordinary-group']>
>().post('/groups', async (context) => {
  const commands = context.var.platform.organizationCommands
  const input: PlatformAssignOrdinaryGroupInput = {
    groupId: 'group-1',
    reason: 'Reviewed access decision',
    expiresAt: null,
  }
  const result: PlatformAssignOrdinaryGroupResult = await commands.assignOrdinaryGroup(input)
  await commands.revokeOrdinaryGroup({
    groupId: result.groupId,
    assignmentId: result.assignmentId,
    reason: 'Reviewed revocation',
  })
  // @ts-expect-error this route did not declare the block command
  void commands.blockMember
  // @ts-expect-error bounded commands have no generic dispatcher
  void commands.dispatch
  // @ts-expect-error bounded commands have no generic execute method
  void commands.execute
  // @ts-expect-error bounded commands are not indexed by command identity
  void commands['assign-ordinary-group']
  return context.json({ decision: result.decision })
})
const blockCommandRoute = new Hono<
  PlatformReviewerTargetRouteEnv<readonly ['block-member', 'unblock-member']>
>().post('/block', async (context) => {
  const commands = context.var.platform.organizationCommands
  const result: PlatformBlockMemberResult = await commands.blockMember({ reason: 'Immediate deny' })
  await commands.unblockMember({ reason: 'Review completed' })
  // @ts-expect-error actor, target, and organization version are bound by core
  await commands.blockMember({ reason: 'Invalid', targetUserId: 'user-2' })
  // @ts-expect-error this route did not declare the group command
  void commands.assignOrdinaryGroup
  return context.json({ decision: result.decision })
})
const commandlessReviewerRoute = new Hono<PlatformReviewerTargetRouteEnv>().get(
  '/commandless',
  (context) => {
    // @ts-expect-error a route with no declarations receives no command capability
    void context.var.platform.organizationCommands
    return context.json({ status: 'ok' as const })
  },
)
const ownership = { publisherPackage: '@example/test-manifest', moduleId: 'test' } as const
const organization = { ...ownership, audience: 'member', requiredPermission: 'test.view' } as const
const reviewerOrganization = {
  ...ownership,
  audience: 'hr',
  requiredPermission: 'test.review',
  sectionId: 'overview',
  target: 'managed-organization-account',
  exposure: 'standard',
} as const
const reviewerSearchOrganization = {
  ...ownership,
  audience: 'hr',
  requiredPermission: 'member-audit.search',
  additionalRequiredPermissions: ['member-audit.summary.read'],
  target: 'managed-organization-account-search',
  exposure: 'standard',
} as const
const groupCommandOrganization = {
  ...ownership,
  audience: 'hr',
  requiredPermission: 'member-audit.groups.manage',
  sectionId: 'access-management',
  target: 'managed-organization-account',
  exposure: 'standard',
  organizationCommands: ['assign-ordinary-group', 'revoke-ordinary-group'],
} as const
const blockCommandOrganization = {
  ...ownership,
  audience: 'director',
  requiredPermission: 'member-audit.members.block',
  sectionId: 'access-management',
  target: 'managed-organization-account',
  exposure: 'standard',
  organizationCommands: ['block-member', 'unblock-member'],
} as const
const reviewerContribution = {
  publisherPackage: '@example/test-manifest',
  moduleId: 'test',
  contributionId: 'overview',
  routeId: 'test-review',
  routePath: '/api/modules/test/accounts/:userId',
  sectionId: 'overview',
  audience: 'hr',
  requiredPermission: 'test.review',
  target: 'managed-organization-account',
  panelPackage: '@example/test-nuxt',
  panelExport: './reviewer/overview',
  label: 'Overview',
  description: 'Review an account.',
  icon: 'overview',
  order: 10,
} as const satisfies PlatformInstalledReviewerContributionDescriptor
const reviewerContributionOrganization = {
  ...reviewerOrganization,
  routeId: 'test-review',
  namespace: '/test/accounts/:userId',
} as const

const composedAuthenticatedRoute = platformModuleRouteComposers['authenticated-session'](
  'test',
  organization,
  authenticatedSessionRoute,
)
const composedOwnedCharacterRoute = platformModuleRouteComposers['owned-character'](
  'test',
  organization,
  ownedCharacterRoute,
)
const composedReviewerTargetRoute = platformModuleRouteComposers['managed-organization-account'](
  'test',
  reviewerOrganization,
  reviewerTargetRoute,
)
const composedReviewerContributionRoute = composePlatformReviewerContributionRoute(
  reviewerContribution,
  reviewerContributionOrganization,
  reviewerTargetRoute,
  [reviewerContribution],
)
const composedReviewerSearchRoute = platformModuleRouteComposers[
  'managed-organization-account-search'
]('test', reviewerSearchOrganization, reviewerSearchRoute)
platformModuleRouteComposers['managed-organization-account'](
  'test',
  groupCommandOrganization,
  groupCommandRoute,
)
platformModuleRouteComposers['managed-organization-account'](
  'test',
  blockCommandOrganization,
  blockCommandRoute,
)
const authenticatedClient = hc<typeof composedAuthenticatedRoute>('http://localhost')
const ownedCharacterClient = hc<typeof composedOwnedCharacterRoute>('http://localhost')
const reviewerTargetClient = hc<typeof composedReviewerTargetRoute>('http://localhost')
const reviewerContributionClient = hc<typeof composedReviewerContributionRoute>('http://localhost')
const reviewerSearchClient = hc<typeof composedReviewerSearchRoute>('http://localhost')
type AuthenticatedStatus = InferResponseType<typeof authenticatedClient.status.$get, 200>
type OwnedCharacter = InferResponseType<typeof ownedCharacterClient.character.$get, 200>
type ReviewerTarget = InferResponseType<typeof reviewerTargetClient.target.$get, 200>
type ReviewerContribution = InferResponseType<typeof reviewerContributionClient.target.$get, 200>
type ReviewerSearch = InferResponseType<typeof reviewerSearchClient.search.$get, 200>
const authenticatedStatus: AuthenticatedStatus = { status: 'ok' }
const ownedCharacter: OwnedCharacter = { characterId: 9001 }
const reviewerTarget: ReviewerTarget = {
  targetUserId: 'user-1',
  managedMemberLifecycleId: 'managed-lifecycle-1',
}
const reviewerContributionResponse: ReviewerContribution = reviewerTarget
const reviewerSearch: ReviewerSearch = { hasSearch: true }
// @ts-expect-error the composed authenticated response must retain its literal status
const invalidAuthenticatedStatus: AuthenticatedStatus = { status: 'not-ok' }
// @ts-expect-error the composed owned-character response must retain its numeric identity
const invalidOwnedCharacter: OwnedCharacter = { characterId: '9001' }
void authenticatedStatus
void ownedCharacter
void reviewerTarget
void reviewerContributionResponse
void reviewerSearch
void invalidAuthenticatedStatus
void invalidOwnedCharacter
void groupCommandRoute
void blockCommandRoute
void commandlessReviewerRoute

// @ts-expect-error authenticated-session routes cannot require owned-character context
platformModuleRouteComposers['authenticated-session']('test', organization, ownedCharacterRoute)
// @ts-expect-error owned-character routes cannot receive only authenticated-session context
platformModuleRouteComposers['owned-character']('test', organization, authenticatedSessionRoute)
platformModuleRouteComposers['managed-organization-account'](
  'test',
  reviewerOrganization,
  // @ts-expect-error reviewer target routes cannot receive ordinary authenticated context
  authenticatedSessionRoute,
)
// @ts-expect-error ordinary authenticated routes cannot require reviewer target context
platformModuleRouteComposers['authenticated-session']('test', organization, reviewerTargetRoute)
platformModuleRouteComposers['managed-organization-account-search'](
  'test',
  reviewerSearchOrganization,
  // @ts-expect-error reviewer search routes cannot receive ordinary authenticated context
  authenticatedSessionRoute,
)
