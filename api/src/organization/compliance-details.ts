import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationAccountCompliance,
  organizationComplianceIssues,
} from '../db/schema.js'
import { recomputeCurrentOrganizationAccountCompliance } from './compliance.js'
import { isComplianceProjectionDue } from './compliance-access.js'

export async function getOrganizationAccountComplianceDetails(userId: string) {
  const organization = await loadOrganizationVersion()
  let projection = await loadProjection(organization, userId)
  const now = new Date()
  if (!projection || isComplianceProjectionDue(projection, now)) {
    await recomputeCurrentOrganizationAccountCompliance(userId)
    projection = await loadProjection(organization, userId)
  }
  const characterRows = await db
    .select({
      characterId: characters.characterId,
      characterName: characters.name,
      affiliationCheckedAt: characters.affiliationCheckedAt,
      nextAffiliationCheck: characters.nextAffiliationCheck,
      affiliationResolutionState: characters.affiliationResolutionState,
    })
    .from(characters)
    .where(eq(characters.userId, userId))
    .orderBy(asc(characters.name), asc(characters.characterId))
  const issues = await db
    .select({
      issueCode: organizationComplianceIssues.issueCode,
      characterId: organizationComplianceIssues.characterId,
      requiredScope: organizationComplianceIssues.requiredScope,
    })
    .from(organizationComplianceIssues)
    .where(
      and(
        eq(organizationComplianceIssues.deploymentId, 1),
        eq(organizationComplianceIssues.organizationVersion, organization),
        eq(organizationComplianceIssues.userId, userId),
      ),
    )
    .orderBy(asc(organizationComplianceIssues.issueKey))
  const issuesByCharacter = new Map<number, typeof issues>()
  for (const issue of issues) {
    if (issue.characterId === null) continue
    const characterIssues = issuesByCharacter.get(issue.characterId) ?? []
    characterIssues.push(issue)
    issuesByCharacter.set(issue.characterId, characterIssues)
  }

  return {
    organizationVersion: organization,
    state: projection?.state ?? ('pending' as const),
    evidenceFreshness: projection?.evidenceFreshness ?? ('unavailable' as const),
    evidenceAt: projection?.evidenceAt?.toISOString() ?? null,
    reviewDeadline: projection?.reviewDeadline?.toISOString() ?? null,
    accessValidUntil: projection?.accessValidUntil?.toISOString() ?? null,
    evaluatedAt: projection?.evaluatedAt.toISOString() ?? null,
    accountReasons: issues
      .filter(({ characterId }) => characterId === null)
      .map(({ issueCode }) => ({ code: issueCode })),
    remediationActions: accountRemediationActions(issues),
    characters: characterRows.map((character) => {
      const characterIssues = issuesByCharacter.get(character.characterId) ?? []
      return {
        characterId: character.characterId,
        characterName: character.characterName,
        affiliationFreshness: characterAffiliationFreshness(character),
        affiliationCheckedAt: character.affiliationCheckedAt?.toISOString() ?? null,
        nextAffiliationCheck: character.nextAffiliationCheck?.toISOString() ?? null,
        reasons: characterIssues.map(({ issueCode, requiredScope }) => ({
          code: issueCode,
          requiredScope,
        })),
        remediationActions: remediationActions(character.characterId, characterIssues),
      }
    }),
    disclosureNotice:
      'EVE SSO authorizes one selected character at a time. Registration completeness depends on member disclosure and organization policy.',
  }
}

async function loadOrganizationVersion() {
  const [organization] = await db
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) throw new Error('Deployment organization is not configured')
  return organization.organizationVersion
}

async function loadProjection(organizationVersion: number, userId: string) {
  const [projection] = await db
    .select({
      state: organizationAccountCompliance.state,
      evidenceFreshness: organizationAccountCompliance.evidenceFreshness,
      evidenceAt: organizationAccountCompliance.evidenceAt,
      reviewDeadline: organizationAccountCompliance.reviewDeadline,
      accessValidUntil: organizationAccountCompliance.accessValidUntil,
      evaluatedAt: organizationAccountCompliance.evaluatedAt,
    })
    .from(organizationAccountCompliance)
    .where(
      and(
        eq(organizationAccountCompliance.deploymentId, 1),
        eq(organizationAccountCompliance.organizationVersion, organizationVersion),
        eq(organizationAccountCompliance.userId, userId),
        eq(organizationAccountCompliance.authoritative, true),
      ),
    )
  return projection
}

function accountRemediationActions(issues: { issueCode: string; characterId: number | null }[]) {
  const actions: { type: string; path: string | null }[] = []
  if (issues.some(({ issueCode }) => issueCode === 'no-attached-characters'))
    actions.push({ type: 'attach-character', path: '/auth/eve/attach' })
  if (issues.some(({ issueCode }) => issueCode === 'no-managed-organization-character'))
    actions.push({ type: 'attach-managed-character', path: '/auth/eve/attach' })
  return actions
}

function characterAffiliationFreshness(character: {
  affiliationCheckedAt: Date | null
  nextAffiliationCheck: Date | null
  affiliationResolutionState: 'pending' | 'resolved' | 'unresolvable'
}) {
  if (character.affiliationResolutionState !== 'resolved' || !character.affiliationCheckedAt)
    return 'unavailable' as const
  return character.nextAffiliationCheck && character.nextAffiliationCheck > new Date()
    ? ('fresh' as const)
    : ('stale' as const)
}

function remediationActions(
  characterId: number,
  issues: { issueCode: string; requiredScope: string | null }[],
) {
  const actions: { type: string; path: string | null }[] = []
  if (issues.some(({ issueCode }) => issueCode === 'required-scope-missing'))
    actions.push({
      type: 'reauthorize-character',
      path: `/auth/eve/reauthorize/${characterId}`,
    })
  if (
    issues.some(
      ({ issueCode }) =>
        issueCode === 'character-affiliation-stale' ||
        issueCode === 'character-affiliation-unavailable',
    )
  )
    actions.push({ type: 'await-affiliation-refresh', path: null })
  if (issues.some(({ issueCode }) => issueCode === 'character-outside-managed-organization'))
    actions.push({ type: 'contact-organization-hr', path: null })
  return actions
}
