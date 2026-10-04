import type { PlatformCorporationInventorySubject } from '@eve-space/platform-module-contract/inventory'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import type { CorporationInventoryScope } from '../organization/inventory-admission.js'
import { inventoryAssetsScope } from '../inventory-policy.js'
import { createPlatformResourceClassifierInput } from './resource-classifier-input.js'
import { platformResources } from './resources.js'

export interface CorporationInventorySubject extends PlatformCorporationInventorySubject {
  readonly characterName: string
  readonly affiliationPeriodRevision: string
  readonly coverage: 'authorization-required' | 'unavailable' | null
  readonly pendingAttemptId: string | null
}

interface SourceAuthorityRow extends Record<string, unknown> {
  readonly characterId: number
  readonly authorizationRevision: number
  readonly disclosureRevision: number
  readonly sectionActivationRevision: number
  readonly eligibilityStatus: string
  readonly pendingAttemptId: string | null
  readonly validatedAt: string | null
  readonly lastFailureClass: string | null
  readonly dueReason: string | null
}

const bindInventoryCollection = (row: SourceAuthorityRow, intervalSeconds: number) => {
  let state: NonNullable<PlatformCorporationInventorySubject['collection']>['state'] =
    'never-collected'
  if (row.lastFailureClass) state = 'unavailable'
  if (row.validatedAt) {
    state = row.dueReason !== 'future' || row.lastFailureClass ? 'stale' : 'current'
  }
  return Object.freeze({
    state,
    validatedAt: row.validatedAt ? new Date(row.validatedAt).toISOString() : null,
    freshUntil: row.validatedAt
      ? new Date(new Date(row.validatedAt).getTime() + intervalSeconds * 1000).toISOString()
      : null,
    lastFailureClass: row.lastFailureClass,
  })
}

export const loadCorporationInventorySourceSubjects = async (scope: CorporationInventoryScope) => {
  if (scope.subjects.length === 0) return []
  const resource = platformResources.find(
    (candidate) =>
      candidate.moduleId === 'member-audit' &&
      candidate.sectionId === 'assets' &&
      candidate.resourceId === 'assets',
  )
  if (resource?.eligibility.kind !== 'current-managed-member-character') {
    throw new Error('Inventory source declaration is unavailable')
  }
  const classifierInput = createPlatformResourceClassifierInput([resource])
  if (classifierInput[0]?.required_scope !== inventoryAssetsScope)
    throw new Error('Inventory assets scope is unavailable')
  const rows = await db.execute<SourceAuthorityRow>(sql`
    with selected as (select * from jsonb_to_recordset(${JSON.stringify(scope.subjects)}::jsonb)
      as subject("characterId" bigint, "characterLifecycle" uuid, "userId" uuid, "memberLifecycle" uuid))
    select selected."characterId"::float8 as "characterId",
      coalesce(classified.expected_authorization_generation, 0) as "authorizationRevision",
      classified.disclosure_version as "disclosureRevision",
      classified.section_activation_version as "sectionActivationRevision",
      classified.eligibility_status as "eligibilityStatus", pending.attempt_id as "pendingAttemptId",
      classified.validated_at as "validatedAt", classified.last_failure_class as "lastFailureClass",
      classified.due_reason as "dueReason"
    from selected
    join lateral platform_classify_resources(
      ${JSON.stringify(classifierInput)}::jsonb, now(),
      'member-audit', 'assets', 'character', selected."characterLifecycle", selected."characterId"::text
    ) classified on classified.organization_version = ${scope.organization.organizationVersion}
      and classified.target_user_id = selected."userId"
      and classified.managed_member_lifecycle_id = selected."memberLifecycle"
    left join pending_character_tokens pending on pending.character_id = selected."characterId"
      and pending.user_id = selected."userId" and pending.subject_lifecycle_id = selected."characterLifecycle"
      and pending.base_token_version = classified.expected_authorization_generation
  `)
  const byCharacter = new Map(rows.map((row) => [row.characterId, row]))
  if (rows.length !== scope.subjects.length || byCharacter.size !== rows.length)
    throw new Error('Inventory source authority changed')
  return scope.subjects.map((subject): CorporationInventorySubject => {
    const row = byCharacter.get(subject.characterId)!
    let coverage: CorporationInventorySubject['coverage'] = null
    if (row.eligibilityStatus === 'authorization-required') coverage = 'authorization-required'
    else if (!['eligible', 'suppressed'].includes(row.eligibilityStatus) || row.pendingAttemptId)
      coverage = 'unavailable'
    return Object.freeze({
      ...subject,
      authorizationRevision: row.authorizationRevision,
      authorizationGeneration: row.authorizationRevision,
      disclosureRevision: row.disclosureRevision,
      sectionActivationRevision: row.sectionActivationRevision,
      pendingAttemptId: row.pendingAttemptId,
      evidenceReadable: coverage === null,
      coverage,
      observationId: null,
      collection: bindInventoryCollection(row, resource.materializationIntervalSeconds),
    })
  })
}
