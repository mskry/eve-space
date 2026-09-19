import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import {
  isPlatformReviewerAccountSearchCursor,
  isPlatformReviewerAccountSearchQuery,
  type PlatformReviewerAccountSearchInput,
  type PlatformReviewerAccountSearchItem,
  type PlatformReviewerAccountSearchPage,
  type PlatformReviewerTargetCompliance,
} from '@eve-space/platform-module-contract/server'
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationAccountCompliance,
  organizationCharacterExceptions,
  organizationManagedCorporations,
  organizationManagedMemberLifecycles,
  organizationMemberBlocks,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { env } from '../env.js'
import { hasCurrentReviewerOrganizationSnapshot } from './reviewer-organization-snapshot.js'

const defaultPageSize = 25
const maximumPageSize = 50
const cursorVersion = 1
const cursorNonceLength = 12
const cursorTagLength = 16
const cursorAdditionalData = Buffer.from('eve-space:reviewer-account-search:v1')
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
  state: 'pending',
  evidenceFreshness: 'unavailable',
  evidenceAt: null,
  reviewDeadline: null,
  accessValidUntil: null,
  evaluatedAt: null,
}

export interface OrganizationReviewerDirectoryItem {
  readonly managedMemberLifecycleId: string
  readonly account: PlatformReviewerAccountSearchItem['account']
  readonly managedAffiliation: PlatformReviewerAccountSearchItem['managedAffiliation']
}

export interface OrganizationReviewerDirectoryPage {
  readonly organizationVersion: number
  readonly status: PlatformReviewerAccountSearchPage['status']
  readonly items: readonly OrganizationReviewerDirectoryItem[]
  readonly nextCursor: string | null
}

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
  readonly filters: Pick<
    PlatformReviewerAccountSearchInput,
    'query' | 'corporationId' | 'cursor' | 'limit'
  >
  readonly now?: Date
}): Promise<OrganizationReviewerDirectoryPage> {
  const page = await searchManagedOrganizationAccounts(input)
  return {
    organizationVersion: page.organizationVersion,
    status: page.status,
    items: page.items.map(({ managedMemberLifecycleId, account, managedAffiliation }) => ({
      managedMemberLifecycleId,
      account,
      managedAffiliation,
    })),
    nextCursor: page.nextCursor,
  }
}

export class ReviewerAccountSearchInputError extends TypeError {
  constructor() {
    super('Invalid reviewer account search input.')
    this.name = 'ReviewerAccountSearchInputError'
  }
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
  if (!(await hasCurrentReviewerOrganizationSnapshot(transaction, organizationVersion, now)))
    return { organizationVersion, status: 'unavailable', items: [], nextCursor: null }

  const rows = await loadSearchPage(transaction, organizationVersion, filters, cursorUserId, now)
  const page = rows.slice(0, filters.limit)
  const mainCharacterByUserId = await loadPermittedMainCharacters(
    transaction,
    organizationVersion,
    page.map(({ userId }) => userId),
    now,
  )

  return {
    organizationVersion,
    status: 'available',
    items: page.map((row) => projectSearchItem(row, mainCharacterByUserId.get(row.userId))),
    nextCursor:
      rows.length > filters.limit
        ? encodeCursor(page.at(-1)!.userId, organizationVersion, searchFingerprint(filters))
        : null,
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
  if (cursorUserId) conditions.push(gt(characters.userId, cursorUserId))
  if (filters.corporationId) conditions.push(eq(characters.corporationId, filters.corporationId))
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
  if (filters.complianceState)
    conditions.push(
      filters.complianceState === 'pending'
        ? or(
            eq(organizationAccountCompliance.state, 'pending'),
            isNull(organizationAccountCompliance.userId),
          )!
        : eq(organizationAccountCompliance.state, filters.complianceState),
    )
  if (filters.blocked !== undefined)
    conditions.push(
      filters.blocked
        ? isNotNull(organizationMemberBlocks.blockId)
        : isNull(organizationMemberBlocks.blockId),
    )

  return transaction
    .selectDistinctOn([characters.userId], {
      userId: characters.userId,
      managedMemberLifecycleId: organizationManagedMemberLifecycles.managedMemberLifecycleId,
      characterId: characters.characterId,
      characterName: characters.name,
      corporationId: characters.corporationId,
      allianceId: characters.allianceId,
      affiliationCheckedAt: characters.affiliationCheckedAt,
      complianceState: organizationAccountCompliance.state,
      complianceEvidenceFreshness: organizationAccountCompliance.evidenceFreshness,
      complianceEvidenceAt: organizationAccountCompliance.evidenceAt,
      complianceReviewDeadline: organizationAccountCompliance.reviewDeadline,
      complianceAccessValidUntil: organizationAccountCompliance.accessValidUntil,
      complianceEvaluatedAt: organizationAccountCompliance.evaluatedAt,
      blockedAt: organizationMemberBlocks.blockedAt,
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
  if (userIds.length === 0) return new Map<string, { characterId: number; name: string }>()
  const rows = await transaction
    .select({
      userId: mainCharacters.userId,
      characterId: mainCharacters.characterId,
      name: mainCharacters.name,
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
    managedMemberLifecycleId: row.managedMemberLifecycleId,
    account: { userId: row.userId, mainCharacter: mainCharacter ?? null },
    managedAffiliation: {
      characterId: row.characterId,
      name: row.characterName,
      corporationId: row.corporationId,
      allianceId: row.allianceId,
      checkedAt: row.affiliationCheckedAt!.toISOString(),
    },
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
    block: row.blockedAt
      ? { blocked: true, blockedAt: row.blockedAt.toISOString() }
      : { blocked: false },
    evidenceSections: [],
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
  )
    invalidInput()
  if (input.complianceState !== undefined && !complianceStates.has(input.complianceState))
    invalidInput()
  if (input.blocked !== undefined && typeof input.blocked !== 'boolean') invalidInput()
  const limit = input.limit ?? defaultPageSize
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageSize) invalidInput()
  validateSearchCursor(input.cursor)
  return {
    ...(query ? { query } : {}),
    ...(input.corporationId ? { corporationId: input.corporationId } : {}),
    ...(input.complianceState ? { complianceState: input.complianceState } : {}),
    ...(input.blocked === undefined ? {} : { blocked: input.blocked }),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    limit,
  }
}

function validateSearchQuery(query: string | undefined) {
  if (query !== undefined && !isPlatformReviewerAccountSearchQuery(query)) invalidInput()
}

function validateSearchCursor(cursor: string | undefined) {
  if (cursor !== undefined && !isPlatformReviewerAccountSearchCursor(cursor)) invalidInput()
}

function encodeCursor(userId: string, organizationVersion: number, fingerprint: string) {
  const nonce = randomBytes(cursorNonceLength)
  const cipher = createCipheriv('aes-256-gcm', reviewerSearchCursorKey(), nonce)
  cipher.setAAD(cursorAdditionalData)
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({ v: cursorVersion, o: organizationVersion, u: userId, f: fingerprint }),
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
    )
      invalidInput()
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
    )
      invalidInput()
    return decoded.u
  } catch {
    return invalidInput()
  }
}

function reviewerSearchCursorKey() {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error('Reviewer account search is unavailable.')
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
        q: filters.query ?? null,
        c: filters.corporationId ?? null,
        s: filters.complianceState ?? null,
        b: filters.blocked ?? null,
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
  if (value.length > 16) return null
  for (const character of value) if (character < '0' || character > '9') return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidInput(): never {
  throw new ReviewerAccountSearchInputError()
}
