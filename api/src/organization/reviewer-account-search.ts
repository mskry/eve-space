import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import {
  platformReviewerDirectoryAuditStates,
  platformReviewerDirectoryComplianceStates,
  platformReviewerDirectoryDefaultSortDirection,
  platformReviewerDirectoryDefaultSortField,
  platformReviewerDirectorySortDirections,
  platformReviewerDirectorySortFields,
  type PlatformReviewerDirectoryAuditState,
  type PlatformReviewerDirectoryInput,
  type PlatformReviewerDirectoryPage,
  type PlatformReviewerDirectoryRow,
  type PlatformReviewerDirectorySortDirection,
  type PlatformReviewerDirectorySortField,
} from '@eve-space/platform-module-contract/reviewer-directory'
import {
  isPlatformReviewerAccountSearchCursor,
  isPlatformReviewerAccountSearchQuery,
  type PlatformReviewerAccountSearchInput,
  type PlatformReviewerAccountSearchItem,
  type PlatformReviewerAccountSearchPage,
  type PlatformReviewerTargetCompliance,
} from '@eve-space/platform-module-contract/server'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationAccountCompliance,
  organizationCharacterExceptions,
  organizationGroupAssignments,
  organizationGroups,
  organizationManagedCorporations,
  organizationManagedMemberLifecycles,
  organizationMemberBlocks,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { env } from '../env.js'
import { installedModuleResourceDeclarations } from '../generated/platform/installed-module-resource-declarations.js'
import { createPlatformResourceClassifierInput } from '../platform/resource-classifier-input.js'
import { hasCurrentReviewerOrganizationSnapshot } from './reviewer-organization-snapshot.js'

const defaultPageSize = 25
const maximumPageSize = 50
const cursorVersion = 1
const cursorNonceLength = 12
const cursorTagLength = 16
const cursorAdditionalData = Buffer.from('eve-space:reviewer-account-search:v1')
const directoryCursorVersion = 2
const directoryCursorAdditionalData = Buffer.from('eve-space:reviewer-directory:v2')
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const complianceStates = new Set<PlatformReviewerTargetCompliance['state']>([
  'pending',
  'compliant',
  'review_required',
  'suspended',
])
const mainCharacters = alias(characters, 'reviewer_search_main_characters')
const mainCharacterLifecycles = alias(
  platformSubjectLifecycles,
  'reviewer_search_main_character_lifecycles',
)
const mainManagedCorporations = alias(
  organizationManagedCorporations,
  'reviewer_search_main_managed_corporations',
)
const mainCharacterExceptions = alias(
  organizationCharacterExceptions,
  'reviewer_search_main_character_exceptions',
)
const pendingCompliance: PlatformReviewerTargetCompliance = {
  accessValidUntil: null,
  evaluatedAt: null,
  evidenceAt: null,
  evidenceFreshness: 'unavailable',
  reviewDeadline: null,
  state: 'pending',
}
const nullableDirectorySortFields = new Set<PlatformReviewerDirectorySortField>([
  'audit_data',
  'review_deadline',
  'access_valid_until',
  'blocked_since',
])
const memberAuditDirectoryResources = installedModuleResourceDeclarations.filter(
  ({ eligibility, moduleId, subjectKind }) =>
    moduleId === 'member-audit' &&
    subjectKind === 'character' &&
    eligibility.kind === 'current-managed-member-character',
)

export async function searchManagedOrganizationAccounts(input: {
  readonly organizationVersion: number
  readonly filters: PlatformReviewerAccountSearchInput
  readonly now?: Date
}): Promise<PlatformReviewerAccountSearchPage> {
  const filters = normalizeFilters(input.filters)
  const now = input.now ?? new Date()
  return db.transaction(
    (transaction) =>
      searchManagedOrganizationAccountsInTransaction(
        transaction,
        input.organizationVersion,
        filters,
        now,
      ),
    { isolationLevel: 'repeatable read' },
  )
}

export async function searchManagedOrganizationDirectory(input: {
  readonly organizationVersion: number
  readonly filters: PlatformReviewerDirectoryInput
  readonly now?: Date
}): Promise<PlatformReviewerDirectoryPage> {
  const filters = normalizeDirectoryFilters(input.filters)
  const now = input.now ?? new Date()
  return db.transaction(
    (transaction) =>
      searchManagedOrganizationDirectoryInTransaction(
        transaction,
        input.organizationVersion,
        filters,
        now,
      ),
    { isolationLevel: 'repeatable read' },
  )
}

export class ReviewerAccountSearchInputError extends TypeError {
  constructor() {
    super('Invalid reviewer account search input.')
    this.name = 'ReviewerAccountSearchInputError'
  }
}

type DirectorySortValue = string | number | null

interface NormalizedDirectoryFilters {
  readonly query?: string
  readonly corporationId?: number
  readonly groupId?: string
  readonly complianceState?: PlatformReviewerTargetCompliance['state']
  readonly blocked?: boolean
  readonly auditState?: PlatformReviewerDirectoryAuditState
  readonly sort: PlatformReviewerDirectorySortField
  readonly direction: PlatformReviewerDirectorySortDirection
  readonly cursor?: string
  readonly limit: number
}

interface DirectoryCursorPosition {
  readonly sortValue: DirectorySortValue
  readonly userId: string
}

interface DirectoryDatabaseRow extends Record<string, unknown> {
  readonly userId: string
  readonly managedMemberLifecycleId: string
  readonly managedSince: DatabaseDate
  readonly siteRegisteredAt: DatabaseDate
  readonly characterId: number | string
  readonly characterName: string
  readonly corporationId: number | string
  readonly allianceId: number | string | null
  readonly affiliationCheckedAt: DatabaseDate
  readonly mainCharacterId: number | string | null
  readonly mainCharacterName: string | null
  readonly complianceState: PlatformReviewerTargetCompliance['state'] | null
  readonly complianceEvidenceFreshness: PlatformReviewerTargetCompliance['evidenceFreshness'] | null
  readonly complianceEvidenceAt: DatabaseDate
  readonly complianceReviewDeadline: DatabaseDate
  readonly complianceAccessValidUntil: DatabaseDate
  readonly complianceEvaluatedAt: DatabaseDate
  readonly blockedAt: DatabaseDate
  readonly disclosedCharacterCount: number | string
  readonly auditState: PlatformReviewerDirectoryAuditState
  readonly auditExpected: number | string
  readonly auditCovered: number | string
  readonly auditAsOf: DatabaseDate
  readonly sortValue: DirectorySortValue
}

type DatabaseDate = Date | string | null

async function searchManagedOrganizationDirectoryInTransaction(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  filters: NormalizedDirectoryFilters,
  now: Date,
): Promise<PlatformReviewerDirectoryPage> {
  const fingerprint = directoryFingerprint(filters)
  const cursorPosition = filters.cursor
    ? decodeDirectoryCursor(filters.cursor, organizationVersion, filters, fingerprint)
    : null
  if (!(await hasCurrentReviewerOrganizationSnapshot(transaction, organizationVersion, now))) {
    return unavailableDirectoryPage(organizationVersion)
  }

  const rows = await loadDirectoryPage(
    transaction,
    organizationVersion,
    filters,
    cursorPosition,
    now,
  )
  const page = rows.slice(0, filters.limit)
  const groupData = await loadDirectoryGroupData(
    transaction,
    organizationVersion,
    page.map(({ userId }) => userId),
    now,
  )
  if (!(await isCurrentDirectoryOrganizationVersion(transaction, organizationVersion))) {
    return unavailableDirectoryPage(organizationVersion)
  }

  return {
    groupFacets: groupData.facets,
    items: page.map((row) =>
      projectDirectoryRow(row, groupData.groupsByUserId.get(row.userId) ?? []),
    ),
    nextCursor:
      rows.length > filters.limit
        ? encodeDirectoryCursor(
            directoryCursorPosition(page.at(-1)!, filters.sort),
            organizationVersion,
            filters,
            fingerprint,
          )
        : null,
    organizationVersion,
    status: 'available',
  }
}

async function loadDirectoryPage(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  filters: NormalizedDirectoryFilters,
  cursorPosition: DirectoryCursorPosition | null,
  now: Date,
) {
  const sortExpression = directorySortExpression(filters.sort)
  const filterCondition = directoryFilterCondition(filters, organizationVersion, now)
  const cursorCondition = directoryCursorCondition(sortExpression, filters, cursorPosition)
  const direction = sql.raw(filters.direction)
  const classifierInput = JSON.stringify(
    createPlatformResourceClassifierInput(memberAuditDirectoryResources),
  )
  const rows = await transaction.execute<DirectoryDatabaseRow>(sql`
    with resource_classification as (
      select *
      from platform_classify_resources(
        ${classifierInput}::text::jsonb,
        ${now.toISOString()}::text::timestamptz,
        ${'member-audit'}::text,
        null::text,
        ${'character'}::text,
        null::uuid,
        null::text
      )
    ), disclosed_characters as (
      select
        member.user_id as target_user_id,
        member.managed_member_lifecycle_id,
        count(distinct lifecycle.subject_lifecycle_id)::integer as character_count
      from deployment_settings settings
      join organization_managed_member_lifecycles member
        on member.deployment_id = settings.id
        and member.organization_version = settings.organization_version
        and member.ended_at is null
      join characters character on character.user_id = member.user_id
      join platform_subject_lifecycles lifecycle
        on lifecycle.character_id = character.character_id
        and lifecycle.subject_kind = 'character'
      where settings.id = 1
        and settings.organization_version = ${organizationVersion}
        and (
          (
            character.affiliation_resolution_state = 'resolved'
            and character.affiliation_checked_at is not null
            and character.next_affiliation_check > ${now.toISOString()}::text::timestamptz
            and exists (
              select 1
              from organization_managed_corporations managed
              where managed.deployment_id = settings.id
                and managed.organization_version = settings.organization_version
                and managed.corporation_id = character.corporation_id
                and managed.is_current
            )
          ) or exists (
            select 1
            from organization_character_exceptions exception
            where exception.deployment_id = settings.id
              and exception.organization_version = settings.organization_version
              and exception.user_id = member.user_id
              and exception.character_id = character.character_id
              and exception.revoked_at is null
              and exception.expired_at is null
              and (
                exception.expires_at is null
                or exception.expires_at > ${now.toISOString()}::text::timestamptz
              )
          )
        )
      group by member.user_id, member.managed_member_lifecycle_id
    ), enabled_audit_resources as (
      select *
      from resource_classification
      where organization_version = ${organizationVersion}
        and target_user_id is not null
        and managed_member_lifecycle_id is not null
        and eligibility_status <> 'disabled'
    ), audit_summary as (
      select
        target_user_id,
        managed_member_lifecycle_id,
        count(*)::integer as expected,
        count(*) filter (where validated_at is not null)::integer as covered,
        case
          when bool_or(eligibility_status = 'authorization-required')
            then 'authorization-required'
          when bool_or(
            validated_at is null
            and (eligibility_status = 'suppressed' or last_failure_class is not null)
          ) then 'unavailable'
          when bool_or(validated_at is null) then 'never-collected'
          when bool_or(
            eligibility_status = 'suppressed'
            or last_failure_class is not null
            or due_reason is distinct from 'future'
          ) then 'stale'
          else 'current'
        end as state,
        case
          when count(*) = count(validated_at) then min(validated_at)
          else null
        end as as_of
      from enabled_audit_resources
      group by target_user_id, managed_member_lifecycle_id
    ), managed_affiliations as (
      select distinct on (character.user_id)
        character.user_id,
        member.managed_member_lifecycle_id,
        member.started_at as managed_since,
        account.created_at as site_registered_at,
        character.character_id,
        character.name as character_name,
        character.corporation_id,
        character.alliance_id,
        character.affiliation_checked_at
      from deployment_settings settings
      join organization_managed_member_lifecycles member
        on member.deployment_id = settings.id
        and member.organization_version = settings.organization_version
        and member.ended_at is null
      join users account on account.id = member.user_id
      join characters character on character.user_id = member.user_id
      join platform_subject_lifecycles lifecycle
        on lifecycle.character_id = character.character_id
        and lifecycle.subject_kind = 'character'
      join organization_managed_corporations managed
        on managed.deployment_id = settings.id
        and managed.organization_version = settings.organization_version
        and managed.corporation_id = character.corporation_id
        and managed.is_current
      where settings.id = 1
        and settings.organization_version = ${organizationVersion}
        and character.affiliation_resolution_state = 'resolved'
        and character.affiliation_checked_at is not null
        and character.next_affiliation_check > ${now.toISOString()}::text::timestamptz
      order by
        character.user_id,
        character.is_main desc,
        lower(character.name),
        character.character_id
    )
    select
      affiliation.user_id as "userId",
      affiliation.managed_member_lifecycle_id as "managedMemberLifecycleId",
      affiliation.managed_since as "managedSince",
      affiliation.site_registered_at as "siteRegisteredAt",
      affiliation.character_id as "characterId",
      affiliation.character_name as "characterName",
      affiliation.corporation_id as "corporationId",
      affiliation.alliance_id as "allianceId",
      affiliation.affiliation_checked_at as "affiliationCheckedAt",
      main_character.character_id as "mainCharacterId",
      main_character.name as "mainCharacterName",
      compliance.state as "complianceState",
      compliance.evidence_freshness as "complianceEvidenceFreshness",
      compliance.evidence_at as "complianceEvidenceAt",
      compliance.review_deadline as "complianceReviewDeadline",
      compliance.access_valid_until as "complianceAccessValidUntil",
      compliance.evaluated_at as "complianceEvaluatedAt",
      block.blocked_at as "blockedAt",
      coalesce(disclosed.character_count, 0)::integer as "disclosedCharacterCount",
      coalesce(audit.state, 'not-enabled') as "auditState",
      coalesce(audit.expected, 0)::integer as "auditExpected",
      coalesce(audit.covered, 0)::integer as "auditCovered",
      audit.as_of as "auditAsOf",
      ${sortExpression} as "sortValue"
    from managed_affiliations affiliation
    left join lateral (
      select character.character_id, character.name
      from characters character
      join platform_subject_lifecycles lifecycle
        on lifecycle.character_id = character.character_id
        and lifecycle.subject_kind = 'character'
      where character.user_id = affiliation.user_id
        and character.is_main
        and (
          (
            character.affiliation_resolution_state = 'resolved'
            and character.affiliation_checked_at is not null
            and character.next_affiliation_check > ${now.toISOString()}::text::timestamptz
            and exists (
              select 1
              from organization_managed_corporations managed
              where managed.deployment_id = 1
                and managed.organization_version = ${organizationVersion}
                and managed.corporation_id = character.corporation_id
                and managed.is_current
            )
          ) or exists (
            select 1
            from organization_character_exceptions exception
            where exception.deployment_id = 1
              and exception.organization_version = ${organizationVersion}
              and exception.user_id = affiliation.user_id
              and exception.character_id = character.character_id
              and exception.revoked_at is null
              and exception.expired_at is null
              and (
                exception.expires_at is null
                or exception.expires_at > ${now.toISOString()}::text::timestamptz
              )
          )
        )
      order by lower(character.name), character.character_id
      limit 1
    ) main_character on true
    left join organization_account_compliance compliance
      on compliance.deployment_id = 1
      and compliance.organization_version = ${organizationVersion}
      and compliance.user_id = affiliation.user_id
      and compliance.authoritative
    left join organization_member_blocks block
      on block.deployment_id = 1
      and block.organization_version = ${organizationVersion}
      and block.user_id = affiliation.user_id
      and block.unblocked_at is null
    left join disclosed_characters disclosed
      on disclosed.target_user_id = affiliation.user_id
      and disclosed.managed_member_lifecycle_id = affiliation.managed_member_lifecycle_id
    left join audit_summary audit
      on audit.target_user_id = affiliation.user_id
      and audit.managed_member_lifecycle_id = affiliation.managed_member_lifecycle_id
    where ${filterCondition}
      and ${cursorCondition}
    order by ${sortExpression} ${direction} nulls last, affiliation.user_id asc
    limit ${filters.limit + 1}
  `)
  return [...rows]
}

function directoryFilterCondition(
  filters: NormalizedDirectoryFilters,
  organizationVersion: number,
  now: Date,
) {
  const conditions: SQL[] = []
  if (filters.query) {
    conditions.push(directorySearchCondition(filters.query, organizationVersion, now))
  }
  if (filters.corporationId) {
    conditions.push(sql`affiliation.corporation_id = ${filters.corporationId}`)
  }
  if (filters.groupId) {
    conditions.push(sql`
      exists (
        select 1
        from organization_group_assignments assignment
        where assignment.deployment_id = 1
          and assignment.organization_version = ${organizationVersion}
          and assignment.user_id = affiliation.user_id
          and assignment.group_id = ${filters.groupId}::uuid
          and assignment.revoked_at is null
          and (
            assignment.expires_at is null
            or assignment.expires_at > ${now.toISOString()}::text::timestamptz
          )
      )
    `)
  }
  if (filters.complianceState) {
    if (filters.complianceState === 'pending') {
      conditions.push(sql`coalesce(compliance.state, 'pending') = 'pending'`)
    } else {
      conditions.push(sql`compliance.state = ${filters.complianceState}`)
    }
  }
  if (filters.blocked !== undefined) {
    conditions.push(filters.blocked ? sql`block.block_id is not null` : sql`block.block_id is null`)
  }
  if (filters.auditState) {
    conditions.push(sql`coalesce(audit.state, 'not-enabled') = ${filters.auditState}`)
  }
  return conditions.length > 0 ? sql.join(conditions, sql` and `) : sql`true`
}

function directorySearchCondition(query: string, organizationVersion: number, now: Date) {
  const characterId = parseCharacterId(query)
  const queryPattern = `%${escapeLikePattern(query)}%`
  const identityConditions: SQL[] = [sql`character.name ilike ${queryPattern}`]
  if (characterId) {
    identityConditions.push(sql`character.character_id = ${characterId}`)
  }
  const identityCondition = sql.join(identityConditions, sql` or `)
  const accountCondition = uuidPattern.test(query)
    ? sql`or affiliation.user_id = ${query}::uuid`
    : sql``
  return sql`
    (
      exists (
        select 1
        from characters character
        join platform_subject_lifecycles lifecycle
          on lifecycle.character_id = character.character_id
          and lifecycle.subject_kind = 'character'
        where character.user_id = affiliation.user_id
          and (${identityCondition})
          and (
            (
              character.affiliation_resolution_state = 'resolved'
              and character.affiliation_checked_at is not null
              and character.next_affiliation_check > ${now.toISOString()}::text::timestamptz
              and exists (
                select 1
                from organization_managed_corporations managed
                where managed.deployment_id = 1
                  and managed.organization_version = ${organizationVersion}
                  and managed.corporation_id = character.corporation_id
                  and managed.is_current
              )
            ) or exists (
              select 1
              from organization_character_exceptions exception
              where exception.deployment_id = 1
                and exception.organization_version = ${organizationVersion}
                and exception.user_id = affiliation.user_id
                and exception.character_id = character.character_id
                and exception.revoked_at is null
                and exception.expired_at is null
                and (
                  exception.expires_at is null
                  or exception.expires_at > ${now.toISOString()}::text::timestamptz
                )
            )
          )
      )
      ${accountCondition}
    )
  `
}

function directorySortExpression(sort: PlatformReviewerDirectorySortField): SQL {
  switch (sort) {
    case 'member':
      return sql`lower(coalesce(main_character.name, affiliation.character_name))`
    case 'corporation':
      return sql`affiliation.corporation_id::double precision`
    case 'managed_since':
      return sql`extract(epoch from affiliation.managed_since)::double precision`
    case 'audit_data':
      return sql`extract(epoch from audit.as_of)::double precision`
    case 'access_status':
      return sql`(
        case
          when block.block_id is not null then 4
          when compliance.state = 'suspended' then 3
          when compliance.state = 'review_required' then 2
          when compliance.state is null or compliance.state = 'pending' then 1
          else 0
        end
      )::double precision`
    case 'disclosed_characters':
      return sql`coalesce(disclosed.character_count, 0)::double precision`
    case 'affiliation_checked_at':
      return sql`extract(epoch from affiliation.affiliation_checked_at)::double precision`
    case 'site_registered_at':
      return sql`extract(epoch from affiliation.site_registered_at)::double precision`
    case 'review_deadline':
      return sql`extract(epoch from compliance.review_deadline)::double precision`
    case 'access_valid_until':
      return sql`extract(epoch from compliance.access_valid_until)::double precision`
    case 'blocked_since':
      return sql`extract(epoch from block.blocked_at)::double precision`
  }
}

function directoryCursorCondition(
  sortExpression: SQL,
  filters: NormalizedDirectoryFilters,
  position: DirectoryCursorPosition | null,
) {
  if (!position) {
    return sql`true`
  }
  if (position.sortValue === null) {
    return sql`${sortExpression} is null and affiliation.user_id > ${position.userId}::uuid`
  }

  const comparisons: SQL[] = [
    filters.direction === 'asc'
      ? sql`${sortExpression} > ${position.sortValue}`
      : sql`${sortExpression} < ${position.sortValue}`,
    sql`(${sortExpression} = ${position.sortValue} and affiliation.user_id > ${position.userId}::uuid)`,
  ]
  if (nullableDirectorySortFields.has(filters.sort)) {
    comparisons.push(sql`${sortExpression} is null`)
  }
  const comparisonCondition = sql.join(comparisons, sql` or `)
  return sql`(${comparisonCondition})`
}

async function loadDirectoryGroupData(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  userIds: readonly string[],
  now: Date,
) {
  const rows = await transaction
    .select({
      groupId: organizationGroups.groupId,
      name: organizationGroups.name,
      userId: organizationGroupAssignments.userId,
    })
    .from(organizationGroups)
    .leftJoin(
      organizationGroupAssignments,
      and(
        eq(organizationGroups.groupId, organizationGroupAssignments.groupId),
        eq(organizationGroups.deploymentId, organizationGroupAssignments.deploymentId),
        eq(
          organizationGroups.organizationVersion,
          organizationGroupAssignments.organizationVersion,
        ),
        userIds.length > 0
          ? inArray(organizationGroupAssignments.userId, [...userIds])
          : sql`false`,
        isNull(organizationGroupAssignments.revokedAt),
        or(
          isNull(organizationGroupAssignments.expiresAt),
          gt(organizationGroupAssignments.expiresAt, now),
        ),
      ),
    )
    .where(
      and(
        eq(organizationGroups.deploymentId, 1),
        eq(organizationGroups.organizationVersion, organizationVersion),
      ),
    )
    .orderBy(
      asc(organizationGroups.name),
      asc(organizationGroups.groupId),
      asc(organizationGroupAssignments.userId),
      asc(organizationGroupAssignments.assignmentId),
    )
  const facets: { groupId: string; name: string }[] = []
  const groupsByUserId = new Map<string, { groupId: string; name: string }[]>()
  for (const row of rows) {
    if (!facets.some(({ groupId }) => groupId === row.groupId)) {
      facets.push({ groupId: row.groupId, name: row.name })
    }
    if (!row.userId) {
      continue
    }
    const groups = groupsByUserId.get(row.userId) ?? []
    if (!groups.some(({ groupId }) => groupId === row.groupId)) {
      groups.push({ groupId: row.groupId, name: row.name })
    }
    groupsByUserId.set(row.userId, groups)
  }
  return { facets, groupsByUserId }
}

async function isCurrentDirectoryOrganizationVersion(
  transaction: DatabaseTransaction,
  organizationVersion: number,
) {
  const [current] = await transaction
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
  return current !== undefined
}

function projectDirectoryRow(
  row: DirectoryDatabaseRow,
  groups: readonly { readonly groupId: string; readonly name: string }[],
): PlatformReviewerDirectoryRow {
  const mainCharacter =
    row.mainCharacterId === null || row.mainCharacterName === null
      ? null
      : { characterId: databaseInteger(row.mainCharacterId), name: row.mainCharacterName }
  const managedAffiliation = {
    allianceId: row.allianceId === null ? null : databaseInteger(row.allianceId),
    characterId: databaseInteger(row.characterId),
    checkedAt: databaseDate(row.affiliationCheckedAt),
    corporationId: databaseInteger(row.corporationId),
    name: row.characterName,
  }
  return {
    account: { mainCharacter, userId: row.userId },
    auditData: {
      asOf: optionalDatabaseDate(row.auditAsOf),
      covered: databaseInteger(row.auditCovered),
      expected: databaseInteger(row.auditExpected),
      state: row.auditState,
    },
    block: row.blockedAt
      ? { blocked: true, blockedAt: databaseDate(row.blockedAt) }
      : { blocked: false },
    compliance: row.complianceState
      ? {
          state: row.complianceState,
          evidenceFreshness: row.complianceEvidenceFreshness!,
          evidenceAt: optionalDatabaseDate(row.complianceEvidenceAt),
          reviewDeadline: optionalDatabaseDate(row.complianceReviewDeadline),
          accessValidUntil: optionalDatabaseDate(row.complianceAccessValidUntil),
          evaluatedAt: optionalDatabaseDate(row.complianceEvaluatedAt),
        }
      : pendingCompliance,
    disclosedCharacterCount: databaseInteger(row.disclosedCharacterCount),
    groups,
    managedAffiliation,
    managedMemberLifecycleId: row.managedMemberLifecycleId,
    managedSince: databaseDate(row.managedSince),
    portraitCharacter: mainCharacter
      ? { ...mainCharacter, source: 'main-character' }
      : {
          characterId: managedAffiliation.characterId,
          name: managedAffiliation.name,
          source: 'managed-affiliation',
        },
    siteRegisteredAt: databaseDate(row.siteRegisteredAt),
  }
}

function normalizeDirectoryFilters(
  input: PlatformReviewerDirectoryInput,
): NormalizedDirectoryFilters {
  const query = input.query?.trim()
  validateSearchQuery(query)
  validateDirectoryFilterValues(input)
  const limit = input.limit ?? defaultPageSize
  validateDirectoryLimit(limit)
  validateSearchCursor(input.cursor)
  return {
    ...(query && { query }),
    ...(input.corporationId && { corporationId: input.corporationId }),
    ...(input.groupId && { groupId: input.groupId }),
    ...(input.complianceState && { complianceState: input.complianceState }),
    ...(input.blocked !== undefined && { blocked: input.blocked }),
    ...(input.auditState && { auditState: input.auditState }),
    sort: input.sort ?? platformReviewerDirectoryDefaultSortField,
    direction: input.direction ?? platformReviewerDirectoryDefaultSortDirection,
    ...(input.cursor && { cursor: input.cursor }),
    limit,
  }
}

function validateDirectoryFilterValues(input: PlatformReviewerDirectoryInput) {
  validateOptionalDirectoryFilter(input.corporationId, isPositiveCorporationId)
  validateOptionalDirectoryFilter(input.groupId, isDirectoryGroupId)
  validateOptionalDirectoryFilter(input.complianceState, isDirectoryComplianceState)
  validateOptionalDirectoryFilter(input.blocked, isBoolean)
  validateOptionalDirectoryFilter(input.auditState, isDirectoryAuditState)
  validateOptionalDirectoryFilter(input.sort, isDirectorySortField)
  validateOptionalDirectoryFilter(input.direction, isDirectorySortDirection)
}

function validateOptionalDirectoryFilter<T>(value: T | undefined, isValid: (value: T) => boolean) {
  if (value === undefined) {
    return
  }
  if (!isValid(value)) {
    invalidInput()
  }
}

function validateDirectoryLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageSize) {
    invalidInput()
  }
}

function isPositiveCorporationId(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

function isDirectoryGroupId(value: string) {
  return uuidPattern.test(value)
}

function isDirectoryComplianceState(value: PlatformReviewerTargetCompliance['state']) {
  return platformReviewerDirectoryComplianceStates.includes(value)
}

function isBoolean(value: boolean) {
  return typeof value === 'boolean'
}

function isDirectoryAuditState(value: PlatformReviewerDirectoryAuditState) {
  return platformReviewerDirectoryAuditStates.includes(value)
}

function isDirectorySortField(value: PlatformReviewerDirectorySortField) {
  return platformReviewerDirectorySortFields.includes(value)
}

function isDirectorySortDirection(value: PlatformReviewerDirectorySortDirection) {
  return platformReviewerDirectorySortDirections.includes(value)
}

function encodeDirectoryCursor(
  position: DirectoryCursorPosition,
  organizationVersion: number,
  filters: NormalizedDirectoryFilters,
  fingerprint: string,
) {
  const nonce = randomBytes(cursorNonceLength)
  const cipher = createCipheriv('aes-256-gcm', reviewerDirectoryCursorKey(), nonce)
  cipher.setAAD(directoryCursorAdditionalData)
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({
        d: filters.direction,
        f: fingerprint,
        o: organizationVersion,
        p: position.sortValue,
        s: filters.sort,
        u: position.userId,
        v: directoryCursorVersion,
      }),
    ),
    cipher.final(),
  ])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

function decodeDirectoryCursor(
  cursor: string,
  organizationVersion: number,
  filters: NormalizedDirectoryFilters,
  expectedFingerprint: string,
): DirectoryCursorPosition {
  const key = reviewerDirectoryCursorKey()
  try {
    const encoded = Buffer.from(cursor, 'base64url')
    if (
      encoded.length <= cursorNonceLength + cursorTagLength ||
      encoded.toString('base64url') !== cursor
    ) {
      invalidInput()
    }
    const nonce = encoded.subarray(0, cursorNonceLength)
    const tag = encoded.subarray(cursorNonceLength, cursorNonceLength + cursorTagLength)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(directoryCursorAdditionalData)
    decipher.setAuthTag(tag)
    const decoded: unknown = JSON.parse(
      Buffer.concat([
        decipher.update(encoded.subarray(cursorNonceLength + cursorTagLength)),
        decipher.final(),
      ]).toString('utf8'),
    )
    if (
      !isRecord(decoded) ||
      decoded.v !== directoryCursorVersion ||
      decoded.o !== organizationVersion ||
      decoded.s !== filters.sort ||
      decoded.d !== filters.direction ||
      typeof decoded.u !== 'string' ||
      !uuidPattern.test(decoded.u) ||
      decoded.f !== expectedFingerprint ||
      !isDirectoryCursorSortValue(decoded.p, filters.sort)
    ) {
      invalidInput()
    }
    return { sortValue: decoded.p, userId: decoded.u }
  } catch {
    return invalidInput()
  }
}

function directoryCursorPosition(
  row: DirectoryDatabaseRow,
  sort: PlatformReviewerDirectorySortField,
): DirectoryCursorPosition {
  const sortValue = row.sortValue === null ? null : normalizedDatabaseSortValue(row.sortValue, sort)
  return { sortValue, userId: row.userId }
}

function isDirectoryCursorSortValue(
  value: unknown,
  sort: PlatformReviewerDirectorySortField,
): value is DirectorySortValue {
  if (value === null) {
    return nullableDirectorySortFields.has(sort)
  }
  if (sort === 'member') {
    return typeof value === 'string' && value.length > 0 && value.length <= 512
  }
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizedDatabaseSortValue(
  value: string | number,
  sort: PlatformReviewerDirectorySortField,
) {
  if (sort === 'member') {
    if (typeof value !== 'string' || value.length === 0) {
      invalidInput()
    }
    return value
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    invalidInput()
  }
  return number
}

function reviewerDirectoryCursorKey() {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    throw new Error('Reviewer directory is unavailable.')
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64'),
      Buffer.alloc(0),
      directoryCursorAdditionalData,
      32,
    ),
  )
}

function directoryFingerprint(filters: NormalizedDirectoryFilters) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        a: filters.auditState ?? null,
        b: filters.blocked ?? null,
        c: filters.corporationId ?? null,
        cs: filters.complianceState ?? null,
        d: filters.direction,
        g: filters.groupId ?? null,
        l: filters.limit,
        q: filters.query ?? null,
        s: filters.sort,
      }),
    )
    .digest('base64url')
    .slice(0, 16)
}

function unavailableDirectoryPage(organizationVersion: number): PlatformReviewerDirectoryPage {
  return {
    groupFacets: [],
    items: [],
    nextCursor: null,
    organizationVersion,
    status: 'unavailable',
  }
}

function databaseInteger(value: number | string) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Reviewer directory returned an invalid integer')
  }
  return parsed
}

function databaseDate(value: DatabaseDate) {
  if (value === null) {
    throw new Error('Reviewer directory returned a missing date')
  }
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('Reviewer directory returned an invalid date')
  }
  return parsed.toISOString()
}

function optionalDatabaseDate(value: DatabaseDate) {
  return value === null ? null : databaseDate(value)
}

async function searchManagedOrganizationAccountsInTransaction(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  filters: NormalizedSearchFilters,
  now: Date,
): Promise<PlatformReviewerAccountSearchPage> {
  const cursorUserId = filters.cursor
    ? decodeCursor(filters.cursor, organizationVersion, searchFingerprint(filters))
    : null
  if (!(await hasCurrentReviewerOrganizationSnapshot(transaction, organizationVersion, now))) {
    return { items: [], nextCursor: null, organizationVersion, status: 'unavailable' }
  }

  const rows = await loadSearchPage(transaction, organizationVersion, filters, cursorUserId, now)
  const page = rows.slice(0, filters.limit)
  const mainCharacterByUserId = await loadPermittedMainCharacters(
    transaction,
    organizationVersion,
    page.map(({ userId }) => userId),
    now,
  )

  return {
    items: page.map((row) => projectSearchItem(row, mainCharacterByUserId.get(row.userId))),
    nextCursor:
      rows.length > filters.limit
        ? encodeCursor(page.at(-1)!.userId, organizationVersion, searchFingerprint(filters))
        : null,
    organizationVersion,
    status: 'available',
  }
}

function loadSearchPage(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  filters: NormalizedSearchFilters,
  cursorUserId: string | null,
  now: Date,
) {
  const conditions = [
    eq(deploymentSettings.id, 1),
    eq(deploymentSettings.organizationVersion, organizationVersion),
    eq(organizationManagedCorporations.isCurrent, true),
    eq(characters.affiliationResolutionState, 'resolved'),
    isNotNull(characters.affiliationCheckedAt),
    gt(characters.nextAffiliationCheck, now),
  ]
  if (cursorUserId) {
    conditions.push(gt(characters.userId, cursorUserId))
  }
  if (filters.corporationId) {
    conditions.push(eq(characters.corporationId, filters.corporationId))
  }
  if (filters.query) {
    const characterId = parseCharacterId(filters.query)
    conditions.push(
      or(
        ilike(characters.name, `%${escapeLikePattern(filters.query)}%`),
        ...(characterId ? [eq(characters.characterId, characterId)] : []),
        ...(uuidPattern.test(filters.query) ? [eq(characters.userId, filters.query)] : []),
      )!,
    )
  }
  if (filters.complianceState) {
    conditions.push(
      filters.complianceState === 'pending'
        ? or(
            eq(organizationAccountCompliance.state, 'pending'),
            isNull(organizationAccountCompliance.userId),
          )!
        : eq(organizationAccountCompliance.state, filters.complianceState),
    )
  }
  if (filters.blocked !== undefined) {
    conditions.push(
      filters.blocked
        ? isNotNull(organizationMemberBlocks.blockId)
        : isNull(organizationMemberBlocks.blockId),
    )
  }

  return transaction
    .selectDistinctOn([characters.userId], {
      affiliationCheckedAt: characters.affiliationCheckedAt,
      allianceId: characters.allianceId,
      blockedAt: organizationMemberBlocks.blockedAt,
      characterId: characters.characterId,
      characterName: characters.name,
      complianceAccessValidUntil: organizationAccountCompliance.accessValidUntil,
      complianceEvaluatedAt: organizationAccountCompliance.evaluatedAt,
      complianceEvidenceAt: organizationAccountCompliance.evidenceAt,
      complianceEvidenceFreshness: organizationAccountCompliance.evidenceFreshness,
      complianceReviewDeadline: organizationAccountCompliance.reviewDeadline,
      complianceState: organizationAccountCompliance.state,
      corporationId: characters.corporationId,
      managedMemberLifecycleId: organizationManagedMemberLifecycles.managedMemberLifecycleId,
      userId: characters.userId,
    })
    .from(deploymentSettings)
    .innerJoin(
      characters,
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .innerJoin(
      organizationManagedMemberLifecycles,
      and(
        eq(organizationManagedMemberLifecycles.deploymentId, deploymentSettings.id),
        eq(
          organizationManagedMemberLifecycles.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationManagedMemberLifecycles.userId, characters.userId),
        isNull(organizationManagedMemberLifecycles.endedAt),
      ),
    )
    .innerJoin(
      organizationManagedCorporations,
      and(
        eq(organizationManagedCorporations.deploymentId, deploymentSettings.id),
        eq(
          organizationManagedCorporations.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationManagedCorporations.corporationId, characters.corporationId),
      ),
    )
    .leftJoin(
      organizationAccountCompliance,
      and(
        eq(organizationAccountCompliance.deploymentId, deploymentSettings.id),
        eq(
          organizationAccountCompliance.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationAccountCompliance.userId, characters.userId),
        eq(organizationAccountCompliance.authoritative, true),
      ),
    )
    .leftJoin(
      organizationMemberBlocks,
      and(
        eq(organizationMemberBlocks.deploymentId, deploymentSettings.id),
        eq(organizationMemberBlocks.organizationVersion, deploymentSettings.organizationVersion),
        eq(organizationMemberBlocks.userId, characters.userId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .where(and(...conditions))
    .orderBy(
      asc(characters.userId),
      desc(characters.isMain),
      asc(characters.name),
      asc(characters.characterId),
    )
    .limit(filters.limit + 1)
}

async function loadPermittedMainCharacters(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  userIds: readonly string[],
  now: Date,
) {
  if (userIds.length === 0) {
    return new Map<string, { characterId: number; name: string }>()
  }
  const rows = await transaction
    .select({
      characterId: mainCharacters.characterId,
      name: mainCharacters.name,
      userId: mainCharacters.userId,
    })
    .from(deploymentSettings)
    .innerJoin(
      mainCharacters,
      and(eq(deploymentSettings.id, 1), inArray(mainCharacters.userId, [...userIds])),
    )
    .innerJoin(
      mainCharacterLifecycles,
      eq(mainCharacterLifecycles.characterId, mainCharacters.characterId),
    )
    .leftJoin(
      mainManagedCorporations,
      and(
        eq(mainManagedCorporations.deploymentId, deploymentSettings.id),
        eq(mainManagedCorporations.organizationVersion, deploymentSettings.organizationVersion),
        eq(mainManagedCorporations.corporationId, mainCharacters.corporationId),
        eq(mainManagedCorporations.isCurrent, true),
      ),
    )
    .leftJoin(
      mainCharacterExceptions,
      and(
        eq(mainCharacterExceptions.deploymentId, deploymentSettings.id),
        eq(mainCharacterExceptions.organizationVersion, deploymentSettings.organizationVersion),
        eq(mainCharacterExceptions.userId, mainCharacters.userId),
        eq(mainCharacterExceptions.characterId, mainCharacters.characterId),
        isNull(mainCharacterExceptions.revokedAt),
        isNull(mainCharacterExceptions.expiredAt),
        or(isNull(mainCharacterExceptions.expiresAt), gt(mainCharacterExceptions.expiresAt, now)),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.organizationVersion, organizationVersion),
        eq(mainCharacters.isMain, true),
        or(
          and(
            isNotNull(mainManagedCorporations.corporationId),
            eq(mainCharacters.affiliationResolutionState, 'resolved'),
            isNotNull(mainCharacters.affiliationCheckedAt),
            gt(mainCharacters.nextAffiliationCheck, now),
          ),
          isNotNull(mainCharacterExceptions.exceptionId),
        ),
      ),
    )
  return new Map(rows.map((row) => [row.userId, { characterId: row.characterId, name: row.name }]))
}

function projectSearchItem(
  row: Awaited<ReturnType<typeof loadSearchPage>>[number],
  mainCharacter: { characterId: number; name: string } | undefined,
): PlatformReviewerAccountSearchItem {
  return {
    account: { mainCharacter: mainCharacter ?? null, userId: row.userId },
    block: row.blockedAt
      ? { blocked: true, blockedAt: row.blockedAt.toISOString() }
      : { blocked: false },
    compliance: row.complianceState
      ? {
          state: row.complianceState,
          evidenceFreshness: row.complianceEvidenceFreshness!,
          evidenceAt: row.complianceEvidenceAt?.toISOString() ?? null,
          reviewDeadline: row.complianceReviewDeadline?.toISOString() ?? null,
          accessValidUntil: row.complianceAccessValidUntil?.toISOString() ?? null,
          evaluatedAt: row.complianceEvaluatedAt!.toISOString(),
        }
      : pendingCompliance,
    evidenceSections: [],
    managedAffiliation: {
      allianceId: row.allianceId,
      characterId: row.characterId,
      checkedAt: row.affiliationCheckedAt!.toISOString(),
      corporationId: row.corporationId,
      name: row.characterName,
    },
    managedMemberLifecycleId: row.managedMemberLifecycleId,
  }
}

interface NormalizedSearchFilters {
  readonly query?: string
  readonly corporationId?: number
  readonly complianceState?: PlatformReviewerTargetCompliance['state']
  readonly blocked?: boolean
  readonly cursor?: string
  readonly limit: number
}

function normalizeFilters(input: PlatformReviewerAccountSearchInput): NormalizedSearchFilters {
  const query = input.query?.trim()
  validateSearchQuery(query)
  if (
    input.corporationId !== undefined &&
    (!Number.isSafeInteger(input.corporationId) || input.corporationId <= 0)
  ) {
    invalidInput()
  }
  if (input.complianceState !== undefined && !complianceStates.has(input.complianceState)) {
    invalidInput()
  }
  if (input.blocked !== undefined && typeof input.blocked !== 'boolean') {
    invalidInput()
  }
  const limit = input.limit ?? defaultPageSize
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageSize) {
    invalidInput()
  }
  validateSearchCursor(input.cursor)
  return {
    ...(query && { query }),
    ...(input.corporationId && { corporationId: input.corporationId }),
    ...(input.complianceState && { complianceState: input.complianceState }),
    ...(input.blocked !== undefined && { blocked: input.blocked }),
    ...(input.cursor && { cursor: input.cursor }),
    limit,
  }
}

function validateSearchQuery(query: string | undefined) {
  if (query !== undefined && !isPlatformReviewerAccountSearchQuery(query)) {
    invalidInput()
  }
}

function validateSearchCursor(cursor: string | undefined) {
  if (cursor !== undefined && !isPlatformReviewerAccountSearchCursor(cursor)) {
    invalidInput()
  }
}

function encodeCursor(userId: string, organizationVersion: number, fingerprint: string) {
  const nonce = randomBytes(cursorNonceLength)
  const cipher = createCipheriv('aes-256-gcm', reviewerSearchCursorKey(), nonce)
  cipher.setAAD(cursorAdditionalData)
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({ f: fingerprint, o: organizationVersion, u: userId, v: cursorVersion }),
    ),
    cipher.final(),
  ])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

function decodeCursor(cursor: string, organizationVersion: number, expectedFingerprint: string) {
  const key = reviewerSearchCursorKey()
  try {
    const encoded = Buffer.from(cursor, 'base64url')
    if (
      encoded.length <= cursorNonceLength + cursorTagLength ||
      encoded.toString('base64url') !== cursor
    ) {
      invalidInput()
    }
    const nonce = encoded.subarray(0, cursorNonceLength)
    const tag = encoded.subarray(cursorNonceLength, cursorNonceLength + cursorTagLength)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(cursorAdditionalData)
    decipher.setAuthTag(tag)
    const decoded: unknown = JSON.parse(
      Buffer.concat([
        decipher.update(encoded.subarray(cursorNonceLength + cursorTagLength)),
        decipher.final(),
      ]).toString('utf8'),
    )
    if (
      !isRecord(decoded) ||
      decoded.v !== cursorVersion ||
      decoded.o !== organizationVersion ||
      typeof decoded.u !== 'string' ||
      !uuidPattern.test(decoded.u) ||
      decoded.f !== expectedFingerprint
    ) {
      invalidInput()
    }
    return decoded.u
  } catch {
    return invalidInput()
  }
}

function reviewerSearchCursorKey() {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    throw new Error('Reviewer account search is unavailable.')
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64'),
      Buffer.alloc(0),
      cursorAdditionalData,
      32,
    ),
  )
}

function searchFingerprint(filters: NormalizedSearchFilters) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        b: filters.blocked ?? null,
        c: filters.corporationId ?? null,
        q: filters.query ?? null,
        s: filters.complianceState ?? null,
      }),
    )
    .digest('base64url')
    .slice(0, 16)
}

function escapeLikePattern(value: string) {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`)
}

function parseCharacterId(value: string) {
  if (value.length > 16) {
    return null
  }
  for (const character of value) {
    if (character < '0' || character > '9') return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidInput(): never {
  throw new ReviewerAccountSearchInputError()
}
