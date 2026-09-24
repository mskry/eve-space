import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationAccountCompliance,
  organizationComplianceIssues,
} from '../db/schema.js'
import { resolveAffiliationFreshness } from './affiliation-freshness.js'
import { isComplianceProjectionDue } from './access-policy.js'
import { recomputeCurrentOrganizationAccountCompliance } from './compliance.js'

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
      affiliationCheckedAt: characters.affiliationCheckedAt,
      affiliationResolutionState: characters.affiliationResolutionState,
      characterId: characters.characterId,
      characterName: characters.name,
      nextAffiliationCheck: characters.nextAffiliationCheck,
    })
    .from(characters)
    .where(eq(characters.userId, userId))
    .orderBy(asc(characters.name), asc(characters.characterId))
  const issues = await db
    .select({
      characterId: organizationComplianceIssues.characterId,
      issueCode: organizationComplianceIssues.issueCode,
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
    if (issue.characterId === null) {
      continue
    }
    const characterIssues = issuesByCharacter.get(issue.characterId) ?? []
    characterIssues.push(issue)
    issuesByCharacter.set(issue.characterId, characterIssues)
  }

  return {
    organizationVersion: organization,
    ...mapComplianceProjection(projection),
    accountReasons: issues
      .filter(({ characterId }) => characterId === null)
      .map(({ issueCode }) => ({ code: issueCode })),
    remediationActions: accountRemediationActions(issues),
    characters: characterRows.map((character) =>
      mapComplianceCharacter(character, issuesByCharacter.get(character.characterId) ?? [], now),
    ),
    disclosureNotice:
      'EVE SSO authorizes one selected character at a time. Registration completeness depends on member disclosure and organization policy.',
  }
}

function mapComplianceProjection(projection: Awaited<ReturnType<typeof loadProjection>>) {
  return {
    accessValidUntil: projection?.accessValidUntil?.toISOString() ?? null,
    evaluatedAt: projection?.evaluatedAt.toISOString() ?? null,
    evidenceAt: projection?.evidenceAt?.toISOString() ?? null,
    evidenceFreshness: projection?.evidenceFreshness ?? ('unavailable' as const),
    reviewDeadline: projection?.reviewDeadline?.toISOString() ?? null,
    state: projection?.state ?? ('pending' as const),
  }
}

function mapComplianceCharacter(
  character: Pick<
    typeof characters.$inferSelect,
    'characterId' | 'affiliationCheckedAt' | 'nextAffiliationCheck' | 'affiliationResolutionState'
  > & { characterName: string },
  characterIssues: Pick<
    typeof organizationComplianceIssues.$inferSelect,
    'issueCode' | 'requiredScope'
  >[],
  now: Date,
) {
  return {
    affiliationCheckedAt: character.affiliationCheckedAt?.toISOString() ?? null,
    affiliationFreshness: resolveAffiliationFreshness(character, now),
    characterId: character.characterId,
    characterName: character.characterName,
    nextAffiliationCheck: character.nextAffiliationCheck?.toISOString() ?? null,
    reasons: characterIssues.map(({ issueCode, requiredScope }) => ({
      code: issueCode,
      requiredScope,
    })),
    remediationActions: remediationActions(character.characterId, characterIssues),
  }
}

async function loadOrganizationVersion() {
  const [organization] = await db
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) {
    throw new Error('Deployment organization is not configured')
  }
  return organization.organizationVersion
}

async function loadProjection(organizationVersion: number, userId: string) {
  const [projection] = await db
    .select({
      accessValidUntil: organizationAccountCompliance.accessValidUntil,
      evaluatedAt: organizationAccountCompliance.evaluatedAt,
      evidenceAt: organizationAccountCompliance.evidenceAt,
      evidenceFreshness: organizationAccountCompliance.evidenceFreshness,
      reviewDeadline: organizationAccountCompliance.reviewDeadline,
      state: organizationAccountCompliance.state,
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
  if (issues.some(({ issueCode }) => issueCode === 'no-attached-characters')) {
    actions.push({ path: '/auth/eve/attach', type: 'attach-character' })
  }
  if (issues.some(({ issueCode }) => issueCode === 'no-managed-organization-character')) {
    actions.push({ path: '/auth/eve/attach', type: 'attach-managed-character' })
  }
  return actions
}

function remediationActions(
  characterId: number,
  issues: { issueCode: string; requiredScope: string | null }[],
) {
  const actions: { type: string; path: string | null }[] = []
  if (
    issues.some(
      ({ issueCode }) =>
        issueCode === 'character-authorization-missing' || issueCode === 'required-scope-missing',
    )
  ) {
    actions.push({
      path: `/auth/eve/reauthorize/${characterId}`,
      type: 'reauthorize-character',
    })
  }
  if (
    issues.some(
      ({ issueCode }) =>
        issueCode === 'character-affiliation-stale' ||
        issueCode === 'character-affiliation-unavailable',
    )
  ) {
    actions.push({ path: null, type: 'await-affiliation-refresh' })
  }
  if (issues.some(({ issueCode }) => issueCode === 'character-outside-managed-organization')) {
    actions.push({ path: null, type: 'contact-organization-hr' })
  }
  return actions
}
