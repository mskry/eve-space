import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type {
  PlatformCollectionFailureClass,
  PlatformCollectionStateIdentity,
} from '../../platform/collection-state.js'
import { characters } from './identity.js'
import { organizationEpochs } from './organization-epochs.js'
import {
  organizationCorporationSources,
  organizationManagedMemberLifecycles,
} from './organization.js'
import { auditTimestamps } from './shared.js'

// The deployment_* tables here are module-scoped despite the prefix: installed
// module settings and the navigation order owned by 'core' or by a module.

const subjectKindCheck = (name: string) =>
  check(
    name,
    sql`subject_kind in ('deployment', 'corporation', 'alliance') or is_character_subject_kind(subject_kind)`,
  )

const subjectIdCheck = (name: string) =>
  check(name, sql`subject_id <> '' and subject_id = trim(subject_id)`)

export const deploymentModules = pgTable(
  'deployment_modules',
  {
    enabled: boolean().default(false).notNull(),
    moduleId: text('module_id').primaryKey().notNull(),
    ...auditTimestamps(),
  },
  () => [
    check(
      'deployment_modules_module_id_check',
      sql`module_id = 'core' or is_valid_module_id(module_id)`,
    ),
    check('deployment_modules_core_enabled_check', sql`module_id <> 'core' or enabled`),
  ],
)

export const deploymentModuleSections = pgTable(
  'deployment_module_sections',
  {
    activationVersion: integer('activation_version').default(0).notNull(),
    declarationRevision: integer('declaration_revision'),
    disclosureVersion: integer('disclosure_version').default(0).notNull(),
    enabled: boolean().default(false).notNull(),
    kind: text().$type<'workspace' | 'sensitive-evidence' | 'access-management'>().notNull(),
    moduleId: text('module_id').notNull(),
    sectionId: text('section_id').notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    primaryKey({
      columns: [table.moduleId, table.sectionId],
      name: 'deployment_module_sections_pkey',
    }),
    foreignKey({
      columns: [table.moduleId],
      foreignColumns: [deploymentModules.moduleId],
      name: 'deployment_module_sections_module_id_fkey',
    }).onDelete('cascade'),
    check(
      'deployment_module_sections_module_id_check',
      sql`is_valid_module_id(module_id) and module_id <> 'core'`,
    ),
    check(
      'deployment_module_sections_section_id_check',
      sql`is_valid_platform_identifier(section_id)`,
    ),
    check(
      'deployment_module_sections_kind_check',
      sql`kind in ('workspace', 'sensitive-evidence', 'access-management')`,
    ),
    check(
      'deployment_module_sections_versions_check',
      sql`disclosure_version >= 0 and activation_version >= 0`,
    ),
    check(
      'deployment_module_sections_disclosure_check',
      sql`(kind = 'sensitive-evidence' and declaration_revision is not null and declaration_revision > 0) or (kind <> 'sensitive-evidence' and declaration_revision is null and disclosure_version = 0)`,
    ),
  ],
)

export const deploymentShellNavigationOrder = pgTable(
  'deployment_shell_navigation_order',
  {
    navigationId: text('navigation_id').notNull(),
    ownerId: text('owner_id').notNull(),
    position: integer().notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    primaryKey({
      columns: [table.ownerId, table.navigationId],
      name: 'deployment_shell_navigation_order_pkey',
    }),
    check(
      'deployment_shell_navigation_order_owner_id_check',
      sql`owner_id = 'core' or (is_valid_platform_identifier(owner_id) and length(owner_id) <= 44 and owner_id <> 'platform')`,
    ),
    check(
      'deployment_shell_navigation_order_navigation_id_check',
      sql`is_valid_platform_identifier(navigation_id)`,
    ),
    check('deployment_shell_navigation_order_position_check', sql`position >= 0`),
  ],
)

export const platformSubjectLifecycles = pgTable(
  'platform_subject_lifecycles',
  {
    characterId: bigint('character_id', { mode: 'number' }),
    corporationSourceId: uuid('corporation_source_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    organizationDeploymentId: integer('organization_deployment_id'),
    organizationVersion: bigint('organization_version', { mode: 'number' }),
    subjectId: text('subject_id').notNull(),
    subjectKind: text('subject_kind')
      .$type<PlatformCollectionStateIdentity['subjectKind']>()
      .notNull(),
    subjectLifecycleId: uuid('subject_lifecycle_id').defaultRandom().primaryKey().notNull(),
  },
  (table) => [
    uniqueIndex('platform_subject_lifecycles_character_id_key').on(table.characterId),
    uniqueIndex('platform_subject_lifecycles_organization_epoch_key').on(
      table.subjectKind,
      table.organizationDeploymentId,
      table.organizationVersion,
    ),
    uniqueIndex('platform_subject_lifecycles_corporation_source_id_key').on(
      table.corporationSourceId,
    ),
    uniqueIndex('platform_subject_lifecycles_subject_kind_lifecycle_subject_id_key').on(
      table.subjectKind,
      table.subjectLifecycleId,
      table.subjectId,
    ),
    foreignKey({
      columns: [table.characterId],
      foreignColumns: [characters.characterId],
      name: 'platform_subject_lifecycles_character_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationDeploymentId, table.organizationVersion],
      foreignColumns: [organizationEpochs.deploymentId, organizationEpochs.organizationVersion],
      name: 'platform_subject_lifecycles_organization_epoch_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.corporationSourceId],
      foreignColumns: [organizationCorporationSources.sourceId],
      name: 'platform_subject_lifecycles_corporation_source_id_fkey',
    }).onDelete('restrict'),
    subjectKindCheck('platform_subject_lifecycles_subject_kind_check'),
    subjectIdCheck('platform_subject_lifecycles_subject_id_check'),
    check(
      'platform_subject_lifecycles_binding_check',
      sql`(is_character_subject_kind(subject_kind) and character_id is not null and subject_id = character_id::text and organization_deployment_id is null and organization_version is null and corporation_source_id is null) or (subject_kind = 'alliance' and character_id is null and organization_deployment_id is not null and organization_version is not null and corporation_source_id is null) or (subject_kind = 'corporation' and character_id is null and organization_deployment_id is null and organization_version is null and corporation_source_id is not null) or (subject_kind = 'deployment' and character_id is null and subject_id = organization_deployment_id::text and organization_deployment_id is not null and organization_version is not null and corporation_source_id is null)`,
    ),
  ],
)

export const platformCollectionState = pgTable(
  'platform_collection_state',
  {
    authorizationGeneration: integer('authorization_generation'),
    disclosureVersion: integer('disclosure_version'),
    failureStartedAt: timestamp('failure_started_at', { withTimezone: true, mode: 'date' }),
    lastFailureClass: text('last_failure_class').$type<PlatformCollectionFailureClass>(),
    managedMemberLifecycleId: uuid('managed_member_lifecycle_id'),
    moduleId: text('module_id').notNull(),
    nextEligibleAt: timestamp('next_eligible_at', { withTimezone: true, mode: 'date' }),
    organizationDeploymentId: integer('organization_deployment_id'),
    organizationVersion: bigint('organization_version', { mode: 'number' }),
    resourceId: text('resource_id').notNull(),
    sectionActivationVersion: integer('section_activation_version'),
    sectionId: text('section_id'),
    subjectId: text('subject_id').notNull(),
    subjectKind: text('subject_kind')
      .$type<PlatformCollectionStateIdentity['subjectKind']>()
      .notNull(),
    subjectLifecycleId: uuid('subject_lifecycle_id').notNull(),
    targetUserId: uuid('target_user_id'),
    validatedAt: timestamp('validated_at', { withTimezone: true, mode: 'date' }),
    ...auditTimestamps(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.moduleId,
        table.resourceId,
        table.subjectKind,
        table.subjectLifecycleId,
        table.subjectId,
      ],
      name: 'platform_collection_state_pkey',
    }),
    foreignKey({
      columns: [table.moduleId],
      foreignColumns: [deploymentModules.moduleId],
      name: 'platform_collection_state_module_id_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.subjectKind, table.subjectLifecycleId, table.subjectId],
      foreignColumns: [
        platformSubjectLifecycles.subjectKind,
        platformSubjectLifecycles.subjectLifecycleId,
        platformSubjectLifecycles.subjectId,
      ],
      name: 'platform_collection_state_subject_lifecycle_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [
        table.managedMemberLifecycleId,
        table.organizationDeploymentId,
        table.organizationVersion,
        table.targetUserId,
      ],
      foreignColumns: [
        organizationManagedMemberLifecycles.managedMemberLifecycleId,
        organizationManagedMemberLifecycles.deploymentId,
        organizationManagedMemberLifecycles.organizationVersion,
        organizationManagedMemberLifecycles.userId,
      ],
      name: 'platform_collection_state_managed_member_lifecycle_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.moduleId, table.sectionId],
      foreignColumns: [deploymentModuleSections.moduleId, deploymentModuleSections.sectionId],
      name: 'platform_collection_state_section_fkey',
    }).onDelete('restrict'),
    index('platform_collection_state_due_idx')
      .on(
        table.nextEligibleAt,
        table.moduleId,
        table.resourceId,
        table.subjectKind,
        table.subjectLifecycleId,
        table.subjectId,
      )
      .where(sql`next_eligible_at is not null`),
    index('platform_collection_state_subject_lifecycle_idx').on(
      table.subjectKind,
      table.subjectLifecycleId,
      table.subjectId,
    ),
    check(
      'platform_collection_state_module_id_check',
      sql`module_id = 'core' or is_valid_module_id(module_id)`,
    ),
    check(
      'platform_collection_state_resource_id_check',
      sql`is_valid_platform_identifier(resource_id)`,
    ),
    subjectKindCheck('platform_collection_state_subject_kind_check'),
    subjectIdCheck('platform_collection_state_subject_id_check'),
    check(
      'platform_collection_state_authorization_generation_check',
      sql`authorization_generation is null or authorization_generation >= 0`,
    ),
    check(
      'platform_collection_state_managed_authority_check',
      sql`(
        organization_deployment_id is null and organization_version is null
        and target_user_id is null and managed_member_lifecycle_id is null
        and section_id is null and disclosure_version is null
        and section_activation_version is null
      ) or (
        organization_deployment_id is not null and organization_version is not null
        and target_user_id is not null and managed_member_lifecycle_id is not null
        and section_id is not null and disclosure_version is not null
        and disclosure_version > 0 and section_activation_version is not null
        and section_activation_version > 0 and authorization_generation is not null
      )`,
    ),
    check(
      'platform_collection_state_last_failure_class_check',
      sql`last_failure_class is null or last_failure_class in ('authorization-required', 'esi-cooldown', 'esi-unavailable', 'response-invalid', 'mapping-failed', 'persistence-failed', 'unknown')`,
    ),
    check(
      'platform_collection_state_failure_started_at_check',
      sql`(last_failure_class is null and failure_started_at is null) or (last_failure_class is not null and failure_started_at is not null)`,
    ),
  ],
)

export const platformResourcePurgeWork = pgTable(
  'platform_resource_purge_work',
  {
    authorizationGeneration: integer('authorization_generation'),
    characterId: bigint('character_id', { mode: 'number' }),
    characterLifecycleId: uuid('character_lifecycle_id'),
    disclosureVersion: integer('disclosure_version'),
    managedMemberLifecycleId: uuid('managed_member_lifecycle_id'),
    mode: text().$type<'account' | 'authority'>().notNull(),
    moduleId: text('module_id').notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }),
    purgeWorkId: uuid('purge_work_id').defaultRandom().primaryKey().notNull(),
    resourceId: text('resource_id').notNull(),
    sectionActivationVersion: integer('section_activation_version'),
    targetUserId: uuid('target_user_id').notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    foreignKey({
      columns: [table.moduleId],
      foreignColumns: [deploymentModules.moduleId],
      name: 'platform_resource_purge_work_module_id_fkey',
    }).onDelete('restrict'),
    index('platform_resource_purge_work_resource_idx').on(
      table.moduleId,
      table.resourceId,
      table.createdAt,
    ),
    check('platform_resource_purge_work_mode_check', sql`mode in ('account', 'authority')`),
    check(
      'platform_resource_purge_work_identity_check',
      sql`(
        mode = 'account'
        and organization_version is null
        and managed_member_lifecycle_id is null
        and character_id is null
        and character_lifecycle_id is null
        and authorization_generation is null
        and disclosure_version is null
        and section_activation_version is null
      ) or (
        mode = 'authority'
        and organization_version is not null and organization_version > 0
        and managed_member_lifecycle_id is not null
        and character_id is not null and character_id > 0
        and character_lifecycle_id is not null
        and authorization_generation is not null and authorization_generation >= 0
        and disclosure_version is not null and disclosure_version > 0
        and section_activation_version is not null and section_activation_version > 0
      )`,
    ),
  ],
)

export type PlatformCollectionStateRow = typeof platformCollectionState.$inferSelect
