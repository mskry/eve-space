import {
  isPlatformReviewerAccountSearchQuery,
  type PlatformReviewerTargetCompliance,
} from '@eve-space/platform-module-contract/server'
import {
  platformReviewerCharacterDirectorySortFields,
  platformReviewerDirectoryAuditStates,
  platformReviewerDirectoryComplianceStates,
  platformReviewerDirectorySortDirections,
  type PlatformReviewerCharacterDirectoryInput,
  type PlatformReviewerCharacterDirectoryPage,
  type PlatformReviewerCharacterDirectorySortField,
  type PlatformReviewerDirectorySortDirection,
} from '@eve-space/platform-module-contract/reviewer-directory'
import { sql, type SQL } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characterDirectoryCursorSchema,
  characterDirectoryFingerprint,
  decodeCharacterDirectoryCursor,
  encodeCharacterDirectoryCursor,
  ReviewerCharacterDirectoryInputError,
  type CharacterCursorPosition,
} from './reviewer-character-cursor.js'
import {
  reviewerEligibleCharacterCondition,
  reviewerManagedCharacterCondition,
} from './reviewer-character-eligibility.js'
import {
  characterCursorCondition,
  characterOrderClause,
  characterSortExpression,
  normalizedCharacterSortValue,
} from './reviewer-character-order.js'
import { hasCurrentReviewerOrganizationSnapshot } from './reviewer-organization-snapshot.js'
import { loadDirectoryGroupData } from './reviewer-directory-groups.js'
import { escapeReviewerLikePattern, parseReviewerCharacterId } from './reviewer-directory-query.js'
import { characterDirectoryAuditSummaryCte } from './reviewer-directory-audit.js'
import { resolveAffiliationFreshness } from './affiliation-freshness.js'

export interface ReviewerCharacterDirectoryInput extends PlatformReviewerCharacterDirectoryInput {
  readonly organizationVersion: number
  readonly now?: Date
}

type CharacterCandidateIdentifier = string | number
type CharacterCandidateTimestamp = string | Date

interface CharacterCandidateRow extends Record<string, unknown> {
  readonly userId: string
  readonly managedMemberLifecycleId: string
  readonly managedSince: CharacterCandidateTimestamp
  readonly siteRegisteredAt: CharacterCandidateTimestamp
  readonly characterId: CharacterCandidateIdentifier
  readonly characterName: string
  readonly subjectLifecycleId: string
  readonly authorizationGeneration: number | null
  readonly isMain: boolean
  readonly corporationId: CharacterCandidateIdentifier
  readonly allianceId: CharacterCandidateIdentifier | null
  readonly affiliationCheckedAt: CharacterCandidateTimestamp | null
  readonly nextAffiliationCheck: CharacterCandidateTimestamp | null
  readonly affiliationResolutionState: 'pending' | 'resolved' | 'unresolvable'
  readonly membership: 'managed' | 'approved-external'
  readonly disclosedCharacterCount: number
  readonly mainCharacterId: CharacterCandidateIdentifier | null
  readonly mainCharacterName: string | null
  readonly complianceState: PlatformReviewerTargetCompliance['state'] | null
  readonly complianceEvidenceFreshness: PlatformReviewerTargetCompliance['evidenceFreshness'] | null
  readonly complianceEvidenceAt: CharacterCandidateTimestamp | null
  readonly complianceReviewDeadline: CharacterCandidateTimestamp | null
  readonly complianceAccessValidUntil: CharacterCandidateTimestamp | null
  readonly complianceEvaluatedAt: CharacterCandidateTimestamp | null
  readonly blockedAt: CharacterCandidateTimestamp | null
  readonly auditState: PlatformReviewerCharacterDirectoryPage['items'][number]['auditData']['state']
  readonly auditExpected: number
  readonly auditCovered: number
  readonly auditAsOf: CharacterCandidateTimestamp | null
  readonly sortValue: CharacterCandidateIdentifier | null
}

interface ReviewerCharacterCandidate {
  readonly userId: string
  readonly managedMemberLifecycleId: string
  readonly managedSince: string
  readonly siteRegisteredAt: string
  readonly characterId: number
  readonly characterName: string
  readonly subjectLifecycleId: string
  readonly authorizationGeneration: number | null
  readonly isMain: boolean
  readonly corporationId: number
  readonly allianceId: number | null
  readonly affiliationCheckedAt: string | null
  readonly affiliationFreshness: 'fresh' | 'stale' | 'unavailable'
  readonly membership: 'managed' | 'approved-external'
  readonly disclosedCharacterCount: number
  readonly mainCharacter: { readonly characterId: number; readonly name: string } | null
  readonly compliance: PlatformReviewerTargetCompliance
  readonly block:
    | { readonly blocked: false }
    | { readonly blocked: true; readonly blockedAt: string }
  readonly auditData: PlatformReviewerCharacterDirectoryPage['items'][number]['auditData']
}

const iso = (value: CharacterCandidateTimestamp) => new Date(value).toISOString()
const optionalIso = (value: CharacterCandidateTimestamp | null) =>
  value === null ? null : iso(value)
const pendingCompliance: PlatformReviewerTargetCompliance = {
  state: 'pending',
  evidenceFreshness: 'unavailable',
  evidenceAt: null,
  reviewDeadline: null,
  accessValidUntil: null,
  evaluatedAt: null,
}
const accountIdPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

interface CharacterCandidateFilters {
  readonly query?: string
  readonly corporationId?: number
  readonly groupId?: string
  readonly complianceState?: PlatformReviewerTargetCompliance['state']
  readonly blocked?: boolean
  readonly auditState?: PlatformReviewerCharacterDirectoryPage['items'][number]['auditData']['state']
  readonly sort: PlatformReviewerCharacterDirectorySortField
  readonly direction: PlatformReviewerDirectorySortDirection
  readonly cursor?: string
  readonly limit: number
}

const validateCharacterDirectoryFilters = (
  input: PlatformReviewerCharacterDirectoryInput,
  query: string | undefined,
) => {
  if (query && !isPlatformReviewerAccountSearchQuery(query)) {
    throw new ReviewerCharacterDirectoryInputError()
  }
  if (
    input.corporationId !== undefined &&
    (!Number.isSafeInteger(input.corporationId) || input.corporationId <= 0)
  ) {
    throw new ReviewerCharacterDirectoryInputError()
  }
  if (
    input.cursor !== undefined &&
    !characterDirectoryCursorSchema.safeParse(input.cursor).success
  ) {
    throw new ReviewerCharacterDirectoryInputError()
  }
  if (input.groupId && !accountIdPattern.test(input.groupId)) {
    throw new ReviewerCharacterDirectoryInputError()
  }
  if (
    input.complianceState &&
    !platformReviewerDirectoryComplianceStates.includes(input.complianceState)
  ) {
    throw new ReviewerCharacterDirectoryInputError()
  }
  if (input.auditState && !platformReviewerDirectoryAuditStates.includes(input.auditState)) {
    throw new ReviewerCharacterDirectoryInputError()
  }
}

const normalizeFilters = (
  input: PlatformReviewerCharacterDirectoryInput,
): CharacterCandidateFilters => {
  const query = input.query?.trim()
  validateCharacterDirectoryFilters(input, query)
  const sort = input.sort ?? 'character'
  const direction = input.direction ?? 'asc'
  if (
    !platformReviewerCharacterDirectorySortFields.includes(sort) ||
    !platformReviewerDirectorySortDirections.includes(direction)
  ) {
    throw new ReviewerCharacterDirectoryInputError()
  }
  const limit = input.limit ?? 25
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ReviewerCharacterDirectoryInputError()
  }
  return {
    ...(query && { query }),
    ...(input.corporationId && { corporationId: input.corporationId }),
    ...(input.groupId && { groupId: input.groupId }),
    ...(input.complianceState && { complianceState: input.complianceState }),
    ...(input.blocked !== undefined && { blocked: input.blocked }),
    ...(input.auditState && { auditState: input.auditState }),
    sort,
    direction,
    ...(input.cursor && { cursor: input.cursor }),
    limit,
  }
}

const candidateFilter = (
  filters: CharacterCandidateFilters,
  organizationVersion: number,
  now: Date,
): SQL => {
  const conditions: SQL[] = []
  if (filters.corporationId) {
    conditions.push(sql`character.corporation_id = ${filters.corporationId}`)
  }
  if (filters.query) {
    const pattern = `%${escapeReviewerLikePattern(filters.query)}%`
    const matches: SQL[] = [sql`character.character_name ilike ${pattern}`]
    const characterId = parseReviewerCharacterId(filters.query)
    if (characterId) {
      matches.push(sql`character.character_id = ${characterId}`)
    }
    if (accountIdPattern.test(filters.query)) {
      matches.push(sql`character.user_id = ${filters.query}::uuid`)
    }
    const queryMatches = sql.join(matches, sql` or `)
    conditions.push(sql`(${queryMatches})`)
  }
  if (filters.groupId) {
    conditions.push(sql`exists (
      select 1 from organization_group_assignments assignment
      where assignment.deployment_id = 1
        and assignment.organization_version = ${organizationVersion}
        and assignment.user_id = character.user_id
        and assignment.group_id = ${filters.groupId}::uuid
        and assignment.revoked_at is null
        and (assignment.expires_at is null or assignment.expires_at > ${now.toISOString()}::text::timestamptz)
    )`)
  }
  if (filters.complianceState) {
    conditions.push(sql`coalesce(compliance.state, 'pending') = ${filters.complianceState}`)
  }
  if (filters.blocked !== undefined) {
    conditions.push(filters.blocked ? sql`block.block_id is not null` : sql`block.block_id is null`)
  }
  if (filters.auditState) {
    conditions.push(sql`coalesce(audit.state, 'not-enabled') = ${filters.auditState}`)
  }
  return conditions.length ? sql.join(conditions, sql` and `) : sql`true`
}

const projectCandidate = (row: CharacterCandidateRow, now: Date): ReviewerCharacterCandidate => ({
  userId: row.userId,
  managedMemberLifecycleId: row.managedMemberLifecycleId,
  managedSince: iso(row.managedSince),
  siteRegisteredAt: iso(row.siteRegisteredAt),
  characterId: Number(row.characterId),
  characterName: row.characterName,
  subjectLifecycleId: row.subjectLifecycleId,
  authorizationGeneration: row.authorizationGeneration,
  isMain: row.isMain,
  corporationId: Number(row.corporationId),
  allianceId: row.allianceId === null ? null : Number(row.allianceId),
  affiliationCheckedAt: row.affiliationCheckedAt ? iso(row.affiliationCheckedAt) : null,
  affiliationFreshness: resolveAffiliationFreshness(
    {
      affiliationResolutionState: row.affiliationResolutionState,
      affiliationCheckedAt: row.affiliationCheckedAt ? new Date(row.affiliationCheckedAt) : null,
      nextAffiliationCheck: row.nextAffiliationCheck ? new Date(row.nextAffiliationCheck) : null,
    },
    now,
  ),
  membership: row.membership,
  disclosedCharacterCount: row.disclosedCharacterCount,
  mainCharacter:
    row.mainCharacterId === null || row.mainCharacterName === null
      ? null
      : { characterId: Number(row.mainCharacterId), name: row.mainCharacterName },
  compliance:
    row.complianceState && row.complianceEvidenceFreshness && row.complianceEvaluatedAt
      ? {
          state: row.complianceState,
          evidenceFreshness: row.complianceEvidenceFreshness,
          evidenceAt: optionalIso(row.complianceEvidenceAt),
          reviewDeadline: optionalIso(row.complianceReviewDeadline),
          accessValidUntil: optionalIso(row.complianceAccessValidUntil),
          evaluatedAt: iso(row.complianceEvaluatedAt),
        }
      : pendingCompliance,
  block: row.blockedAt ? { blocked: true, blockedAt: iso(row.blockedAt) } : { blocked: false },
  auditData: {
    state: row.auditState,
    expected: row.auditExpected,
    covered: row.auditCovered,
    asOf: optionalIso(row.auditAsOf),
  },
})

const loadCandidates = async (
  transaction: DatabaseTransaction,
  organizationVersion: number,
  now: Date,
  filters: CharacterCandidateFilters,
  position: CharacterCursorPosition | null,
) => {
  const managed = reviewerManagedCharacterCondition(organizationVersion, now)
  const eligible = reviewerEligibleCharacterCondition(organizationVersion, now)
  const auditCte = characterDirectoryAuditSummaryCte(organizationVersion, now)
  const filter = candidateFilter(filters, organizationVersion, now)
  const cursorCondition = characterCursorCondition(filters.sort, filters.direction, position)
  const sortExpression = characterSortExpression(filters.sort)
  const orderClause = characterOrderClause(filters.sort, filters.direction)
  const rows = await transaction.execute<CharacterCandidateRow>(sql`
    with managed_accounts as (
      select member.user_id, member.managed_member_lifecycle_id,
        member.started_at as managed_since, account.created_at as site_registered_at
      from deployment_settings settings
      join organization_managed_member_lifecycles member
        on member.deployment_id = settings.id
        and member.organization_version = settings.organization_version
        and member.ended_at is null
      join users account on account.id = member.user_id
      where settings.id = 1 and settings.organization_version = ${organizationVersion}
        and exists (
          select 1 from characters character
          join platform_subject_lifecycles lifecycle
            on lifecycle.character_id = character.character_id
            and lifecycle.subject_kind = 'character'
          where character.user_id = member.user_id and (${managed})
        )
    ), eligible_characters as (
      select account.*, character.character_id, character.name as character_name,
        lifecycle.subject_lifecycle_id, token.token_version as authorization_generation,
        character.is_main, character.corporation_id, character.alliance_id,
        character.affiliation_checked_at,
        character.next_affiliation_check, character.affiliation_resolution_state,
        case when (${managed}) then 'managed' else 'approved-external' end as membership,
        count(*) over (partition by account.user_id)::integer as disclosed_character_count
      from managed_accounts account
      join characters character on character.user_id = account.user_id
      join platform_subject_lifecycles lifecycle
        on lifecycle.character_id = character.character_id
        and lifecycle.subject_kind = 'character'
      left join eve_tokens token on token.character_id = character.character_id
      where (${eligible})
    ), ${auditCte}
    select character.user_id as "userId",
      character.managed_member_lifecycle_id as "managedMemberLifecycleId",
      character.managed_since as "managedSince",
      character.site_registered_at as "siteRegisteredAt",
      character.character_id as "characterId",
      character.character_name as "characterName",
      character.subject_lifecycle_id as "subjectLifecycleId",
      character.authorization_generation as "authorizationGeneration",
      character.is_main as "isMain",
      character.corporation_id as "corporationId",
      character.alliance_id as "allianceId",
      character.affiliation_checked_at as "affiliationCheckedAt",
      character.next_affiliation_check as "nextAffiliationCheck",
      character.affiliation_resolution_state as "affiliationResolutionState",
      character.membership as "membership",
      character.disclosed_character_count as "disclosedCharacterCount",
      main.character_id as "mainCharacterId",
      main.character_name as "mainCharacterName",
      compliance.state as "complianceState",
      compliance.evidence_freshness as "complianceEvidenceFreshness",
      compliance.evidence_at as "complianceEvidenceAt",
      compliance.review_deadline as "complianceReviewDeadline",
      compliance.access_valid_until as "complianceAccessValidUntil",
      compliance.evaluated_at as "complianceEvaluatedAt",
      block.blocked_at as "blockedAt",
      coalesce(audit.state, 'not-enabled') as "auditState",
      coalesce(audit.expected, 0)::integer as "auditExpected",
      coalesce(audit.covered, 0)::integer as "auditCovered",
      audit.as_of as "auditAsOf",
      ${sortExpression} as "sortValue"
    from eligible_characters character
    left join eligible_characters main
      on main.user_id = character.user_id and main.is_main
    left join organization_account_compliance compliance
      on compliance.deployment_id = 1
      and compliance.organization_version = ${organizationVersion}
      and compliance.user_id = character.user_id and compliance.authoritative
    left join organization_member_blocks block
      on block.deployment_id = 1
      and block.organization_version = ${organizationVersion}
      and block.user_id = character.user_id and block.unblocked_at is null
    left join audit_summary audit on audit.subject_lifecycle_id = character.subject_lifecycle_id
    where ${filter} and ${cursorCondition}
    order by ${orderClause}
    limit ${filters.limit + 1}
  `)
  return [...rows]
}

const searchReviewerCharacterCandidates = async (input: ReviewerCharacterDirectoryInput) => {
  const now = input.now ?? new Date()
  const filters = normalizeFilters(input)
  const fingerprint = characterDirectoryFingerprint({
    query: filters.query ?? null,
    corporationId: filters.corporationId ?? null,
    groupId: filters.groupId ?? null,
    complianceState: filters.complianceState ?? null,
    blocked: filters.blocked ?? null,
    auditState: filters.auditState ?? null,
    sort: filters.sort,
    direction: filters.direction,
    limit: filters.limit,
  })
  const position = filters.cursor
    ? decodeCharacterDirectoryCursor(filters.cursor, input.organizationVersion, fingerprint)
    : null
  return db.transaction(
    async (transaction) => {
      if (
        !(await hasCurrentReviewerOrganizationSnapshot(transaction, input.organizationVersion, now))
      ) {
        return { items: [], nextCursor: null, status: 'unavailable' as const }
      }
      const rows = await loadCandidates(
        transaction,
        input.organizationVersion,
        now,
        filters,
        position,
      )
      const page = rows.slice(0, filters.limit)
      const groups = await loadDirectoryGroupData(
        transaction,
        input.organizationVersion,
        [...new Set(page.map(({ userId }) => userId))],
        now,
      )
      const anchor = page.at(-1)
      const nextCursor =
        rows.length > filters.limit && anchor
          ? encodeCharacterDirectoryCursor(
              {
                value: normalizedCharacterSortValue(anchor.sortValue, filters.sort),
                characterName: anchor.characterName.toLowerCase(),
                characterId: Number(anchor.characterId),
                userId: anchor.userId,
                managedMemberLifecycleId: anchor.managedMemberLifecycleId,
                subjectLifecycleId: anchor.subjectLifecycleId,
              },
              input.organizationVersion,
              fingerprint,
            )
          : null
      return {
        items: page.map((row) => projectCandidate(row, now)),
        groupFacets: groups.facets,
        groupsByUserId: groups.groupsByUserId,
        nextCursor,
        status: 'available' as const,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

export const searchManagedOrganizationCharacters = async (
  input: ReviewerCharacterDirectoryInput,
): Promise<PlatformReviewerCharacterDirectoryPage> => {
  const page = await searchReviewerCharacterCandidates(input)
  return {
    organizationVersion: input.organizationVersion,
    status: page.status,
    nextCursor: page.nextCursor,
    groupFacets: page.status === 'available' ? page.groupFacets : [],
    items: page.items.map((candidate) => ({
      account: { userId: candidate.userId, mainCharacter: candidate.mainCharacter },
      character: {
        characterId: candidate.characterId,
        name: candidate.characterName,
        subjectLifecycleId: candidate.subjectLifecycleId,
        authorizationGeneration: candidate.authorizationGeneration,
        isMain: candidate.isMain,
        affiliation: {
          corporationId: candidate.corporationId,
          allianceId: candidate.allianceId,
          checkedAt: candidate.affiliationCheckedAt,
          freshness: candidate.affiliationFreshness,
          membership: candidate.membership,
        },
      },
      managedMemberLifecycleId: candidate.managedMemberLifecycleId,
      managedSince: candidate.managedSince,
      siteRegisteredAt: candidate.siteRegisteredAt,
      disclosedCharacterCount: candidate.disclosedCharacterCount,
      compliance: candidate.compliance,
      block: candidate.block,
      groups: page.status === 'available' ? (page.groupsByUserId.get(candidate.userId) ?? []) : [],
      auditData: candidate.auditData,
    })),
  }
}
