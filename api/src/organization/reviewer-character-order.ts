import type {
  PlatformReviewerCharacterDirectorySortField,
  PlatformReviewerDirectorySortDirection,
} from '@eve-space/platform-module-contract/reviewer-directory'
import { sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import {
  ReviewerCharacterDirectoryInputError,
  type CharacterCursorPosition,
} from './reviewer-character-cursor.js'

const nullableFields = new Set<PlatformReviewerCharacterDirectorySortField>([
  'affiliation_checked_at',
  'audit_data',
  'review_deadline',
  'access_valid_until',
  'blocked_since',
])
const cursorText = z.string().min(1).max(255)
const cursorNumber = z.number()

const tieExpression = sql`(
  lower(character.character_name), character.character_id, character.user_id,
  character.managed_member_lifecycle_id, character.subject_lifecycle_id
)`

const tieValue = (position: CharacterCursorPosition) => sql`(
  ${position.characterName}::text, ${position.characterId}::bigint, ${position.userId}::uuid,
  ${position.managedMemberLifecycleId}::uuid, ${position.subjectLifecycleId}::uuid
)`

export const characterSortExpression = (sort: PlatformReviewerCharacterDirectorySortField): SQL => {
  switch (sort) {
    case 'character':
      return sql`lower(character.character_name)`
    case 'corporation':
      return sql`character.corporation_id::double precision`
    case 'managed_since':
      return sql`extract(epoch from character.managed_since)::double precision`
    case 'audit_data':
      return sql`extract(epoch from audit.as_of)::double precision`
    case 'access_status':
      return sql`(case
        when block.block_id is not null then 4
        when compliance.state = 'suspended' then 3
        when compliance.state = 'review_required' then 2
        when compliance.state is null or compliance.state = 'pending' then 1
        else 0
      end)::double precision`
    case 'disclosed_characters':
      return sql`character.disclosed_character_count::double precision`
    case 'affiliation_checked_at':
      return sql`extract(epoch from character.affiliation_checked_at)::double precision`
    case 'site_registered_at':
      return sql`extract(epoch from character.site_registered_at)::double precision`
    case 'review_deadline':
      return sql`extract(epoch from compliance.review_deadline)::double precision`
    case 'access_valid_until':
      return sql`extract(epoch from compliance.access_valid_until)::double precision`
    case 'blocked_since':
      return sql`extract(epoch from block.blocked_at)::double precision`
  }
}

export const characterCursorCondition = (
  sort: PlatformReviewerCharacterDirectorySortField,
  direction: PlatformReviewerDirectorySortDirection,
  position: CharacterCursorPosition | null,
) => {
  if (!position) return sql`true`
  if (
    sort === 'character'
      ? !cursorText.safeParse(position.value).success
      : position.value !== null && !cursorNumber.safeParse(position.value).success
  ) {
    throw new ReviewerCharacterDirectoryInputError()
  }
  if (position.value === null) {
    if (!nullableFields.has(sort)) throw new ReviewerCharacterDirectoryInputError()
    return sql`${characterSortExpression(sort)} is null and ${tieExpression} > ${tieValue(position)}`
  }
  const expression = characterSortExpression(sort)
  const comparison =
    direction === 'asc'
      ? sql`${expression} > ${position.value}`
      : sql`${expression} < ${position.value}`
  const clauses: SQL[] = [
    comparison,
    sql`(${expression} = ${position.value} and ${tieExpression} > ${tieValue(position)})`,
  ]
  if (nullableFields.has(sort)) clauses.push(sql`${expression} is null`)
  const cursorClauses = sql.join(clauses, sql` or `)
  return sql`(${cursorClauses})`
}

export const characterOrderClause = (
  sort: PlatformReviewerCharacterDirectorySortField,
  direction: PlatformReviewerDirectorySortDirection,
) => sql`${characterSortExpression(sort)} ${sql.raw(direction)} nulls last,
  lower(character.character_name), character.character_id, character.user_id,
  character.managed_member_lifecycle_id, character.subject_lifecycle_id`

export const normalizedCharacterSortValue = (
  raw: string | number | null,
  sort: PlatformReviewerCharacterDirectorySortField,
) => {
  if (raw === null) {
    if (!nullableFields.has(sort)) throw new ReviewerCharacterDirectoryInputError()
    return null
  }
  if (sort === 'character') {
    const parsed = cursorText.safeParse(raw)
    if (!parsed.success) throw new ReviewerCharacterDirectoryInputError()
    return parsed.data
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new ReviewerCharacterDirectoryInputError()
  return value
}
