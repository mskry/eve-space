import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'

const ownerEvidenceMocks = vi.hoisted(() => ({
  getCharacterCorporationRolesEvidence: vi.fn(),
  observeAndPersistCharacterAffiliation: vi.fn(),
}))

vi.mock('../../../src/characters/affiliation-sync.js', () => ({
  observeAndPersistCharacterAffiliation: ownerEvidenceMocks.observeAndPersistCharacterAffiliation,
}))
vi.mock('../../../src/characters/corporation-roles.js', () => ({
  characterCorporationRolesScope: 'esi-characters.read_corporation_roles.v1',
  getCharacterCorporationRolesEvidence: ownerEvidenceMocks.getCharacterCorporationRolesEvidence,
}))

let container: StartedTestContainer
let connection: postgres.Sql
let secondConnection: postgres.Sql
let updateDeploymentOrganization: typeof import('../../../src/admin/store.js').updateDeploymentOrganization
let claimOrganizationOwnership: typeof import('../../../src/organization/owner-claim.js').claimOrganizationOwnership
let refreshOrganizationOwnerEvidence: typeof import('../../../src/organization/owner-evidence.js').refreshOrganizationOwnerEvidence
let selectDueOrganizationOwnerEvidence: typeof import('../../../src/organization/owner-evidence.js').selectDueOrganizationOwnerEvidence
let refreshDerivedDirectorAuthority: typeof import('../../../src/organization/derived-authority.js').refreshDerivedDirectorAuthority
let assignOrganizationGroup: typeof import('../../../src/organization/group-store.js').assignOrganizationGroup
let hasCurrentOrganizationManagerAuthority: typeof import('../../../src/organization/management-authority.js').hasCurrentOrganizationManagerAuthority
let convergeRegistrationComplianceGroupAssignment: typeof import('../../../src/organization/group-compliance.js').convergeRegistrationComplianceGroupAssignment
let createOrganizationGroup: typeof import('../../../src/organization/group-store.js').createOrganizationGroup
let createOrganizationPermissionBundle: typeof import('../../../src/organization/group-store.js').createOrganizationPermissionBundle
let listCurrentOrganizationPermissionBundles: typeof import('../../../src/organization/group-store.js').listCurrentOrganizationPermissionBundles
let updateOrganizationPermissionBundle: typeof import('../../../src/organization/group-store.js').updateOrganizationPermissionBundle
let getOrganizationGroupPermissions: typeof import('../../../src/organization/group-permissions.js').getOrganizationGroupPermissions
let revokeOrganizationGroupAssignment: typeof import('../../../src/organization/group-store.js').revokeOrganizationGroupAssignment
let blockOrganizationMember: typeof import('../../../src/organization/block-store.js').blockOrganizationMember
let hasCurrentOrganizationMemberBlock: typeof import('../../../src/organization/block-store.js').hasCurrentOrganizationMemberBlock
let unblockOrganizationMember: typeof import('../../../src/organization/block-store.js').unblockOrganizationMember
let grantOrganizationRole: typeof import('../../../src/organization/role-store.js').grantOrganizationRole
let getOrganizationAccessContext: typeof import('../../../src/organization/role-store.js').getOrganizationAccessContext
let listCurrentOrganizationRoles: typeof import('../../../src/organization/role-store.js').listCurrentOrganizationRoles
let revokeOrganizationRole: typeof import('../../../src/organization/role-store.js').revokeOrganizationRole
let registerOrganizationCorporationSource: typeof import('../../../src/organization/corporation-sources.js').registerOrganizationCorporationSource
let deleteCharacter: typeof import('../../../src/auth/character-lifecycle.js').deleteCharacter
let setMainCharacter: typeof import('../../../src/auth/character-lifecycle.js').setMainCharacter
let recomputeOrganizationAccountCompliance: typeof import('../../../src/organization/compliance.js').recomputeOrganizationAccountCompliance
let recomputeComplianceForManagedCorporation: typeof import('../../../src/organization/compliance.js').recomputeComplianceForManagedCorporation
let recomputeAllOrganizationAccountsInTransaction: typeof import('../../../src/organization/compliance.js').recomputeAllOrganizationAccountsInTransaction
let approveOrganizationCharacterException: typeof import('../../../src/organization/exception-store.js').approveOrganizationCharacterException
let expireOrganizationCharacterExceptions: typeof import('../../../src/organization/exception-store.js').expireOrganizationCharacterExceptions
let expireOrganizationCharacterException: typeof import('../../../src/organization/exception-store.js').expireOrganizationCharacterException
let revokeOrganizationCharacterException: typeof import('../../../src/organization/exception-store.js').revokeOrganizationCharacterException
let updateOrganizationRegistrationPolicy: typeof import('../../../src/organization/policy-store.js').updateOrganizationRegistrationPolicy
let repairOrganizationCompliance: typeof import('../../../src/organization/compliance-repair.js').repairOrganizationCompliance
let getOrganizationAccountComplianceDetails: typeof import('../../../src/organization/compliance-details.js').getOrganizationAccountComplianceDetails
let loadOrganizationSessionContext: typeof import('../../../src/middleware/organization-session.js').loadOrganizationSessionContext
let listOrganizationRosterCoverage: typeof import('../../../src/organization/roster-coverage.js').listOrganizationRosterCoverage
let searchManagedOrganizationAccounts: typeof import('../../../src/organization/reviewer-account-search.js').searchManagedOrganizationAccounts
let searchManagedOrganizationDirectory: typeof import('../../../src/organization/reviewer-account-search.js').searchManagedOrganizationDirectory
let resolveOrganizationReviewerTarget: typeof import('../../../src/organization/reviewer-target.js').resolveOrganizationReviewerTarget
let assignOrganizationReviewerOrdinaryGroup: typeof import('../../../src/organization/reviewer-commands.js').assignOrganizationReviewerOrdinaryGroup
let blockOrganizationReviewerMember: typeof import('../../../src/organization/reviewer-commands.js').blockOrganizationReviewerMember
let revokeOrganizationReviewerOrdinaryGroup: typeof import('../../../src/organization/reviewer-commands.js').revokeOrganizationReviewerOrdinaryGroup
let unblockOrganizationReviewerMember: typeof import('../../../src/organization/reviewer-commands.js').unblockOrganizationReviewerMember
let appendOrganizationSensitiveAccessDecision: typeof import('../../../src/organization/sensitive-access-audit.js').appendOrganizationSensitiveAccessDecision
let loadOrganizationRevisionFacts: typeof import('../../../src/cache-admission/store.js').loadOrganizationRevisionFacts
let dbClient: typeof import('../../../src/db/client.js')
const databasePassword = randomUUID()
const adminId = randomUUID()
const userId = randomUUID()
const characterId = 1_404_328_063
const directoryNow = new Date('2026-09-18T12:00:00.000Z')
let subjectLifecycleId: string

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: databasePassword,
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .start()
  const databaseUrl = `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  connection = postgres(databaseUrl, { onnotice: () => {} })
  secondConnection = postgres(databaseUrl, { onnotice: () => {} })
  await waitForDatabase()
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })
  await runMigrations(connection)
  ;({ updateDeploymentOrganization } = await import('../../../src/admin/store.js'))
  ;({ claimOrganizationOwnership } = await import('../../../src/organization/owner-claim.js'))
  ;({ refreshOrganizationOwnerEvidence, selectDueOrganizationOwnerEvidence } =
    await import('../../../src/organization/owner-evidence.js'))
  ;({ refreshDerivedDirectorAuthority } =
    await import('../../../src/organization/derived-authority.js'))
  ;({
    assignOrganizationGroup,
    createOrganizationGroup,
    createOrganizationPermissionBundle,
    listCurrentOrganizationPermissionBundles,
    revokeOrganizationGroupAssignment,
    updateOrganizationPermissionBundle,
  } = await import('../../../src/organization/group-store.js'))
  ;({ convergeRegistrationComplianceGroupAssignment } =
    await import('../../../src/organization/group-compliance.js'))
  ;({ getOrganizationGroupPermissions } =
    await import('../../../src/organization/group-permissions.js'))
  ;({ hasCurrentOrganizationManagerAuthority } =
    await import('../../../src/organization/management-authority.js'))
  ;({ blockOrganizationMember, hasCurrentOrganizationMemberBlock, unblockOrganizationMember } =
    await import('../../../src/organization/block-store.js'))
  ;({
    getOrganizationAccessContext,
    grantOrganizationRole,
    listCurrentOrganizationRoles,
    revokeOrganizationRole,
  } = await import('../../../src/organization/role-store.js'))
  ;({ registerOrganizationCorporationSource } =
    await import('../../../src/organization/corporation-sources.js'))
  ;({ deleteCharacter, setMainCharacter } =
    await import('../../../src/auth/character-lifecycle.js'))
  ;({
    recomputeAllOrganizationAccountsInTransaction,
    recomputeComplianceForManagedCorporation,
    recomputeOrganizationAccountCompliance,
  } = await import('../../../src/organization/compliance.js'))
  ;({
    approveOrganizationCharacterException,
    expireOrganizationCharacterException,
    expireOrganizationCharacterExceptions,
    revokeOrganizationCharacterException,
  } = await import('../../../src/organization/exception-store.js'))
  ;({ updateOrganizationRegistrationPolicy } =
    await import('../../../src/organization/policy-store.js'))
  ;({ repairOrganizationCompliance } =
    await import('../../../src/organization/compliance-repair.js'))
  ;({ getOrganizationAccountComplianceDetails } =
    await import('../../../src/organization/compliance-details.js'))
  ;({ loadOrganizationSessionContext } =
    await import('../../../src/middleware/organization-session.js'))
  ;({ listOrganizationRosterCoverage } =
    await import('../../../src/organization/roster-coverage.js'))
  ;({ searchManagedOrganizationAccounts, searchManagedOrganizationDirectory } =
    await import('../../../src/organization/reviewer-account-search.js'))
  ;({ resolveOrganizationReviewerTarget } =
    await import('../../../src/organization/reviewer-target.js'))
  ;({
    assignOrganizationReviewerOrdinaryGroup,
    blockOrganizationReviewerMember,
    revokeOrganizationReviewerOrdinaryGroup,
    unblockOrganizationReviewerMember,
  } = await import('../../../src/organization/reviewer-commands.js'))
  ;({ appendOrganizationSensitiveAccessDecision } =
    await import('../../../src/organization/sensitive-access-audit.js'))
  ;({ loadOrganizationRevisionFacts } = await import('../../../src/cache-admission/store.js'))
  dbClient = await import('../../../src/db/client.js')
})

beforeEach(async () => {
  await connection.unsafe(
    'truncate organization_epochs, deployment_admins, users, domain_events restart identity cascade',
  )
  await seedDeployment()
  const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
    select subject_lifecycle_id
    from platform_subject_lifecycles
    where character_id = ${characterId}
  `
  if (!lifecycle) {
    throw new Error('Seeded character lifecycle is missing')
  }
  subjectLifecycleId = lifecycle.subject_lifecycle_id
  ownerEvidenceMocks.observeAndPersistCharacterAffiliation.mockResolvedValue({
    affiliationCheckedAt: await loadAffiliationCheckedAt(),
    affiliationFreshUntil: new Date(Date.now() + 60 * 60 * 1000),
    allianceId: null,
    characterId,
    corporationId: 98_000_001,
    stale: false,
  })
  ownerEvidenceMocks.getCharacterCorporationRolesEvidence.mockResolvedValue(roleEvidence())
})

afterAll(async () => {
  await dbClient?.sql.end()
  await secondConnection?.end()
  await connection?.end()
  await container?.stop()
})

describe('organization storage invariants', () => {
  test('keeps owned module permissions auditable, attributable, and inert when unavailable', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await establishCompliantAccount(targetUserId, 90_000_001)

    await expect(
      createOrganizationPermissionBundle({
        actorUserId: userId,
        name: 'Typo',
        permissions: [{ ...organizationActivityPermission(), key: 'organization-activity.typo' }],
        reason: 'Attempt an invalid permission.',
      }),
    ).rejects.toMatchObject({ code: 'permission-unavailable' })

    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Organization activity',
      permissions: [organizationActivityPermission()],
      reason: 'Create organization activity access.',
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [bundle.bundleId],
      complianceSource: null,
      managementMode: 'manual',
      name: 'Activity viewers',
      restricted: false,
    })
    await assignOrganizationGroup({
      actorUserId: userId,
      expiresAt: null,
      groupId: group.groupId,
      reason: 'Grant activity access.',
      targetUserId,
    })

    const [stored] = await connection<
      { publisher_package: string; module_id: string; review_allowed: boolean }[]
    >`
      select publisher_package, module_id, review_allowed
      from organization_permission_bundle_entries
      where bundle_id = ${bundle.bundleId}
    `
    expect(stored).toStrictEqual({
      module_id: 'organization-activity',
      publisher_package: '@eve-space/organization-activity-manifest',
      review_allowed: false,
    })
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toMatchObject({
      modules: ['organization-activity.view'],
    })

    await connection`
      update deployment_modules set enabled = false where module_id = 'organization-activity'
    `
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toMatchObject({
      modules: [],
    })
    await connection`
      update deployment_modules set enabled = true where module_id = 'organization-activity'
    `
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toMatchObject({
      modules: ['organization-activity.view'],
    })

    await connection`
      update organization_permission_bundle_entries
      set publisher_package = '@replacement/organization-activity-manifest'
      where bundle_id = ${bundle.bundleId}
    `
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toMatchObject({
      modules: [],
    })
    await expect(listCurrentOrganizationPermissionBundles(userId)).resolves.toMatchObject({
      bundles: [
        {
          permissions: [
            {
              available: false,
              key: 'organization-activity.view',
              moduleId: 'organization-activity',
              publisherPackage: '@replacement/organization-activity-manifest',
              type: 'module',
            },
          ],
        },
      ],
    })

    const retainedBundles = await listCurrentOrganizationPermissionBundles(userId)
    const retainedEntry = retainedBundles.bundles[0]?.permissions[0]
    if (!retainedEntry) {
      throw new Error('Retained permission entry is missing')
    }
    const [beforeRetention] = await connection<
      {
        entry_id: string
        publisher_package: string
        module_id: string
        permission_key: string
        review_allowed: boolean
        created_at: Date
      }[]
    >`
      select entry_id, publisher_package, module_id, permission_key, review_allowed, created_at
      from organization_permission_bundle_entries
      where bundle_id = ${bundle.bundleId}
    `

    await updateOrganizationPermissionBundle({
      actorUserId: userId,
      bundleId: bundle.bundleId,
      name: bundle.name,
      permissions: [],
      reason: 'Keep the unavailable permission.',
      retainedUnavailableEntryIds: [retainedEntry.entryId],
    })
    const [afterRetention] = await connection<
      {
        entry_id: string
        publisher_package: string
        module_id: string
        permission_key: string
        review_allowed: boolean
        created_at: Date
      }[]
    >`
      select entry_id, publisher_package, module_id, permission_key, review_allowed, created_at
      from organization_permission_bundle_entries
      where bundle_id = ${bundle.bundleId}
    `
    expect(afterRetention).toStrictEqual(beforeRetention)

    await updateOrganizationPermissionBundle({
      actorUserId: userId,
      bundleId: bundle.bundleId,
      name: bundle.name,
      permissions: [],
      reason: 'Remove the unavailable permission.',
      retainedUnavailableEntryIds: [],
    })
    const [counts] = await connection<{ entries: number; audits: number }[]>`
      select
        (select count(*)::integer from organization_permission_bundle_entries
          where bundle_id = ${bundle.bundleId}) as entries,
        (select count(*)::integer from organization_audit_events
          where subject_type = 'permission_bundle' and subject_id = ${bundle.bundleId}) as audits
    `
    expect(counts).toStrictEqual({ audits: 3, entries: 0 })
  })

  test('rejects retained IDs that are foreign, missing, service, available, or duplicated', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Mixed permissions',
      permissions: [
        organizationActivityPermission(),
        { type: 'service', key: 'discord.operations', reviewAllowed: true },
      ],
      reason: 'Create permissions for retention validation.',
    })
    const foreignBundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Foreign permissions',
      permissions: [{ type: 'service', key: 'discord.foreign' }],
      reason: 'Create a foreign permission entry.',
    })
    const listed = await listCurrentOrganizationPermissionBundles(userId)
    const targetEntries = listed.bundles.find(
      ({ bundleId }) => bundleId === bundle.bundleId,
    )!.permissions
    const availableEntry = targetEntries.find(({ type }) => type === 'module')!
    const serviceEntry = targetEntries.find(({ type }) => type === 'service')!
    const foreignEntry = listed.bundles.find(({ bundleId }) => bundleId === foreignBundle.bundleId)!
      .permissions[0]!

    const update = (retainedUnavailableEntryIds: string[]) =>
      updateOrganizationPermissionBundle({
        actorUserId: userId,
        bundleId: bundle.bundleId,
        name: bundle.name,
        permissions: [],
        reason: 'Validate retained permission IDs.',
        retainedUnavailableEntryIds,
      })

    await expect(update([availableEntry.entryId])).rejects.toMatchObject({
      code: 'retained-permission-invalid',
    })
    await expect(update([serviceEntry.entryId])).rejects.toMatchObject({
      code: 'retained-permission-invalid',
    })
    await expect(update([foreignEntry.entryId])).rejects.toMatchObject({
      code: 'retained-permission-invalid',
    })
    await expect(update([randomUUID()])).rejects.toMatchObject({
      code: 'retained-permission-invalid',
    })

    await connection`
      update organization_permission_bundle_entries
      set publisher_package = '@replacement/organization-activity-manifest'
      where entry_id = ${availableEntry.entryId}
    `
    await expect(update([availableEntry.entryId, availableEntry.entryId])).rejects.toMatchObject({
      code: 'retained-permission-invalid',
    })

    const [unchanged] = await connection<{ name: string; entries: number }[]>`
      select bundles.name, count(entries.entry_id)::integer as entries
      from organization_permission_bundles bundles
      join organization_permission_bundle_entries entries using (bundle_id)
      where bundles.bundle_id = ${bundle.bundleId}
      group by bundles.name
    `
    expect(unchanged).toStrictEqual({ entries: 2, name: bundle.name })
  })

  test('searches only current managed accounts with bounded opaque pagination', async () => {
    const secondUserId = randomUUID()
    const secondCharacterId = characterId + 1
    await seedCharacter(secondUserId, secondCharacterId)
    await connection`
      insert into organization_managed_member_lifecycles (
        deployment_id, organization_version, user_id
      ) values (1, 1, ${secondUserId})
    `
    await connection`update characters set is_main = true where character_id = ${secondCharacterId}`
    await connection`
      insert into organization_member_blocks (
        deployment_id, organization_version, user_id, blocked_by_user_id, reason
      ) values (1, 1, ${secondUserId}, ${userId}, 'Review hold')
    `

    const firstPage = await searchManagedOrganizationAccounts({
      filters: { limit: 1 },
      organizationVersion: 1,
    })
    expect(firstPage.status).toBe('available')
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.nextCursor).toStrictEqual(expect.any(String))
    const decodedCursor = Buffer.from(firstPage.nextCursor!, 'base64url').toString('utf8')
    expect(decodedCursor).not.toContain(firstPage.items[0]!.account.userId)
    expect(decodedCursor).not.toContain(secondUserId)
    expect(firstPage.items[0]).toStrictEqual(
      expect.objectContaining({
        account: expect.objectContaining({ mainCharacter: expect.any(Object) }),
        compliance: expect.objectContaining({ state: 'pending' }),
        managedAffiliation: expect.objectContaining({ corporationId: 98_000_001 }),
      }),
    )
    expect(firstPage.items[0]).not.toHaveProperty('groups')
    expect(firstPage.items[0]).not.toHaveProperty('evidence')

    const secondPage = await searchManagedOrganizationAccounts({
      filters: { cursor: firstPage.nextCursor!, limit: 1 },
      organizationVersion: 1,
    })
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0]!.account.userId).not.toBe(firstPage.items[0]!.account.userId)
    expect(secondPage.nextCursor).toBeNull()

    await expect(
      searchManagedOrganizationAccounts({
        filters: { cursor: firstPage.nextCursor!, query: 'different filter' },
        organizationVersion: 1,
      }),
    ).rejects.toThrow('Invalid reviewer account search input')
    const tamperedCursor = `${firstPage.nextCursor!.startsWith('A') ? 'B' : 'A'}${firstPage.nextCursor!.slice(1)}`
    await expect(
      searchManagedOrganizationAccounts({
        filters: { cursor: tamperedCursor },
        organizationVersion: 1,
      }),
    ).rejects.toThrow('Invalid reviewer account search input')

    const blocked = await searchManagedOrganizationAccounts({
      filters: { blocked: true },
      organizationVersion: 1,
    })
    expect(blocked.items.map(({ account }) => account.userId)).toStrictEqual([secondUserId])

    await connection`
      update characters
      set corporation_id = 98000002
      where character_id = ${secondCharacterId}
    `
    await expect(
      searchManagedOrganizationAccounts({
        filters: { query: String(secondCharacterId) },
        organizationVersion: 1,
      }),
    ).resolves.toStrictEqual({
      items: [],
      nextCursor: null,
      organizationVersion: 1,
      status: 'available',
    })
    for (const query of ['%', '_', '\\']) {
      await expect(
        searchManagedOrganizationAccounts({ filters: { query }, organizationVersion: 1 }),
      ).resolves.toStrictEqual({
        items: [],
        nextCursor: null,
        organizationVersion: 1,
        status: 'available',
      })
    }
  })

  test('projects the canonical core reviewer directory without module evidence', async () => {
    const page = await searchManagedOrganizationDirectory({
      filters: { query: 'Organization Pilot' },
      organizationVersion: 1,
    })

    expect(page.status).toBe('available')
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      account: {
        mainCharacter: { characterId, name: 'Organization Pilot' },
        userId,
      },
      auditData: { asOf: null, covered: 0, expected: 0, state: 'not-enabled' },
      block: { blocked: false },
      compliance: { state: 'pending' },
      disclosedCharacterCount: 1,
      groups: [],
      managedAffiliation: {
        characterId,
        corporationId: 98_000_001,
        name: 'Organization Pilot',
      },
      managedMemberLifecycleId: expect.any(String),
      managedSince: expect.any(String),
      portraitCharacter: {
        characterId,
        name: 'Organization Pilot',
        source: 'main-character',
      },
      siteRegisteredAt: expect.any(String),
    })
    expect(page.items[0]).not.toHaveProperty('evidenceSections')
    expect(page.items[0]).not.toHaveProperty('resources')
    await expect(
      searchManagedOrganizationDirectory({ filters: {}, organizationVersion: 2 }),
    ).resolves.toStrictEqual({
      groupFacets: [],
      items: [],
      nextCursor: null,
      organizationVersion: 2,
      status: 'unavailable',
    })
  })

  test('projects the current lifecycle, fallback identity, disclosed characters, and current groups', async () => {
    await connection`
      update users set created_at = '2025-04-03T10:00:00Z' where id = ${userId}
    `
    await connection`
      update organization_managed_member_lifecycles
      set started_at = '2025-05-01T00:00:00Z', ended_at = '2025-06-01T00:00:00Z'
      where deployment_id = 1 and organization_version = 1 and user_id = ${userId}
    `
    await connection`
      insert into organization_managed_member_lifecycles (
        deployment_id, organization_version, user_id, started_at
      ) values (1, 1, ${userId}, '2026-02-04T09:30:00Z')
    `
    await connection`
      update characters
      set corporation_id = 98000002, next_affiliation_check = '2026-09-19T00:00:00Z'
      where character_id = ${characterId}
    `
    await seedAdditionalDirectoryCharacter(userId, 90_000_101, 'Zulu Managed', false)
    await seedAdditionalDirectoryCharacter(userId, 90_000_102, 'Alpha Managed', false)
    const groups = await seedDirectoryGroups()

    const page = await searchManagedOrganizationDirectory({
      filters: {},
      now: directoryNow,
      organizationVersion: 1,
    })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      account: { mainCharacter: null, userId },
      disclosedCharacterCount: 2,
      groups: [
        { groupId: groups.alpha, name: 'Alpha current' },
        { groupId: groups.compliance, name: 'Compliance current' },
        { groupId: groups.restricted, name: 'Restricted current' },
        { groupId: groups.zulu, name: 'Zulu current' },
      ],
      managedAffiliation: { characterId: 90_000_102, name: 'Alpha Managed' },
      managedSince: '2026-02-04T09:30:00.000Z',
      portraitCharacter: {
        characterId: 90_000_102,
        name: 'Alpha Managed',
        source: 'managed-affiliation',
      },
      siteRegisteredAt: '2025-04-03T10:00:00.000Z',
    })
    expect(page.groupFacets).toStrictEqual([
      { groupId: groups.alpha, name: 'Alpha current' },
      { groupId: groups.compliance, name: 'Compliance current' },
      { groupId: groups.expired, name: 'Expired assignment' },
      { groupId: groups.restricted, name: 'Restricted current' },
      { groupId: groups.revoked, name: 'Revoked assignment' },
      { groupId: groups.zulu, name: 'Zulu current' },
    ])

    await expect(
      searchManagedOrganizationDirectory({
        filters: { groupId: groups.restricted },
        now: directoryNow,
        organizationVersion: 1,
      }),
    ).resolves.toMatchObject({ items: [{ account: { userId } }] })
    await expect(
      searchManagedOrganizationDirectory({
        filters: { groupId: groups.expired },
        now: directoryNow,
        organizationVersion: 1,
      }),
    ).resolves.toMatchObject({ items: [] })
    await expect(
      searchManagedOrganizationDirectory({
        filters: { groupId: groups.revoked },
        now: directoryNow,
        organizationVersion: 1,
      }),
    ).resolves.toMatchObject({ items: [] })
  })

  test('derives every aggregate audit state with conservative mixed-resource precedence', async () => {
    await enableDirectoryAuditSections(['skills', 'assets'])

    await expect(loadDirectoryAuditData()).resolves.toStrictEqual({
      asOf: null,
      covered: 0,
      expected: 2,
      state: 'authorization-required',
    })

    await authorizeDirectoryAuditSections(['skills', 'assets'])
    await expect(loadDirectoryAuditData()).resolves.toStrictEqual({
      asOf: null,
      covered: 0,
      expected: 2,
      state: 'never-collected',
    })

    await seedDirectoryAuditState({
      nextEligibleAt: '2026-09-18T13:00:00Z',
      resourceId: 'trained-skills',
      sectionId: 'skills',
      validatedAt: '2026-09-18T10:00:00Z',
    })
    await expect(loadDirectoryAuditData()).resolves.toStrictEqual({
      asOf: null,
      covered: 1,
      expected: 2,
      state: 'never-collected',
    })

    await seedDirectoryAuditState({
      lastFailureClass: 'esi-unavailable',
      nextEligibleAt: '2026-09-18T13:00:00Z',
      resourceId: 'assets',
      sectionId: 'assets',
      validatedAt: null,
    })
    await expect(loadDirectoryAuditData()).resolves.toStrictEqual({
      asOf: null,
      covered: 1,
      expected: 2,
      state: 'unavailable',
    })

    await connection`
      update platform_collection_state
      set validated_at = '2026-09-18T09:00:00Z', next_eligible_at = '2026-09-18T13:00:00Z'
      where module_id = 'member-audit' and resource_id = 'assets'
    `
    await expect(loadDirectoryAuditData()).resolves.toStrictEqual({
      asOf: '2026-09-18T09:00:00.000Z',
      covered: 2,
      expected: 2,
      state: 'stale',
    })

    await connection`
      update platform_collection_state
      set last_failure_class = null, failure_started_at = null,
        next_eligible_at = '2026-09-18T11:00:00Z'
      where module_id = 'member-audit' and resource_id = 'assets'
    `
    await expect(loadDirectoryAuditData()).resolves.toStrictEqual({
      asOf: '2026-09-18T09:00:00.000Z',
      covered: 2,
      expected: 2,
      state: 'stale',
    })

    await connection`
      update platform_collection_state
      set next_eligible_at = '2026-09-18T13:00:00Z'
      where module_id = 'member-audit' and resource_id = 'assets'
    `
    await expect(loadDirectoryAuditData()).resolves.toStrictEqual({
      asOf: '2026-09-18T09:00:00.000Z',
      covered: 2,
      expected: 2,
      state: 'current',
    })

    await connection`
      delete from character_reviewer_disclosure_acceptances
      where character_id = ${characterId} and module_id = 'member-audit' and section_id = 'skills'
    `
    await expect(loadDirectoryAuditData()).resolves.toMatchObject({
      expected: 2,
      state: 'authorization-required',
    })

    await connection`
      update deployment_module_sections set enabled = false where module_id = 'member-audit'
    `
    await expect(loadDirectoryAuditData()).resolves.toStrictEqual({
      asOf: null,
      covered: 0,
      expected: 0,
      state: 'not-enabled',
    })
  })

  test('filters and sorts the complete directory before stable cursor pagination', async () => {
    const alphaUserId = '10000000-0000-4000-8000-000000000001'
    const bravoUserId = '20000000-0000-4000-8000-000000000002'
    const charlieUserId = '30000000-0000-4000-8000-000000000003'
    const echoUserId = '40000000-0000-4000-8000-000000000004'
    await connection`
      insert into organization_managed_corporations (
        deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at
      ) values (1, 1, 98000004, '2026-01-01T00:00:00Z', '2026-09-18T10:04:00Z')
    `
    await connection`
      update users set created_at = '2025-04-04T00:00:00Z' where id = ${userId}
    `
    await connection`
      update characters
      set name = 'Delta Pilot', corporation_id = 98000004,
        affiliation_checked_at = '2026-09-18T10:04:00Z',
        next_affiliation_check = '2026-09-19T00:00:00Z'
      where character_id = ${characterId}
    `
    await connection`
      update organization_managed_member_lifecycles
      set started_at = '2026-01-04T00:00:00Z'
      where deployment_id = 1 and organization_version = 1 and user_id = ${userId}
        and ended_at is null
    `
    await seedDirectoryAccount({
      affiliationCheckedAt: '2026-09-18T10:01:00Z',
      corporationId: 98_000_002,
      managedSince: '2026-01-01T00:00:00Z',
      name: 'Alpha Pilot',
      siteRegisteredAt: '2025-04-01T00:00:00Z',
      targetCharacterId: 90_000_201,
      targetUserId: alphaUserId,
    })
    await seedAdditionalDirectoryCharacter(alphaUserId, 90_000_211, 'Alpha Alt', false)
    await seedDirectoryAccount({
      affiliationCheckedAt: '2026-09-18T10:02:00Z',
      corporationId: 98_000_001,
      managedSince: '2026-01-02T00:00:00Z',
      name: 'Bravo Pilot',
      siteRegisteredAt: '2025-04-02T00:00:00Z',
      targetCharacterId: 90_000_202,
      targetUserId: bravoUserId,
    })
    await seedDirectoryAccount({
      affiliationCheckedAt: '2026-09-18T10:03:00Z',
      corporationId: 98_000_003,
      managedSince: '2026-01-03T00:00:00Z',
      name: 'Charlie Pilot',
      siteRegisteredAt: '2025-04-03T00:00:00Z',
      targetCharacterId: 90_000_203,
      targetUserId: charlieUserId,
    })
    await seedDirectoryAccount({
      affiliationCheckedAt: '2026-09-18T10:05:00Z',
      corporationId: 98_000_005,
      managedSince: '2026-01-05T00:00:00Z',
      name: 'Echo Pilot',
      siteRegisteredAt: '2025-04-05T00:00:00Z',
      targetCharacterId: 90_000_205,
      targetUserId: echoUserId,
    })
    await seedDirectoryCompliance({
      accessValidUntil: '2026-09-24T00:00:00Z',
      evidenceAt: '2026-09-18T10:00:00Z',
      evidenceFreshness: 'fresh',
      state: 'compliant',
      targetUserId: userId,
    })
    await seedDirectoryCompliance({
      evidenceFreshness: 'unavailable',
      state: 'pending',
      targetUserId: alphaUserId,
    })
    await seedDirectoryCompliance({
      accessValidUntil: '2026-09-20T00:00:00Z',
      establishedCompliantAt: '2026-09-01T00:00:00Z',
      evidenceAt: '2026-09-18T09:00:00Z',
      evidenceFreshness: 'stale',
      reviewDeadline: '2026-09-21T00:00:00Z',
      state: 'review_required',
      targetUserId: bravoUserId,
    })
    await seedDirectoryCompliance({
      evidenceAt: '2026-09-18T08:00:00Z',
      evidenceFreshness: 'stale',
      reviewDeadline: '2026-09-22T00:00:00Z',
      state: 'suspended',
      targetUserId: charlieUserId,
    })
    await seedDirectoryCompliance({
      accessValidUntil: '2026-09-25T00:00:00Z',
      evidenceAt: '2026-09-18T07:00:00Z',
      evidenceFreshness: 'fresh',
      state: 'compliant',
      targetUserId: echoUserId,
    })
    await seedDirectoryBlock(echoUserId, '2026-09-15T00:00:00Z')
    await enableDirectoryAuditSections(['skills', 'assets'])
    await authorizeDirectoryAuditSections(['skills', 'assets'])
    await authorizeDirectoryAuditSections(['skills', 'assets'], 90_000_202)
    for (const state of [
      {
        resourceId: 'trained-skills',
        sectionId: 'skills',
        targetCharacterId: characterId,
        targetUserId: userId,
        validatedAt: '2026-09-18T10:00:00Z',
      },
      {
        resourceId: 'assets',
        sectionId: 'assets',
        targetCharacterId: characterId,
        targetUserId: userId,
        validatedAt: '2026-09-18T09:00:00Z',
      },
      {
        resourceId: 'trained-skills',
        sectionId: 'skills',
        targetCharacterId: 90_000_202,
        targetUserId: bravoUserId,
        validatedAt: '2026-09-18T09:00:00Z',
      },
      {
        resourceId: 'assets',
        sectionId: 'assets',
        targetCharacterId: 90_000_202,
        targetUserId: bravoUserId,
        validatedAt: '2026-09-18T08:00:00Z',
      },
    ]) {
      await seedDirectoryAuditState({
        ...state,
        nextEligibleAt: '2026-09-18T13:00:00Z',
      })
    }

    await expect(directoryUserIds({ query: 'Alpha' })).resolves.toStrictEqual([alphaUserId])
    await expect(directoryUserIds({ query: '90000201' })).resolves.toStrictEqual([alphaUserId])
    await expect(directoryUserIds({ query: alphaUserId })).resolves.toStrictEqual([alphaUserId])
    await expect(directoryUserIds({ query: '%' })).resolves.toStrictEqual([])
    await expect(directoryUserIds({ corporationId: 98_000_004 })).resolves.toStrictEqual([userId])
    await expect(directoryUserIds({ complianceState: 'pending' })).resolves.toStrictEqual([
      alphaUserId,
    ])
    await expect(directoryUserIds({ complianceState: 'review_required' })).resolves.toStrictEqual([
      bravoUserId,
    ])
    await expect(directoryUserIds({ blocked: true })).resolves.toStrictEqual([echoUserId])
    await expect(directoryUserIds({ blocked: false })).resolves.toStrictEqual([
      alphaUserId,
      bravoUserId,
      charlieUserId,
      userId,
    ])
    await expect(directoryUserIds({ auditState: 'current' })).resolves.toStrictEqual([
      bravoUserId,
      userId,
    ])
    await expect(directoryUserIds({ auditState: 'authorization-required' })).resolves.toStrictEqual(
      [alphaUserId, charlieUserId, echoUserId],
    )

    const nullAuditIds = [alphaUserId, charlieUserId, echoUserId].toSorted((left, right) =>
      left.localeCompare(right),
    )
    const singleCharacterIds = [bravoUserId, charlieUserId, echoUserId, userId].toSorted(
      (left, right) => left.localeCompare(right),
    )
    const nullDeadlineIds = [alphaUserId, echoUserId, userId].toSorted((left, right) =>
      left.localeCompare(right),
    )
    const nullAccessIds = [alphaUserId, charlieUserId].toSorted((left, right) =>
      left.localeCompare(right),
    )
    const unblockedIds = [alphaUserId, bravoUserId, charlieUserId, userId].toSorted((left, right) =>
      left.localeCompare(right),
    )
    const sortCases = [
      {
        asc: [alphaUserId, bravoUserId, charlieUserId, userId, echoUserId],
        desc: [echoUserId, userId, charlieUserId, bravoUserId, alphaUserId],
        sort: 'member' as const,
      },
      {
        asc: [bravoUserId, alphaUserId, charlieUserId, userId, echoUserId],
        desc: [echoUserId, userId, charlieUserId, alphaUserId, bravoUserId],
        sort: 'corporation' as const,
      },
      {
        asc: [alphaUserId, bravoUserId, charlieUserId, userId, echoUserId],
        desc: [echoUserId, userId, charlieUserId, bravoUserId, alphaUserId],
        sort: 'managed_since' as const,
      },
      {
        asc: [bravoUserId, userId, ...nullAuditIds],
        desc: [userId, bravoUserId, ...nullAuditIds],
        sort: 'audit_data' as const,
      },
      {
        asc: [userId, alphaUserId, bravoUserId, charlieUserId, echoUserId],
        desc: [echoUserId, charlieUserId, bravoUserId, alphaUserId, userId],
        sort: 'access_status' as const,
      },
      {
        asc: [...singleCharacterIds, alphaUserId],
        desc: [alphaUserId, ...singleCharacterIds],
        sort: 'disclosed_characters' as const,
      },
      {
        asc: [alphaUserId, bravoUserId, charlieUserId, userId, echoUserId],
        desc: [echoUserId, userId, charlieUserId, bravoUserId, alphaUserId],
        sort: 'affiliation_checked_at' as const,
      },
      {
        asc: [alphaUserId, bravoUserId, charlieUserId, userId, echoUserId],
        desc: [echoUserId, userId, charlieUserId, bravoUserId, alphaUserId],
        sort: 'site_registered_at' as const,
      },
      {
        asc: [bravoUserId, charlieUserId, ...nullDeadlineIds],
        desc: [charlieUserId, bravoUserId, ...nullDeadlineIds],
        sort: 'review_deadline' as const,
      },
      {
        asc: [bravoUserId, userId, echoUserId, ...nullAccessIds],
        desc: [echoUserId, userId, bravoUserId, ...nullAccessIds],
        sort: 'access_valid_until' as const,
      },
      {
        asc: [echoUserId, ...unblockedIds],
        desc: [echoUserId, ...unblockedIds],
        sort: 'blocked_since' as const,
      },
    ]
    for (const { sort, asc: ascending, desc: descending } of sortCases) {
      await expect(directoryUserIds({ direction: 'asc', sort })).resolves.toStrictEqual(ascending)
      await expect(directoryUserIds({ direction: 'desc', sort })).resolves.toStrictEqual(descending)
    }

    const firstPage = await searchManagedOrganizationDirectory({
      filters: { direction: 'asc', limit: 2, sort: 'member' },
      now: directoryNow,
      organizationVersion: 1,
    })
    expect(firstPage.items.map(({ account }) => account.userId)).toStrictEqual([
      alphaUserId,
      bravoUserId,
    ])
    const lateUserId = '05000000-0000-4000-8000-000000000005'
    await seedDirectoryAccount({
      affiliationCheckedAt: '2026-09-18T10:00:00Z',
      corporationId: 98_000_001,
      managedSince: '2025-12-01T00:00:00Z',
      name: 'Aardvark Pilot',
      siteRegisteredAt: '2025-03-01T00:00:00Z',
      targetCharacterId: 90_000_206,
      targetUserId: lateUserId,
    })
    const remainingIds: string[] = []
    let cursor = firstPage.nextCursor
    while (cursor) {
      const page = await searchManagedOrganizationDirectory({
        filters: { cursor, direction: 'asc', limit: 2, sort: 'member' },
        now: directoryNow,
        organizationVersion: 1,
      })
      remainingIds.push(...page.items.map(({ account }) => account.userId))
      cursor = page.nextCursor
    }
    expect(remainingIds).toStrictEqual([charlieUserId, userId, echoUserId])
    expect(
      new Set([...firstPage.items.map(({ account }) => account.userId), ...remainingIds]).size,
    ).toBe(5)
  })

  test('preserves every compliance and active-block combination', async () => {
    const complianceCases = [
      {
        evidenceFreshness: 'unavailable' as const,
        state: 'pending' as const,
      },
      {
        accessValidUntil: '2026-09-24T00:00:00Z',
        evidenceAt: '2026-09-18T10:00:00Z',
        evidenceFreshness: 'fresh' as const,
        state: 'compliant' as const,
      },
      {
        evidenceAt: '2026-09-18T10:00:00Z',
        evidenceFreshness: 'stale' as const,
        reviewDeadline: '2026-09-21T00:00:00Z',
        state: 'review_required' as const,
      },
      {
        evidenceAt: '2026-09-18T10:00:00Z',
        evidenceFreshness: 'stale' as const,
        reviewDeadline: '2026-09-21T00:00:00Z',
        state: 'suspended' as const,
      },
    ]

    for (const compliance of complianceCases) {
      await seedDirectoryCompliance({ targetUserId: userId, ...compliance })
      const unblocked = await searchManagedOrganizationDirectory({
        filters: { blocked: false, complianceState: compliance.state },
        now: directoryNow,
        organizationVersion: 1,
      })
      expect(unblocked.items[0]).toMatchObject({
        account: { userId },
        block: { blocked: false },
        compliance: { state: compliance.state },
      })

      await seedDirectoryBlock(userId, '2026-09-17T00:00:00Z')
      const blocked = await searchManagedOrganizationDirectory({
        filters: { blocked: true, complianceState: compliance.state },
        now: directoryNow,
        organizationVersion: 1,
      })
      expect(blocked.items[0]).toMatchObject({
        account: { userId },
        block: { blocked: true, blockedAt: '2026-09-17T00:00:00.000Z' },
        compliance: { state: compliance.state },
      })
      await connection`delete from organization_member_blocks where user_id = ${userId}`
      await connection`delete from organization_account_compliance where user_id = ${userId}`
    }
  })

  test('keeps the maximum-size directory query plan bounded without a new index', async () => {
    await connection`
      insert into users (id, created_at)
      select ('50000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
        '2025-01-01T00:00:00Z'::timestamptz + value * interval '1 minute'
      from generate_series(1, 60) value
    `
    await connection`
      insert into characters (
        character_id, user_id, owner_hash, name, corporation_id, affiliation_checked_at,
        next_affiliation_check, affiliation_resolution_state, is_main
      )
      select 920000000 + value,
        ('50000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
        'plan-owner-' || value,
        'Plan Member ' || lpad(value::text, 3, '0'), 98000001,
        '2026-09-18T10:00:00Z'::timestamptz, '2026-09-19T00:00:00Z'::timestamptz,
        'resolved', true
      from generate_series(1, 60) value
    `
    await connection`
      insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes)
      select 920000000 + value, 'encrypted-test-token', '2026-09-19T00:00:00Z'::timestamptz,
        '["esi-characters.read_corporation_roles.v1"]'::jsonb
      from generate_series(1, 60) value
    `
    await connection`
      insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
      select 'character', (920000000 + value)::text, 920000000 + value
      from generate_series(1, 60) value
    `
    await connection`
      insert into organization_managed_member_lifecycles (
        deployment_id, organization_version, user_id, started_at
      )
      select 1, 1, ('50000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
        '2026-01-01T00:00:00Z'::timestamptz + value * interval '1 minute'
      from generate_series(1, 60) value
    `

    type UnsafeParameters = NonNullable<Parameters<typeof connection.unsafe>[1]>
    type DirectoryQueryCapture = {
      value: { query: string; parameters: UnsafeParameters } | null
    }
    const capture: DirectoryQueryCapture = { value: null }
    const options = dbClient.sql.options
    const previousDebug = options.debug
    options.debug = (_connection, query, parameters) => {
      if (query.includes('with resource_classification')) {
        capture.value = { parameters: parameters as UnsafeParameters, query }
      }
    }
    let page
    try {
      page = await searchManagedOrganizationDirectory({
        filters: { direction: 'desc', limit: 50, sort: 'managed_since' },
        now: directoryNow,
        organizationVersion: 1,
      })
    } finally {
      options.debug = previousDebug
    }
    expect(page.items).toHaveLength(50)
    expect(page.nextCursor).toStrictEqual(expect.any(String))
    const captured = capture.value
    if (!captured) {
      throw new Error('Directory query was not captured for plan inspection')
    }
    const [explained] = await connection.unsafe<{ 'QUERY PLAN': unknown }[]>(
      `explain (analyze, buffers, format json) ${captured.query}`,
      captured.parameters,
    )
    expect(explained?.['QUERY PLAN']).toBeDefined()
    expect(JSON.stringify(explained?.['QUERY PLAN'])).toContain('Actual Rows')
  })

  test('does not expose or match an unclassified main character', async () => {
    const managedCharacterId = characterId + 1
    await connection`
      update characters set corporation_id = 98000002 where character_id = ${characterId}
    `
    await connection`
      insert into characters (
        character_id, user_id, owner_hash, name, corporation_id, affiliation_checked_at,
        next_affiliation_check, affiliation_resolution_state, is_main
      ) values (
        ${managedCharacterId}, ${userId}, ${`owner-${managedCharacterId}`}, 'Managed Alt', 98000001, now(),
        now() + interval '1 hour', 'resolved', false
      )
    `
    await connection`
      insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
      values ('character', ${String(managedCharacterId)}, ${managedCharacterId})
    `

    const visible = await searchManagedOrganizationAccounts({
      filters: { query: 'Managed Alt' },
      organizationVersion: 1,
    })
    expect(visible.items).toHaveLength(1)
    expect(visible.items[0]!.account.mainCharacter).toBeNull()

    await expect(
      searchManagedOrganizationAccounts({
        filters: { query: 'Organization Pilot' },
        organizationVersion: 1,
      }),
    ).resolves.toStrictEqual({
      items: [],
      nextCursor: null,
      organizationVersion: 1,
      status: 'available',
    })

    await connection`
      insert into organization_character_exceptions (
        deployment_id, organization_version, user_id, character_id, approver_user_id, reason
      ) values (1, 1, ${userId}, ${characterId}, ${userId}, 'Approved external main')
    `
    const withApprovedMain = await searchManagedOrganizationAccounts({
      filters: { query: 'Managed Alt' },
      organizationVersion: 1,
    })
    expect(withApprovedMain.items[0]!.account.mainCharacter).toStrictEqual({
      characterId,
      name: 'Organization Pilot',
    })
  })

  test('reports unavailable search when alliance managed-corporation evidence is not current', async () => {
    await connection`
      update deployment_settings
      set organization_type = 'alliance', organization_id = 99000001
      where id = 1
    `
    await connection`
      insert into platform_subject_lifecycles (
        subject_kind, subject_id, organization_deployment_id, organization_version
      ) values ('alliance', '99000001', 1, 1)
    `

    await expect(
      searchManagedOrganizationAccounts({ filters: {}, organizationVersion: 1 }),
    ).resolves.toStrictEqual({
      items: [],
      nextCursor: null,
      organizationVersion: 1,
      status: 'unavailable',
    })
  })

  test('rejects malformed reviewer account search filters before querying', async () => {
    await expect(
      searchManagedOrganizationAccounts({ filters: { limit: 51 }, organizationVersion: 1 }),
    ).rejects.toThrow('Invalid reviewer account search input')
    await expect(
      searchManagedOrganizationAccounts({
        filters: { query: 'bad\nquery' },
        organizationVersion: 1,
      }),
    ).rejects.toThrow('Invalid reviewer account search input')
    await expect(
      searchManagedOrganizationAccounts({ filters: { corporationId: -1 }, organizationVersion: 1 }),
    ).rejects.toThrow('Invalid reviewer account search input')
  })

  test('resolves a reviewer target through a repeatable-read locked PostgreSQL snapshot', async () => {
    await expect(
      resolveOrganizationReviewerTarget({ organizationVersion: 1, targetUserId: userId }),
    ).resolves.toMatchObject({
      account: {
        mainCharacter: { characterId, name: 'Organization Pilot' },
        userId,
      },
      characters: [
        {
          characterId,
          subjectLifecycleId,
          affiliation: { membership: 'managed', freshness: 'fresh' },
        },
      ],
      organizationVersion: 1,
      selection: { kind: 'account' },
    })
  })

  test('blocks active source deletion but detaches historical source evidence safely', async () => {
    const sourceId = randomUUID()
    await insertCorporationSourceFixture(sourceId, userId, characterId)
    const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
      select subject_lifecycle_id
      from platform_subject_lifecycles
      where character_id = ${characterId}
    `
    await connection`update characters set is_main = false where character_id = ${characterId}`

    await expect(
      deleteCharacter(userId, characterId, lifecycle!.subject_lifecycle_id),
    ).resolves.toBe('corporation-source')
    await connection`
      update organization_corporation_sources
      set
        revoked_at = now(),
        revoked_by_user_id = ${userId},
        revocation_reason = 'Replaced source'
      where source_id = ${sourceId}
    `
    await expect(
      deleteCharacter(userId, characterId, lifecycle!.subject_lifecycle_id),
    ).resolves.toBe('deleted')

    const [historical] = await connection<
      { character_id: string | null; evidence_character_id: string }[]
    >`
      select character_id, evidence_character_id
      from organization_corporation_sources
      where source_id = ${sourceId}
    `
    expect(historical).toStrictEqual({
      character_id: null,
      evidence_character_id: String(characterId),
    })
    await expect(
      connection<{ ended_at: Date | null }[]>`
      select ended_at
      from organization_managed_member_lifecycles
      where deployment_id = 1 and organization_version = 1 and user_id = ${userId}
    `.then((rows) => [...rows]),
    ).resolves.toStrictEqual([{ ended_at: expect.any(Date) }])
  })

  test('persists compliance changes idempotently with normalized issues and stable events', async () => {
    const evaluatedAt = new Date('2026-09-01T12:00:00.000Z')

    await expect(
      recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        now: evaluatedAt,
        organizationVersion: 1,
        userId,
      }),
    ).resolves.toMatchObject({ evaluation: { state: 'compliant' }, outcome: 'changed' })
    await expect(
      recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        now: new Date('2026-09-01T12:05:00.000Z'),
        organizationVersion: 1,
        userId,
      }),
    ).resolves.toMatchObject({ evaluation: { state: 'compliant' }, outcome: 'unchanged' })

    const [counts] = await connection<
      { projections: number; issues: number; audits: number; events: number }[]
    >`
      select
        (select count(*)::integer from organization_account_compliance) as projections,
        (select count(*)::integer from organization_compliance_issues) as issues,
        (select count(*)::integer from organization_audit_events
          where event_type = 'compliance.transitioned') as audits,
        (select count(*)::integer from domain_events
          where event_type = 'organization.compliance-transitioned') as events
    `
    expect(counts).toStrictEqual({ audits: 1, events: 1, issues: 0, projections: 1 })
  })

  test('suspends an account when an attached character authorization is removed', async () => {
    await expect(
      recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        organizationVersion: 1,
        userId,
      }),
    ).resolves.toMatchObject({ evaluation: { state: 'compliant' } })

    await connection`delete from eve_tokens where character_id = ${characterId}`

    await expect(
      recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        organizationVersion: 1,
        userId,
      }),
    ).resolves.toMatchObject({
      evaluation: {
        accessValidUntil: null,
        issues: [
          {
            issueKey: `character:${characterId}:authorization-missing`,
            issueCode: 'character-authorization-missing',
            characterId,
            requiredScope: null,
          },
        ],
        state: 'suspended',
      },
    })
  })

  test('prevents owner lockout and permits a verified owner to recover a bad policy', async () => {
    await ensureManagedCorporation()
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId,
    })

    await expect(
      updateOrganizationRegistrationPolicy({
        actorUserId: userId,
        authorityEvidenceFreshDurationSeconds: 3600,
        derivedDirectorAuthorityEnabled: true,
        reason: 'Require current wallet authorization.',
        requiredScopes: ['esi-wallet.read_character_wallet.v1'],
        staleEvidenceGraceDurationSeconds: 3600,
        strictRemediationDurationSeconds: 0,
      }),
    ).rejects.toMatchObject({ code: 'owner-policy-noncompliant' })
    const [unchanged] = await connection<
      { policy_version: string; required_scopes: string[]; state: string; audits: number }[]
    >`
      select settings.registration_policy_version as policy_version,
        settings.required_registration_scopes as required_scopes,
        projection.state,
        (select count(*)::integer from organization_audit_events
          where event_type = 'registration-policy.changed') as audits
      from deployment_settings settings
      join organization_account_compliance projection
        on projection.deployment_id = settings.id
        and projection.organization_version = settings.organization_version
        and projection.user_id = ${userId}
      where settings.id = 1
    `
    expect(unchanged).toStrictEqual({
      audits: 0,
      policy_version: '1',
      required_scopes: [],
      state: 'compliant',
    })

    await connection`
      update deployment_settings
      set required_registration_scopes = '["esi-wallet.read_character_wallet.v1"]'::jsonb,
        registration_policy_version = 2
      where id = 1
    `
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId,
    })
    await expect(
      updateOrganizationRegistrationPolicy({
        actorUserId: userId,
        authorityEvidenceFreshDurationSeconds: 3600,
        derivedDirectorAuthorityEnabled: true,
        reason: 'Restore a policy the verified owner satisfies.',
        requiredScopes: [],
        staleEvidenceGraceDurationSeconds: 3600,
        strictRemediationDurationSeconds: 0,
      }),
    ).resolves.toMatchObject({ policyVersion: 3, requiredScopes: [] })
    const [recovered] = await connection<{ state: string }[]>`
      select state from organization_account_compliance where user_id = ${userId}
    `
    expect(recovered).toStrictEqual({ state: 'compliant' })
  })

  test('rolls back policy and compliance together when transition persistence fails', async () => {
    await ensureManagedCorporation()
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId,
    })
    await connection`
      alter table domain_events
      add constraint reject_compliance_transition
      check (event_type <> 'organization.compliance-transitioned') not valid
    `
    try {
      await expect(
        updateOrganizationRegistrationPolicy({
          actorUserId: userId,
          authorityEvidenceFreshDurationSeconds: 3600,
          derivedDirectorAuthorityEnabled: true,
          reason: 'This mutation must roll back.',
          requiredScopes: ['esi-wallet.read_character_wallet.v1'],
          staleEvidenceGraceDurationSeconds: 3600,
          strictRemediationDurationSeconds: 0,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } })
    } finally {
      await connection`
        alter table domain_events drop constraint if exists reject_compliance_transition
      `
    }

    const [state] = await connection<
      {
        policy_version: string
        required_scopes: string[]
        compliance_state: string
        audits: number
      }[]
    >`
      select
        settings.registration_policy_version as policy_version,
        settings.required_registration_scopes as required_scopes,
        projection.state as compliance_state,
        (select count(*)::integer from organization_audit_events
          where event_type = 'registration-policy.changed') as audits
      from deployment_settings settings
      join organization_account_compliance projection
        on projection.deployment_id = settings.id
        and projection.organization_version = settings.organization_version
        and projection.user_id = ${userId}
      where settings.id = 1
    `
    expect(state).toStrictEqual({
      audits: 0,
      compliance_state: 'compliant',
      policy_version: '1',
      required_scopes: [],
    })
  })

  test('retains established entitlements only until a configured remediation deadline', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await establishCompliantAccount(targetUserId, 90_000_001)
    await updateOrganizationRegistrationPolicy({
      actorUserId: userId,
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      reason: 'Allow one hour for established member remediation.',
      requiredScopes: [],
      staleEvidenceGraceDurationSeconds: 3600,
      strictRemediationDurationSeconds: 3600,
    })
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Review-period access',
      permissions: [
        { type: 'service', key: 'discord.review-member', reviewAllowed: true },
        { type: 'service', key: 'discord.review-denied', reviewAllowed: false },
      ],
      reason: 'Create review-period access.',
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [bundle.bundleId],
      complianceSource: null,
      managementMode: 'manual',
      name: 'Review-period members',
      restricted: false,
    })
    await assignOrganizationGroup({
      actorUserId: userId,
      expiresAt: null,
      groupId: group.groupId,
      reason: 'Established member access.',
      targetUserId,
    })
    await connection`
      update characters
      set corporation_id = 98000002, affiliation_checked_at = now(),
        next_affiliation_check = now() + interval '1 hour'
      where user_id = ${targetUserId}
    `
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId: targetUserId,
    })

    const [review] = await connection<
      { state: string; review_deadline: Date; access_valid_until: Date }[]
    >`
      select state, review_deadline, access_valid_until
      from organization_account_compliance
      where deployment_id = 1 and organization_version = 1 and user_id = ${targetUserId}
    `
    expect(review).toMatchObject({ state: 'review_required' })
    expect(review!.access_valid_until).toStrictEqual(review!.review_deadline)
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: [],
      services: ['discord.review-member'],
    })

    const afterDeadline = new Date(review!.review_deadline.getTime() + 1)
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      now: afterDeadline,
      organizationVersion: 1,
      userId: targetUserId,
    })
    await expect(
      getOrganizationGroupPermissions(targetUserId, afterDeadline),
    ).resolves.toStrictEqual({
      modules: [],
      services: [],
    })
    await expect(loadComplianceState(targetUserId)).resolves.toBe('suspended')
  })

  test('clears first-time review deadlines when affiliation evidence becomes incomplete', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await updateOrganizationRegistrationPolicy({
      actorUserId: userId,
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      reason: 'Allow a bounded first-time review.',
      requiredScopes: [],
      staleEvidenceGraceDurationSeconds: 3600,
      strictRemediationDurationSeconds: 3600,
    })
    const targetUserId = randomUUID()
    await seedCharacter(targetUserId, 90_000_001)
    await connection`
      update characters set corporation_id = 98000002 where user_id = ${targetUserId}
    `
    await expect(
      recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        organizationVersion: 1,
        userId: targetUserId,
      }),
    ).resolves.toMatchObject({
      evaluation: { accessValidUntil: null, state: 'review_required' },
    })
    await connection`
      update characters
      set affiliation_resolution_state = 'pending',
        affiliation_checked_at = now() - interval '2 hours',
        next_affiliation_check = now() - interval '1 hour'
      where user_id = ${targetUserId}
    `

    await expect(
      recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        organizationVersion: 1,
        userId: targetUserId,
      }),
    ).resolves.toMatchObject({
      evaluation: { accessValidUntil: null, reviewDeadline: null, state: 'pending' },
    })
  })

  test('approves, expires, and revokes exceptions with same-transaction compliance changes', async () => {
    await ensureManagedCorporation()
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await grantOrganizationRole({
      actorUserId: userId,
      reason: 'Registration review duty.',
      role: 'hr_auditor',
      targetUserId: userId,
    })
    const targetUserId = randomUUID()
    const managedCharacterId = 90_000_001
    const externalCharacterId = 90_000_002
    await seedCharacter(targetUserId, managedCharacterId)
    await connection`
      insert into characters (
        character_id, user_id, owner_hash, name, corporation_id, affiliation_checked_at,
        next_affiliation_check, affiliation_resolution_state, is_main
      ) values (
        ${externalCharacterId}, ${targetUserId}, ${`owner-${externalCharacterId}`}, 'External Pilot', 98000002, now(),
        now() + interval '1 hour', 'resolved', false
      )
    `
    await connection`
      insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes)
      values (${externalCharacterId}, 'external-token', now() + interval '1 hour', '[]'::jsonb)
    `
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId: targetUserId,
    })

    const expiresAt = new Date(Date.now() + 60_000)
    const first = await approveOrganizationCharacterException({
      actorUserId: userId,
      characterId: externalCharacterId,
      expiresAt,
      reason: 'Approved disclosed external character.',
      userId: targetUserId,
    })
    await expect(loadComplianceState(targetUserId)).resolves.toBe('compliant')

    await expireOrganizationCharacterExceptions(new Date(expiresAt.getTime() + 1), 10)
    await expect(loadComplianceState(targetUserId)).resolves.toBe('suspended')

    const second = await approveOrganizationCharacterException({
      actorUserId: userId,
      characterId: externalCharacterId,
      expiresAt: null,
      reason: 'Renewed external-character approval.',
      userId: targetUserId,
    })
    await expect(loadComplianceState(targetUserId)).resolves.toBe('compliant')
    await expireOrganizationCharacterException({
      actorUserId: userId,
      exceptionId: second.exceptionId,
      reason: 'The renewed approval window ended.',
    })
    await expect(loadComplianceState(targetUserId)).resolves.toBe('suspended')

    const third = await approveOrganizationCharacterException({
      actorUserId: userId,
      characterId: externalCharacterId,
      expiresAt: null,
      reason: 'Final external-character approval.',
      userId: targetUserId,
    })
    await expect(loadComplianceState(targetUserId)).resolves.toBe('compliant')
    await revokeOrganizationCharacterException({
      actorUserId: userId,
      exceptionId: third.exceptionId,
      reason: 'External-character approval withdrawn.',
    })
    await expect(loadComplianceState(targetUserId)).resolves.toBe('suspended')

    const decisions = await connection<{ event_type: string; subject_id: string }[]>`
      select event_type, subject_id
      from organization_audit_events
      where event_type in ('exception.approved', 'exception.expired', 'exception.revoked')
      order by audit_sequence
    `
    expect([...decisions]).toStrictEqual([
      { event_type: 'exception.approved', subject_id: first.exceptionId },
      { event_type: 'exception.expired', subject_id: first.exceptionId },
      { event_type: 'exception.approved', subject_id: second.exceptionId },
      { event_type: 'exception.expired', subject_id: second.exceptionId },
      { event_type: 'exception.approved', subject_id: third.exceptionId },
      { event_type: 'exception.revoked', subject_id: third.exceptionId },
    ])
  })

  test('refuses new alliance exceptions while managed-corporation evidence is stale', async () => {
    await updateDeploymentOrganization(
      { id: 99_000_001, name: 'Test Alliance', ticker: 'ALLY', type: 'alliance' },
      adminId,
    )
    await connection`
      insert into organization_role_grants (
        deployment_id, organization_version, user_id, role, granted_by_user_id, reason
      ) values (1, 2, ${userId}, 'hr_auditor', ${userId}, 'Test HR authority.')
    `
    const targetUserId = randomUUID()
    const targetCharacterId = 90_000_001
    await seedCharacter(targetUserId, targetCharacterId)
    await connection`
      update organization_account_compliance
      set state = 'compliant', evidence_freshness = 'fresh', evidence_at = now(),
        access_valid_until = now() + interval '1 hour', established_compliant_at = now(),
        authoritative = true, review_deadline = null, evaluated_at = now(), updated_at = now()
      where deployment_id = 1 and organization_version = 2 and user_id = ${userId}
    `

    await expect(
      approveOrganizationCharacterException({
        actorUserId: userId,
        characterId: targetCharacterId,
        expiresAt: null,
        reason: 'Cannot be approved from stale alliance evidence.',
        userId: targetUserId,
      }),
    ).rejects.toMatchObject({ code: 'managed-corporation-evidence-stale' })
  })

  test('repairs a missing current-version compliance projection from PostgreSQL state', async () => {
    await ensureManagedCorporation()
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId,
    })
    await connection`delete from organization_account_compliance where user_id = ${userId}`

    await expect(repairOrganizationCompliance({ limit: 10 })).resolves.toMatchObject({
      repaired: 1,
    })
    await expect(loadComplianceState(userId)).resolves.toBe('compliant')
  })

  test('returns only caller-owned compliance reasons, freshness, and remediation actions', async () => {
    const pendingUserId = randomUUID()
    await connection`insert into users (id) values (${pendingUserId})`

    await expect(getOrganizationAccountComplianceDetails(pendingUserId)).resolves.toMatchObject({
      accountReasons: [{ code: 'no-attached-characters' }],
      characters: [],
      disclosureNotice: expect.stringContaining('member disclosure'),
      evidenceFreshness: 'unavailable',
      organizationVersion: 1,
      remediationActions: [{ type: 'attach-character', path: '/auth/eve/attach' }],
      state: 'pending',
    })

    await ensureManagedCorporation()
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId,
    })
    await expect(getOrganizationAccountComplianceDetails(userId)).resolves.toMatchObject({
      characters: [
        {
          characterId,
          affiliationFreshness: 'fresh',
          affiliationCheckedAt: expect.any(String),
          nextAffiliationCheck: expect.any(String),
          reasons: [],
          remediationActions: [],
        },
      ],
      state: 'compliant',
    })
  })

  test('recomputes an expired projection before constructing protected session context', async () => {
    await ensureManagedCorporation()
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId,
    })
    await connection`
      update organization_account_compliance
      set access_valid_until = now() - interval '1 second'
      where user_id = ${userId}
    `

    await expect(loadOrganizationSessionContext(userId)).resolves.toMatchObject({
      accessValidUntil: expect.any(Date),
      blocked: false,
      evidenceFreshness: 'fresh',
      organizationVersion: 1,
      state: 'compliant',
    })
    const context = await loadOrganizationSessionContext(userId)
    expect(context.accessValidUntil!.getTime()).toBeGreaterThan(Date.now())
  })

  test('recomputes disclosed accounts from current state when a managed corporation departs', async () => {
    const observedAt = new Date()
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      now: observedAt,
      organizationVersion: 1,
      userId,
    })
    const [initialLifecycle] = await connection<{ managed_member_lifecycle_id: string }[]>`
      select managed_member_lifecycle_id
      from organization_managed_member_lifecycles
      where deployment_id = 1 and organization_version = 1 and user_id = ${userId}
        and ended_at is null
    `
    await connection`
      update organization_managed_corporations
      set is_current = false,
        removed_at = greatest(${observedAt}, first_observed_at),
        updated_at = greatest(${observedAt}, first_observed_at)
      where deployment_id = 1 and organization_version = 1 and corporation_id = 98000001
    `

    await recomputeComplianceForManagedCorporation({
      corporationId: 98_000_001,
      deploymentId: 1,
      organizationVersion: 1,
    })

    const projections = await connection<
      { state: string; issue_code: string; character_id: string | null }[]
    >`
      select projection.state, issue.issue_code, issue.character_id
      from organization_account_compliance projection
      join organization_compliance_issues issue
        using (deployment_id, organization_version, user_id)
      where projection.user_id = ${userId}
      order by issue.issue_key
    `
    expect([...projections]).toStrictEqual([
      {
        character_id: null,
        issue_code: 'no-managed-organization-character',
        state: 'suspended',
      },
      {
        character_id: String(characterId),
        issue_code: 'character-outside-managed-organization',
        state: 'suspended',
      },
    ])
    await expect(
      connection<{ ended_at: Date | null }[]>`
      select ended_at
      from organization_managed_member_lifecycles
      where managed_member_lifecycle_id = ${initialLifecycle!.managed_member_lifecycle_id}
    `.then((rows) => [...rows]),
    ).resolves.toStrictEqual([{ ended_at: expect.any(Date) }])

    await connection`
      update organization_managed_corporations
      set is_current = true, removed_at = null, updated_at = now()
      where deployment_id = 1 and organization_version = 1 and corporation_id = 98000001
    `
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId,
    })
    const lifecycles = await connection<
      { managed_member_lifecycle_id: string; ended_at: Date | null }[]
    >`
      select managed_member_lifecycle_id, ended_at
      from organization_managed_member_lifecycles
      where deployment_id = 1 and organization_version = 1 and user_id = ${userId}
      order by started_at, managed_member_lifecycle_id
    `
    expect(lifecycles).toHaveLength(2)
    expect(lifecycles).toContainEqual({
      ended_at: expect.any(Date),
      managed_member_lifecycle_id: initialLifecycle!.managed_member_lifecycle_id,
    })
    expect(lifecycles).toContainEqual({
      ended_at: null,
      managed_member_lifecycle_id: expect.not.stringMatching(
        initialLifecycle!.managed_member_lifecycle_id,
      ),
    })
  })

  test('registers a source and its scheduler lifecycle atomically for an eligible owner', async () => {
    await connection`
      update eve_tokens
      set scopes = '[
        "esi-characters.read_corporation_roles.v1",
        "esi-corporations.read_corporation_membership.v1"
      ]'::jsonb
      where character_id = ${characterId}
    `
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )

    await expect(
      registerOrganizationCorporationSource({
        actorUserId: userId,
        characterId,
        corporationId: 98_000_001,
      }),
    ).resolves.toMatchObject({
      replaced: false,
      source: { characterId, corporationId: 98_000_001, organizationVersion: 1 },
    })
    const [stored] = await connection<
      {
        source_id: string
        lifecycle_source_id: string
        audit_type: string
      }[]
    >`
      select
        source.source_id,
        lifecycle.corporation_source_id as lifecycle_source_id,
        audit.event_type as audit_type
      from organization_corporation_sources source
      join platform_subject_lifecycles lifecycle
        on lifecycle.corporation_source_id = source.source_id
      join organization_audit_events audit
        on audit.subject_id = source.source_id::text
      where source.revoked_at is null
    `
    expect(stored).toMatchObject({
      audit_type: 'corporation-source.registered',
      lifecycle_source_id: stored?.source_id,
    })
  })

  test('rejects source registration after the candidate affiliation evidence expires', async () => {
    await connection`
      update eve_tokens
      set scopes = '[
        "esi-characters.read_corporation_roles.v1",
        "esi-corporations.read_corporation_membership.v1"
      ]'::jsonb
      where character_id = ${characterId}
    `
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update characters
      set next_affiliation_check = now() - interval '1 second'
      where character_id = ${characterId}
    `

    await expect(
      registerOrganizationCorporationSource({
        actorUserId: userId,
        characterId,
        corporationId: 98_000_001,
      }),
    ).rejects.toMatchObject({ code: 'source-character-affiliation-stale' })

    const [stored] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_corporation_sources
    `
    expect(stored?.count).toBe(0)
  })

  test('withholds roster observations after the source authorization generation changes', async () => {
    const { observedCharacterId } = await establishRosterObservation()

    await expect(listOrganizationRosterCoverage()).resolves.toMatchObject({
      corporations: [
        {
          unregisteredCharacters: [
            { characterId: observedCharacterId, observedAt: expect.any(String) },
          ],
        },
      ],
    })

    await connection`
      update eve_tokens
      set token_version = token_version + 1
      where character_id = ${characterId}
    `

    await expect(listOrganizationRosterCoverage()).resolves.toMatchObject({
      corporations: [{ unregisteredCharacters: [] }],
    })
  })

  test('removes a newly attached managed character from the unregistered roster', async () => {
    const { observedCharacterId } = await establishRosterObservation()

    await expect(listOrganizationRosterCoverage()).resolves.toMatchObject({
      corporations: [
        {
          unregisteredCharacters: [
            { characterId: observedCharacterId, observedAt: expect.any(String) },
          ],
        },
      ],
    })

    await seedCharacter(randomUUID(), observedCharacterId)

    await expect(listOrganizationRosterCoverage()).resolves.toMatchObject({
      corporations: [{ unregisteredCharacters: [] }],
    })
  })

  test('withholds roster observations collected by a replaced source', async () => {
    await establishRosterObservation()
    const replacementCharacterId = await prepareCorporationSourceReplacementCharacter()

    await expect(
      registerOrganizationCorporationSource({
        actorUserId: userId,
        characterId: replacementCharacterId,
        corporationId: 98_000_001,
      }),
    ).resolves.toMatchObject({ replaced: true })

    await expect(listOrganizationRosterCoverage()).resolves.toMatchObject({
      corporations: [
        {
          source: { characterId: replacementCharacterId },
          status: 'pending',
          unregisteredCharacters: [],
        },
      ],
    })
  })

  test('requires fresh authority to replace a corporation source', async () => {
    await establishRosterObservation()
    const replacementCharacterId = await prepareCorporationSourceReplacementCharacter()
    await connection`
      update organization_authority_evidence
      set status = 'degraded',
        failure_class = 'transient:esi-unavailable',
        observed_at = now() - interval '2 hours',
        fresh_until = now() - interval '1 hour',
        grace_until = now() + interval '1 hour',
        last_checked_at = now(),
        updated_at = now()
      where user_id = ${userId} and invalidated_at is null
    `
    await connection`
      update organization_derived_authority_sources
      set status = 'degraded',
        failure_class = 'transient:esi-unavailable',
        observed_at = now() - interval '2 hours',
        fresh_until = now() - interval '1 hour',
        grace_until = now() + interval '1 hour',
        updated_at = now()
      where user_id = ${userId} and invalidated_at is null
    `

    await expect(
      registerOrganizationCorporationSource({
        actorUserId: userId,
        characterId: replacementCharacterId,
        corporationId: 98_000_001,
      }),
    ).rejects.toMatchObject({ code: 'manager-authority-degraded' })

    await expect(
      connection<{ character_id: string }[]>`
      select character_id
      from organization_corporation_sources
      where revoked_at is null
    `.then((rows) => [...rows]),
    ).resolves.toStrictEqual([{ character_id: String(characterId) }])
  })

  test('derives Director authority from a non-main source and keeps main selection authority-neutral', async () => {
    const sourceCharacterId = characterId + 1
    const sourceLifecycleId = await attachCharacterToExistingAccount(userId, sourceCharacterId)
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId,
    })
    const affiliationCheckedAt = await loadAffiliationCheckedAt(sourceCharacterId)
    ownerEvidenceMocks.observeAndPersistCharacterAffiliation.mockResolvedValue({
      affiliationCheckedAt,
      affiliationFreshUntil: new Date(Date.now() + 60 * 60 * 1000),
      allianceId: null,
      characterId: sourceCharacterId,
      corporationId: 98_000_001,
      stale: false,
    })
    ownerEvidenceMocks.getCharacterCorporationRolesEvidence.mockResolvedValue(
      roleEvidence({ roleEvidenceRevision: 'derived-role-v1' }),
    )

    await expect(
      refreshDerivedDirectorAuthority({
        authorizationGeneration: 0,
        characterId: sourceCharacterId,
        organizationVersion: 1,
        roleEvidenceRevision: null,
        sourceId: null,
        subjectLifecycleId: sourceLifecycleId,
        userId,
      }),
    ).resolves.toBe('fresh')
    await expect(hasCurrentOrganizationManagerAuthority(userId, 'mutate')).resolves.toBe(true)

    await expect(setMainCharacter(userId, sourceCharacterId)).resolves.toMatchObject({
      characterId: sourceCharacterId,
      isMain: true,
    })
    await expect(hasCurrentOrganizationManagerAuthority(userId, 'mutate')).resolves.toBe(true)
    await expect(setMainCharacter(userId, characterId)).resolves.toMatchObject({
      characterId,
      isMain: true,
    })
    await expect(hasCurrentOrganizationManagerAuthority(userId, 'mutate')).resolves.toBe(true)

    const [source] = await connection<{ source_id: string; role_evidence_revision: string }[]>`
      select source_id, role_evidence_revision
      from organization_derived_authority_sources
      where character_id = ${sourceCharacterId} and invalidated_at is null
    `
    if (!source) {
      throw new Error('Derived authority source is missing')
    }
    ownerEvidenceMocks.getCharacterCorporationRolesEvidence.mockResolvedValue(
      roleEvidence({
        roleEvidenceRevision: 'derived-role-v2',
        roles: [],
      }),
    )

    await expect(
      refreshDerivedDirectorAuthority({
        authorizationGeneration: 0,
        characterId: sourceCharacterId,
        organizationVersion: 1,
        roleEvidenceRevision: source.role_evidence_revision,
        sourceId: source.source_id,
        subjectLifecycleId: sourceLifecycleId,
        userId,
      }),
    ).resolves.toBe('invalid')
    await expect(hasCurrentOrganizationManagerAuthority(userId, 'mutate')).resolves.toBe(false)
    const [invalidated] = await connection<
      { status: string; director_role_present: boolean; invalidation_outcome: string }[]
    >`
      select status, director_role_present, invalidation_outcome
      from organization_derived_authority_sources
      where source_id = ${source.source_id}
    `
    expect(invalidated).toStrictEqual({
      director_role_present: false,
      invalidation_outcome: 'not-director',
      status: 'invalid',
    })
  })

  test('commits an initial owner grant, fresh evidence, and audit entry atomically', async () => {
    const affiliationCheckedAt = await loadAffiliationCheckedAt()

    const grant = await claimOrganizationOwnership(ownerClaimInput({ affiliationCheckedAt }))

    const [stored] = await connection<
      {
        grant_id: string
        role: string
        evidence_status: string
        director_role_present: boolean
        event_type: string
        outcome: string
      }[]
    >`
      select
        grants.grant_id,
        grants.role,
        evidence.status as evidence_status,
        evidence.director_role_present,
        audit.event_type,
        audit.outcome
      from organization_role_grants grants
      join organization_authority_evidence evidence on evidence.grant_id = grants.grant_id
      join organization_audit_events audit on audit.subject_id = grants.grant_id::text
    `

    expect(stored).toStrictEqual({
      director_role_present: true,
      event_type: 'role.granted',
      evidence_status: 'fresh',
      grant_id: grant.grantId,
      outcome: 'granted',
      role: 'organization_owner',
    })
  })

  test('serializes competing first owner claims so exactly one claimant succeeds', async () => {
    const secondUserId = randomUUID()
    const secondCharacterId = characterId + 1
    const secondSubjectLifecycleId = await seedCharacter(secondUserId, secondCharacterId)

    const results = await Promise.allSettled([
      claimOrganizationOwnership(
        ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
      ),
      claimOrganizationOwnership(
        ownerClaimInput({
          affiliationCheckedAt: await loadAffiliationCheckedAt(secondCharacterId),
          characterId: secondCharacterId,
          subjectLifecycleId: secondSubjectLifecycleId,
          userId: secondUserId,
        }),
      ),
    ])
    const activeOwners = await connection<{ user_id: string }[]>`
      select user_id
      from organization_role_grants
      where role = 'organization_owner' and revoked_at is null
    `

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toStrictEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'owner-already-claimed' }),
      }),
    ])
    expect(activeOwners).toHaveLength(1)
  })

  test.each([
    ['stale organization version', { organizationVersion: 2 }, 'stale-organization'],
    ['different owner', { userId: randomUUID() }, 'character-not-owned'],
    ['different corporation', { observedCorporationId: 98_000_002 }, 'stale-affiliation'],
  ])(
    'rejects an owner claim with %s without partial persistence',
    async (_name, override, code) => {
      const affiliationCheckedAt = await loadAffiliationCheckedAt()

      await expect(
        claimOrganizationOwnership(ownerClaimInput({ affiliationCheckedAt, ...override })),
      ).rejects.toMatchObject({ code })
      await expect(loadOwnerClaimRowCounts()).resolves.toStrictEqual({
        audits: 0,
        evidence: 0,
        grants: 0,
      })
    },
  )

  test('rejects an owner claim when the stored token lacks the required scope', async () => {
    await connection`update eve_tokens set scopes = '[]'::jsonb where character_id = ${characterId}`

    await expect(
      claimOrganizationOwnership(
        ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
      ),
    ).rejects.toMatchObject({ code: 'missing-scope' })
    await expect(loadOwnerClaimRowCounts()).resolves.toStrictEqual({
      audits: 0,
      evidence: 0,
      grants: 0,
    })
  })

  test('reconstructs due owner evidence and refreshes it from current authority', async () => {
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update organization_authority_evidence
      set fresh_until = now() + interval '5 minutes'
      where grant_id = ${grant.grantId}
    `

    const due = await selectDueOrganizationOwnerEvidence()
    expect(due).toStrictEqual([
      expect.objectContaining({
        authorizationGeneration: 0,
        grantId: grant.grantId,
        organizationVersion: 1,
        roleEvidenceRevision: 'roles-0',
        sourceSubjectLifecycleId: subjectLifecycleId,
      }),
    ])
    await expect(refreshOrganizationOwnerEvidence(due[0]!)).resolves.toBe('fresh')
    expect(ownerEvidenceMocks.observeAndPersistCharacterAffiliation).toHaveBeenCalledWith(
      characterId,
      undefined,
      expect.any(Function),
    )
    await expect(selectDueOrganizationOwnerEvidence()).resolves.toStrictEqual([])
  })

  test('revokes and audits owner authority immediately after fresh Director loss by default', async () => {
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    ownerEvidenceMocks.getCharacterCorporationRolesEvidence.mockResolvedValue(
      roleEvidence({ roles: ['Accountant'] }),
    )

    await expect(refreshOwnerEvidence(grant.grantId)).resolves.toBe('revoked')
    const [stored] = await connection<
      { revoked_at: Date | null; status: string; failure_class: string; audit_count: number }[]
    >`
      select
        grants.revoked_at,
        evidence.status,
        evidence.failure_class,
        (select count(*)::integer from organization_audit_events
          where event_type = 'authority-source.invalidated') as audit_count
      from organization_role_grants grants
      join organization_authority_evidence evidence on evidence.grant_id = grants.grant_id
      where grants.grant_id = ${grant.grantId}
    `
    expect(stored).toMatchObject({
      audit_count: 1,
      failure_class: 'strict:not-director',
      revoked_at: null,
      status: 'invalid',
    })
  })

  test('invalidates every current character binding after Director loss across evidence revisions', async () => {
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update eve_tokens
      set scopes = scopes || '["esi-corporations.read_corporation_membership.v1"]'::jsonb
      where character_id = ${characterId}
    `
    await registerOrganizationCorporationSource({
      actorUserId: userId,
      characterId,
      corporationId: 98_000_001,
    })
    await expect(
      refreshDerivedDirectorAuthority({
        authorizationGeneration: 0,
        characterId,
        organizationVersion: 1,
        roleEvidenceRevision: null,
        sourceId: null,
        subjectLifecycleId,
        userId,
      }),
    ).resolves.toBe('fresh')
    await connection`
      update organization_corporation_sources
      set role_evidence_revision = 'corporation-revision'
      where evidence_character_id = ${characterId} and invalidated_at is null
    `
    await connection`
      update organization_derived_authority_sources
      set role_evidence_revision = 'derived-revision'
      where character_id = ${characterId} and invalidated_at is null
    `
    ownerEvidenceMocks.getCharacterCorporationRolesEvidence.mockResolvedValue(
      roleEvidence({ roleEvidenceRevision: 'negative-revision', roles: [] }),
    )

    await expect(refreshOwnerEvidence(grant.grantId)).resolves.toBe('revoked')

    const bindings = await connection<
      { source_type: string; status: string; director_role_present: boolean }[]
    >`
      select 'owner' as source_type, status, director_role_present
      from organization_authority_evidence
      where character_id = ${characterId}
      union all
      select 'derived' as source_type, status, director_role_present
      from organization_derived_authority_sources
      where character_id = ${characterId}
      union all
      select 'corporation' as source_type, status, director_role_present
      from organization_corporation_sources
      where evidence_character_id = ${characterId}
      order by source_type
    `
    expect([...bindings]).toStrictEqual([
      { director_role_present: false, source_type: 'corporation', status: 'invalid' },
      { director_role_present: false, source_type: 'derived', status: 'invalid' },
      { director_role_present: false, source_type: 'owner', status: 'invalid' },
    ])
  })

  test('bounds transient degradation by the last successful evidence without sliding its deadline', async () => {
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update organization_authority_evidence
      set
        observed_at = now() - interval '2 hours',
        fresh_until = now() - interval '1 second',
        last_checked_at = now() - interval '2 hours'
      where grant_id = ${grant.grantId}
    `
    await expect(getOrganizationAccessContext(userId)).resolves.toMatchObject({
      claimAvailable: true,
      isOrganizationOwner: false,
      ownerStatus: 'invalid',
    })
    await expect(listCurrentOrganizationRoles()).resolves.toMatchObject({
      ownerSources: [expect.objectContaining({ status: 'invalid' })],
    })
    ownerEvidenceMocks.observeAndPersistCharacterAffiliation.mockResolvedValue({
      affiliationCheckedAt: new Date(),
      affiliationFreshUntil: new Date(Date.now() + 60 * 60 * 1000),
      allianceId: null,
      characterId,
      corporationId: 98_000_001,
      stale: true,
    })

    await expect(refreshOwnerEvidence(grant.grantId)).resolves.toBe('degraded')
    const [first] = await connection<{ grace_until: Date }[]>`
      select grace_until
      from organization_authority_evidence
      where grant_id = ${grant.grantId}
    `
    await expect(refreshOwnerEvidence(grant.grantId)).resolves.toBe('degraded')
    const [second] = await connection<{ grace_until: Date }[]>`
      select grace_until
      from organization_authority_evidence
      where grant_id = ${grant.grantId}
    `
    expect(second?.grace_until).toStrictEqual(first?.grace_until)
    expect(first?.grace_until.getTime()).toBeGreaterThan(Date.now())
  })

  test('never revives owner evidence after a strict failure', async () => {
    await connection`
      update deployment_settings
      set strict_remediation_duration_seconds = 86400, stale_evidence_grace_duration_seconds = 7200
      where id = 1
    `
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    ownerEvidenceMocks.getCharacterCorporationRolesEvidence.mockResolvedValue(
      roleEvidence({ roles: ['Accountant'] }),
    )

    await expect(refreshOwnerEvidence(grant.grantId)).resolves.toBe('revoked')
    const [strictFailure] = await connection<{ invalidated_at: Date }[]>`
      select invalidated_at from organization_authority_evidence where grant_id = ${grant.grantId}
    `

    ownerEvidenceMocks.observeAndPersistCharacterAffiliation.mockResolvedValue({
      affiliationCheckedAt: new Date(),
      affiliationFreshUntil: new Date(Date.now() + 60 * 60 * 1000),
      allianceId: null,
      characterId,
      corporationId: 98_000_001,
      stale: true,
    })
    await expect(refreshOwnerEvidence(grant.grantId)).resolves.toBe('ineligible')
    const [afterRetry] = await connection<{ invalidated_at: Date }[]>`
      select invalidated_at from organization_authority_evidence where grant_id = ${grant.grantId}
    `

    expect(afterRetry?.invalidated_at).toStrictEqual(strictFailure?.invalidated_at)
  })

  test('treats a successful owner refresh superseded by newer affiliation as obsolete', async () => {
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update characters
      set corporation_id = 98000002, affiliation_checked_at = now() + interval '1 second'
      where character_id = ${characterId}
    `

    await expect(refreshOwnerEvidence(grant.grantId)).resolves.toBe('superseded')
    await expect(selectDueOrganizationOwnerEvidence()).resolves.toStrictEqual([])
  })

  test('atomically replaces an owner whose strict authority source is invalid', async () => {
    const original = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update organization_authority_evidence
      set
        status = 'invalid',
        failure_class = 'strict:not-director',
        grace_until = null,
        invalidated_at = now(),
        invalidation_outcome = 'not-director'
      where grant_id = ${original.grantId}
    `
    const replacementUserId = randomUUID()
    const replacementCharacterId = characterId + 1
    const replacementSubjectLifecycleId = await seedCharacter(
      replacementUserId,
      replacementCharacterId,
    )
    await expect(getOrganizationAccessContext(replacementUserId)).resolves.toMatchObject({
      claimAvailable: true,
    })

    const replacement = await claimOrganizationOwnership(
      ownerClaimInput({
        affiliationCheckedAt: await loadAffiliationCheckedAt(replacementCharacterId),
        characterId: replacementCharacterId,
        subjectLifecycleId: replacementSubjectLifecycleId,
        userId: replacementUserId,
      }),
    )
    const grants = await connection<
      { grant_id: string; revoked_at: Date | null; status: string }[]
    >`
      select grants.grant_id, grants.revoked_at, evidence.status
      from organization_role_grants grants
      join organization_authority_evidence evidence on evidence.grant_id = grants.grant_id
      order by grants.granted_at, grants.grant_id
    `
    const [audits] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_audit_events
      where event_type in ('role.granted', 'role.revoked')
    `

    expect([...grants]).toStrictEqual([
      { grant_id: original.grantId, revoked_at: expect.any(Date), status: 'invalid' },
      { grant_id: replacement.grantId, revoked_at: null, status: 'fresh' },
    ])
    expect(audits?.count).toBe(3)
  })

  test('does not expose or permit owner replacement during a transient evidence failure', async () => {
    const original = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update organization_authority_evidence
      set
        status = 'degraded',
        failure_class = 'transient:esi-unavailable',
        grace_until = greatest(fresh_until, now() + interval '2 hours')
      where grant_id = ${original.grantId}
    `
    const claimantUserId = randomUUID()
    const claimantCharacterId = characterId + 1
    const claimantSubjectLifecycleId = await seedCharacter(claimantUserId, claimantCharacterId)

    await expect(getOrganizationAccessContext(claimantUserId)).resolves.toMatchObject({
      claimAvailable: false,
    })
    await expect(
      claimOrganizationOwnership(
        ownerClaimInput({
          affiliationCheckedAt: await loadAffiliationCheckedAt(claimantCharacterId),
          characterId: claimantCharacterId,
          subjectLifecycleId: claimantSubjectLifecycleId,
          userId: claimantUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'owner-already-claimed' })
  })

  test('does not let a separately verified claimant displace a fresh owner', async () => {
    const original = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const claimantUserId = randomUUID()
    const claimantCharacterId = characterId + 1
    const claimantSubjectLifecycleId = await seedCharacter(claimantUserId, claimantCharacterId)

    await expect(
      claimOrganizationOwnership(
        ownerClaimInput({
          affiliationCheckedAt: await loadAffiliationCheckedAt(claimantCharacterId),
          characterId: claimantCharacterId,
          subjectLifecycleId: claimantSubjectLifecycleId,
          userId: claimantUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'owner-already-claimed' })
    const active = await connection<{ grant_id: string }[]>`
      select grant_id from organization_role_grants where revoked_at is null
    `
    expect([...active]).toStrictEqual([{ grant_id: original.grantId }])
  })

  test('does not let a blocked user occupy a vacant organization-owner grant', async () => {
    const ownerGrant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const claimantUserId = randomUUID()
    const claimantCharacterId = characterId + 1
    const claimantSubjectLifecycleId = await seedCharacter(claimantUserId, claimantCharacterId)
    await blockOrganizationMember({
      actorUserId: userId,
      reason: 'Member access remains under review.',
      targetUserId: claimantUserId,
    })
    ownerEvidenceMocks.getCharacterCorporationRolesEvidence.mockResolvedValue(
      roleEvidence({ roles: ['Accountant'] }),
    )
    await expect(refreshOwnerEvidence(ownerGrant.grantId)).resolves.toBe('revoked')
    await expect(getOrganizationAccessContext(claimantUserId)).resolves.toMatchObject({
      claimAvailable: false,
      isBlocked: true,
      isOrganizationOwner: false,
    })

    await expect(
      claimOrganizationOwnership(
        ownerClaimInput({
          affiliationCheckedAt: await loadAffiliationCheckedAt(claimantCharacterId),
          characterId: claimantCharacterId,
          subjectLifecycleId: claimantSubjectLifecycleId,
          userId: claimantUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'member-blocked' })
    const [activeOwners] = await connection<{ count: number }[]>`
      select count(*)::integer as count
      from organization_role_grants
      where role = 'organization_owner' and user_id = ${claimantUserId} and revoked_at is null
    `
    expect(activeOwners).toStrictEqual({ count: 0 })
  })

  test('retains historical authority evidence without pinning a revoked character row', async () => {
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update organization_role_grants
      set
        revoked_at = greatest(now(), granted_at),
        revocation_reason = 'Test replacement completed.'
      where grant_id = ${grant.grantId}
    `

    await expect(
      connection`delete from characters where character_id = ${characterId}`,
    ).resolves.toBeDefined()
    const [evidence] = await connection<{ character_id: string }[]>`
      select character_id from organization_authority_evidence where grant_id = ${grant.grantId}
    `
    expect(evidence?.character_id).toBe(String(characterId))
  })

  test('accepts a newer matching affiliation snapshot during owner claim persistence', async () => {
    const checkedAt = await loadAffiliationCheckedAt()

    await expect(
      claimOrganizationOwnership(
        ownerClaimInput({ affiliationCheckedAt: new Date(checkedAt.getTime() - 1000) }),
      ),
    ).resolves.toStrictEqual({ grantId: expect.any(String) })
  })

  test('grants and revokes HR roles with complete immutable current-version audit entries', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await connection`insert into users (id) values (${targetUserId})`

    const grant = await grantOrganizationRole({
      actorUserId: userId,
      reason: 'Delegated registration review.',
      role: 'hr_auditor',
      targetUserId,
    })
    const context = await getOrganizationAccessContext(userId)
    const activeRoles = await listCurrentOrganizationRoles()
    const revoked = await revokeOrganizationRole({
      actorUserId: userId,
      grantId: grant.grantId,
      reason: 'Delegation ended.',
    })
    const audits = await connection<
      {
        event_type: string
        actor_id: string
        subject_user_id: string
        role: string
        reason: string
        outcome: string
        occurred_at: Date
      }[]
    >`
      select
        audit.event_type,
        audit.actor_id,
        role_grant.user_id as subject_user_id,
        role_grant.role,
        audit.reason,
        audit.outcome,
        audit.occurred_at
      from organization_audit_events audit
      join organization_role_grants role_grant
        on role_grant.grant_id::text = audit.subject_id
      where audit.subject_id = ${grant.grantId}
      order by audit.audit_sequence
    `

    expect(revoked).toMatchObject({
      grantId: grant.grantId,
      revocationReason: 'Delegation ended.',
      revokedAt: expect.any(String),
      revokedByUserId: userId,
      role: 'hr_auditor',
    })
    expect(context).toMatchObject({
      authorityCharacter: {
        characterId,
        corporationId: 98_000_001,
        name: 'Organization Pilot',
      },
      claimAvailable: false,
      isOrganizationOwner: true,
      ownerStatus: 'fresh',
    })
    expect(activeRoles.grants).toStrictEqual([
      expect.objectContaining({
        grantId: grant.grantId,
        mainCharacterId: null,
        mainCharacterName: null,
        role: 'hr_auditor',
        userId: targetUserId,
      }),
    ])
    await expect(listCurrentOrganizationRoles()).resolves.toMatchObject({ grants: [] })
    expect([...audits]).toStrictEqual([
      {
        actor_id: userId,
        event_type: 'role.granted',
        occurred_at: expect.any(Date),
        outcome: 'granted',
        reason: 'Delegated registration review.',
        role: 'hr_auditor',
        subject_user_id: targetUserId,
      },
      {
        actor_id: userId,
        event_type: 'role.revoked',
        occurred_at: expect.any(Date),
        outcome: 'revoked',
        reason: 'Delegation ended.',
        role: 'hr_auditor',
        subject_user_id: targetUserId,
      },
    ])
  })

  test('advertises HR review capabilities only while the grantee is currently compliant', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await establishCompliantAccount(targetUserId, 90_000_001)
    await grantOrganizationRole({
      actorUserId: userId,
      reason: 'Registration review duty.',
      role: 'hr_auditor',
      targetUserId,
    })

    await expect(getOrganizationAccessContext(targetUserId)).resolves.toMatchObject({
      capabilities: { reviewRegistration: true, viewRosterCoverage: true },
    })

    await connection`
      update organization_account_compliance
      set state = 'suspended', access_valid_until = null, updated_at = now()
      where deployment_id = 1 and organization_version = 1 and user_id = ${targetUserId}
    `

    await expect(getOrganizationAccessContext(targetUserId)).resolves.toMatchObject({
      capabilities: { reviewRegistration: false, viewRosterCoverage: false },
    })
  })

  test('refuses delegated role mutations without current-version owner authority', async () => {
    const targetUserId = randomUUID()
    await connection`insert into users (id) values (${targetUserId})`

    await expect(
      grantOrganizationRole({
        actorUserId: userId,
        reason: 'Unauthorized attempt.',
        role: 'hr_auditor',
        targetUserId,
      }),
    ).rejects.toMatchObject({ code: 'owner-authority-required' })
  })

  test('invalidates prior owner and delegated authority when the organization changes', async () => {
    const ownerGrant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await connection`insert into users (id) values (${targetUserId})`
    await grantOrganizationRole({
      actorUserId: userId,
      reason: 'Current organization HR duty.',
      role: 'hr_auditor',
      targetUserId,
    })

    await updateDeploymentOrganization(
      { id: 98_000_002, name: 'Second Corporation', ticker: 'TWO', type: 'corporation' },
      adminId,
    )

    await expect(getOrganizationAccessContext(userId)).resolves.toMatchObject({
      authorityCharacter: null,
      claimAvailable: true,
      isOrganizationOwner: false,
      ownerStatus: null,
    })
    await expect(listCurrentOrganizationRoles()).resolves.toStrictEqual({
      corporationSources: [],
      derivedSources: [],
      grants: [],
      ownerSources: [],
    })
    const [evidence] = await connection<{ status: string; failure_class: string }[]>`
      select status, failure_class
      from organization_authority_evidence
      where grant_id = ${ownerGrant.grantId}
    `
    expect(evidence).toStrictEqual({
      failure_class: 'strict:organization-replaced',
      status: 'invalid',
    })
    const [sourceAudit] = await connection<{ count: number }[]>`
      select count(*)::integer as count
      from organization_audit_events
      where organization_version = 1
        and event_type = 'authority-source.invalidated'
        and subject_id = (
          select evidence_id::text from organization_authority_evidence
          where grant_id = ${ownerGrant.grantId}
        )
    `
    expect(sourceAudit?.count).toBe(1)
    await expect(
      grantOrganizationRole({
        actorUserId: userId,
        reason: 'Stale owner attempt.',
        role: 'director',
        targetUserId,
      }),
    ).rejects.toMatchObject({ code: 'owner-authority-required' })
  })

  test('keeps deployment administration independent from EVE-backed owner authority', async () => {
    await connection`
      insert into deployment_admins (id, email, password_hash)
      values (${userId}, 'dual-authority@example.com', 'test-password-hash')
    `
    await expect(getOrganizationAccessContext(userId)).resolves.toMatchObject({
      claimAvailable: true,
      isOrganizationOwner: false,
    })

    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await expect(getOrganizationAccessContext(userId)).resolves.toMatchObject({
      authorityCharacter: { characterId },
      isOrganizationOwner: true,
    })

    ownerEvidenceMocks.getCharacterCorporationRolesEvidence.mockResolvedValue(
      roleEvidence({ roles: ['Accountant'] }),
    )
    await expect(refreshOwnerEvidence(grant.grantId)).resolves.toBe('revoked')
    const [deploymentAdmin] = await connection<{ id: string }[]>`
      select id from deployment_admins where id = ${userId}
    `
    expect(deploymentAdmin?.id).toBe(userId)
    await expect(getOrganizationAccessContext(userId)).resolves.toMatchObject({
      claimAvailable: true,
      isOrganizationOwner: false,
    })
  })

  test('bundles named permissions into expiring audited manual group assignments', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await establishCompliantAccount(targetUserId, 90_000_001)
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Operations access',
      permissions: [
        organizationActivityPermission(),
        { type: 'service', key: 'discord.operations' },
        { type: 'service', key: 'discord.operations' },
      ],
      reason: 'Create operations access.',
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [bundle.bundleId],
      complianceSource: null,
      managementMode: 'manual',
      name: 'Operations',
      restricted: false,
    })
    const expiresAt = new Date(Date.now() + 60_000)
    const assignment = await assignOrganizationGroup({
      actorUserId: userId,
      expiresAt,
      groupId: group.groupId,
      reason: 'Temporary operations duty.',
      targetUserId,
    })

    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: ['organization-activity.view'],
      services: ['discord.operations'],
    })
    await connection`
      update characters
      set corporation_id = 98000002, affiliation_checked_at = now(),
        next_affiliation_check = now() + interval '1 hour'
      where user_id = ${targetUserId}
    `
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId: targetUserId,
    })
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: [],
      services: [],
    })
    const [revocation] = await connection<
      { event_type: string; subject_id: string; causation_type: string }[]
    >`
      select entitlement.event_type, entitlement.subject_id,
        causation.event_type as causation_type
      from organization_audit_events entitlement
      join organization_audit_events causation
        on causation.audit_id = entitlement.causation_audit_id
      where entitlement.event_type = 'entitlement.revoked'
    `
    expect(revocation).toStrictEqual({
      causation_type: 'compliance.transitioned',
      event_type: 'entitlement.revoked',
      subject_id: 'discord.operations',
    })
    await connection`
      update characters
      set corporation_id = 98000001, affiliation_checked_at = now(),
        next_affiliation_check = now() + interval '1 hour'
      where user_id = ${targetUserId}
    `
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId: targetUserId,
    })
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: ['organization-activity.view'],
      services: ['discord.operations'],
    })
    const [grant] = await connection<
      { event_type: string; subject_id: string; causation_type: string }[]
    >`
      select entitlement.event_type, entitlement.subject_id,
        causation.event_type as causation_type
      from organization_audit_events entitlement
      join organization_audit_events causation
        on causation.audit_id = entitlement.causation_audit_id
      where entitlement.event_type = 'entitlement.granted'
    `
    expect(grant).toStrictEqual({
      causation_type: 'compliance.transitioned',
      event_type: 'entitlement.granted',
      subject_id: 'discord.operations',
    })
    await expect(
      getOrganizationGroupPermissions(targetUserId, new Date(expiresAt.getTime() + 1)),
    ).resolves.toStrictEqual({ modules: [], services: [] })

    await expect(
      revokeOrganizationGroupAssignment({
        actorUserId: userId,
        assignmentId: assignment.assignmentId,
        groupId: group.groupId,
        reason: 'Operations duty ended.',
      }),
    ).rejects.toMatchObject({ code: 'assignment-not-found' })
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: [],
      services: [],
    })
    const audits = await connection<
      {
        event_type: string
        actor_type: string
        actor_id: string | null
        subject_id: string
        assignment_id: string
        target_user_id: string
        assignment_source: string
        entitlement_expires_at: Date
        occurred_at: Date
      }[]
    >`
      select
        event_type,
        actor_type,
        actor_id,
        subject_id,
        assignment_id,
        target_user_id,
        assignment_source,
        entitlement_expires_at,
        occurred_at
      from organization_audit_events
      where assignment_id = ${assignment.assignmentId}
      order by audit_sequence
    `
    expect([...audits]).toStrictEqual([
      {
        actor_id: userId,
        actor_type: 'user',
        assignment_id: assignment.assignmentId,
        assignment_source: 'manual',
        entitlement_expires_at: expiresAt,
        event_type: 'group.assigned',
        occurred_at: expect.any(Date),
        subject_id: group.groupId,
        target_user_id: targetUserId,
      },
      {
        actor_id: null,
        actor_type: 'system',
        assignment_id: assignment.assignmentId,
        assignment_source: 'manual',
        entitlement_expires_at: expiresAt,
        event_type: 'group.revoked',
        occurred_at: expiresAt,
        subject_id: group.groupId,
        target_user_id: targetUserId,
      },
    ])
  })

  test('requires owner authority for restricted group membership changes', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const directorUserId = randomUUID()
    const targetUserId = randomUUID()
    await establishCompliantAccount(directorUserId, 90_000_010)
    await connection`insert into users (id) values (${targetUserId})`
    await grantOrganizationRole({
      actorUserId: userId,
      reason: 'Delegated group management.',
      role: 'director',
      targetUserId: directorUserId,
    })
    await expect(
      createOrganizationPermissionBundle({
        actorUserId: directorUserId,
        name: 'Unauthorized definition',
        permissions: [{ type: 'service', key: 'discord.leadership' }],
        reason: 'Attempt an unauthorized definition.',
      }),
    ).rejects.toMatchObject({ code: 'owner-authority-required' })
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Restricted services',
      permissions: [{ type: 'service', key: 'discord.leadership' }],
      reason: 'Create restricted services.',
    })
    const restricted = await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [bundle.bundleId],
      complianceSource: null,
      managementMode: 'manual',
      name: 'Leadership',
      restricted: true,
    })

    await expect(
      assignOrganizationGroup({
        actorUserId: directorUserId,
        expiresAt: null,
        groupId: restricted.groupId,
        reason: 'Unauthorized restricted assignment.',
        targetUserId,
      }),
    ).rejects.toMatchObject({ code: 'owner-authority-required' })
    const ordinary = await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [bundle.bundleId],
      complianceSource: null,
      managementMode: 'manual',
      name: 'Fleet operations',
      restricted: false,
    })
    await expect(
      assignOrganizationGroup({
        actorUserId: directorUserId,
        expiresAt: null,
        groupId: ordinary.groupId,
        reason: 'Delegated ordinary assignment.',
        targetUserId,
      }),
    ).resolves.toMatchObject({ assignmentSource: 'manual', userId: targetUserId })
  })

  test('converges compliance-managed groups only from their declared source', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await establishCompliantAccount(targetUserId, 90_000_001)
    await updateOrganizationRegistrationPolicy({
      actorUserId: userId,
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      reason: 'Allow established members time to remediate.',
      requiredScopes: [],
      staleEvidenceGraceDurationSeconds: 3600,
      strictRemediationDurationSeconds: 3600,
    })
    const reviewUserId = randomUUID()
    await establishCompliantAccount(reviewUserId, 90_000_002)
    await connection`
      update characters
      set corporation_id = 98000002, affiliation_checked_at = now(),
        next_affiliation_check = now() + interval '1 hour'
      where user_id = ${reviewUserId}
    `
    await expect(
      recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        organizationVersion: 1,
        userId: reviewUserId,
      }),
    ).resolves.toMatchObject({ evaluation: { state: 'review_required' } })
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Compliant member services',
      permissions: [{ type: 'service', key: 'discord.member' }],
      reason: 'Create compliant member services.',
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [bundle.bundleId],
      complianceSource: 'core.registration',
      managementMode: 'compliance',
      name: 'Compliant members',
      restricted: false,
    })

    await expect(
      assignOrganizationGroup({
        actorUserId: userId,
        expiresAt: null,
        groupId: group.groupId,
        reason: 'Manual override.',
        targetUserId,
      }),
    ).rejects.toMatchObject({ code: 'compliance-group-manual-change' })
    const [automaticAssignment] = await connection<
      { assignment_id: string; assignment_source: string }[]
    >`
      select assignment_id, assignment_source
      from organization_group_assignments
      where group_id = ${group.groupId} and user_id = ${targetUserId} and revoked_at is null
    `
    expect(automaticAssignment).toMatchObject({ assignment_source: 'compliance' })
    const [reviewAssignment] = await connection<{ assignment_source: string }[]>`
      select assignment_source from organization_group_assignments
      where group_id = ${group.groupId} and user_id = ${reviewUserId} and revoked_at is null
    `
    expect(reviewAssignment).toStrictEqual({ assignment_source: 'compliance' })
    await expect(
      convergeRegistrationComplianceGroupAssignment({
        eligible: true,
        groupId: group.groupId,
        reason: 'Repeated compliance result.',
        targetUserId,
      }),
    ).resolves.toMatchObject({ changed: false })
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: [],
      services: ['discord.member'],
    })
    await connection`
      update characters
      set corporation_id = 98000002, affiliation_checked_at = now(),
        next_affiliation_check = now() + interval '1 hour'
      where user_id = ${targetUserId}
    `
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId: targetUserId,
    })
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: [],
      services: [],
    })
    const [serviceRevocation] = await connection<{ subject_id: string; causation_type: string }[]>`
      select entitlement.subject_id, causation.event_type as causation_type
      from organization_audit_events entitlement
      join organization_audit_events causation
        on causation.audit_id = entitlement.causation_audit_id
      where entitlement.event_type = 'entitlement.revoked'
        and entitlement.subject_id = 'discord.member'
    `
    expect(serviceRevocation).toStrictEqual({
      causation_type: 'compliance.transitioned',
      subject_id: 'discord.member',
    })

    await updateDeploymentOrganization(
      { id: 98_000_002, name: 'Second Corporation', ticker: 'TWO', type: 'corporation' },
      adminId,
    )
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: [],
      services: [],
    })
    const [audit] = await connection<
      { actor_type: string; actor_id: string | null; event_type: string }[]
    >`
      select actor_type, actor_id, event_type
      from organization_audit_events
      where assignment_id = ${automaticAssignment!.assignment_id}
        and event_type = 'group.assigned'
    `
    expect(audit).toStrictEqual({
      actor_id: null,
      actor_type: 'system',
      event_type: 'group.assigned',
    })
  })

  test('executes reviewer ordinary-group commands against the exact managed-member binding', async () => {
    const fixture = await establishReviewerCommandFixture()
    const expiresAt = new Date(Date.now() + 60_000)
    const assigned = await assignOrganizationReviewerOrdinaryGroup({
      ...reviewerCommandBinding(fixture, 'member-audit.groups.manage'),
      expiresAt,
      groupId: fixture.ordinaryGroupId,
      reason: '  Temporary access after review.  ',
    })
    expect(assigned).toStrictEqual({
      assignmentId: expect.any(String),
      decision: 'assigned',
      expiresAt: expiresAt.toISOString(),
      groupId: fixture.ordinaryGroupId,
      organizationVersion: 1,
      targetUserId: fixture.targetUserId,
    })

    const otherTargetUserId = randomUUID()
    await establishCompliantAccount(otherTargetUserId, 90_000_021)
    await expect(
      revokeOrganizationReviewerOrdinaryGroup({
        ...reviewerCommandBinding(
          {
            ...fixture,
            targetManagedMemberLifecycleId:
              await loadActiveManagedMemberLifecycleId(otherTargetUserId),
            targetUserId: otherTargetUserId,
          },
          'member-audit.groups.manage',
        ),
        assignmentId: assigned.assignmentId,
        groupId: fixture.ordinaryGroupId,
        reason: 'Attempt to substitute the selected target.',
      }),
    ).rejects.toMatchObject({ code: 'assignment-binding-invalid' })

    await expect(
      revokeOrganizationReviewerOrdinaryGroup({
        ...reviewerCommandBinding(fixture, 'member-audit.groups.manage'),
        assignmentId: assigned.assignmentId,
        groupId: fixture.ordinaryGroupId,
        reason: 'Review access ended.',
      }),
    ).resolves.toMatchObject({
      assignmentId: assigned.assignmentId,
      decision: 'revoked',
      revokedAt: expect.any(String),
      targetUserId: fixture.targetUserId,
    })
    const audits = await connection<
      { event_type: string; actor_id: string; target_user_id: string; reason: string }[]
    >`
      select event_type, actor_id, target_user_id, reason
      from organization_audit_events
      where assignment_id = ${assigned.assignmentId}
      order by audit_sequence
    `
    expect([...audits]).toStrictEqual([
      {
        actor_id: userId,
        event_type: 'group.assigned',
        reason: 'Temporary access after review.',
        target_user_id: fixture.targetUserId,
      },
      {
        actor_id: userId,
        event_type: 'group.revoked',
        reason: 'Review access ended.',
        target_user_id: fixture.targetUserId,
      },
    ])
  })

  test('refuses restricted, compliance-managed, reviewer-permission, self, and stale group bindings', async () => {
    const fixture = await establishReviewerCommandFixture()
    const base = reviewerCommandBinding(fixture, 'member-audit.groups.manage')
    await expect(
      assignOrganizationReviewerOrdinaryGroup({
        ...base,
        groupId: fixture.ordinaryGroupId,
        reason: 'password=hunter2',
      }),
    ).rejects.toMatchObject({ code: 'invalid-reason' })
    await expect(
      assignOrganizationReviewerOrdinaryGroup({
        ...base,
        groupId: fixture.reviewerGroupId,
        reason: 'Restricted mutation attempt.',
      }),
    ).rejects.toMatchObject({ code: 'restricted-group-not-allowed' })

    const complianceGroup = await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [fixture.ordinaryBundleId],
      complianceSource: 'core.registration',
      managementMode: 'compliance',
      name: 'Reviewer command compliance group',
      restricted: false,
    })
    await expect(
      assignOrganizationReviewerOrdinaryGroup({
        ...base,
        groupId: complianceGroup.groupId,
        reason: 'Compliance mutation attempt.',
      }),
    ).rejects.toMatchObject({ code: 'compliance-group-not-allowed' })

    const unsafeGroup = await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [fixture.reviewerBundleId],
      complianceSource: null,
      managementMode: 'manual',
      name: 'Unsafe ordinary reviewer group',
      restricted: false,
    })
    await expect(
      assignOrganizationReviewerOrdinaryGroup({
        ...base,
        groupId: unsafeGroup.groupId,
        reason: 'Reviewer permission escalation attempt.',
      }),
    ).rejects.toMatchObject({ code: 'reviewer-permission-group-not-allowed' })
    await assignOrganizationGroup({
      actorUserId: userId,
      expiresAt: null,
      groupId: unsafeGroup.groupId,
      reason: 'Existing reviewer access.',
      targetUserId: fixture.targetUserId,
    })
    const reviewerTarget = await resolveOrganizationReviewerTarget({
      organizationVersion: 1,
      targetUserId: fixture.targetUserId,
    })
    const projectedUnsafeGroup = reviewerTarget?.groups.find(
      ({ groupId }) => groupId === unsafeGroup.groupId,
    )
    expect(projectedUnsafeGroup).toMatchObject({
      managementMode: 'manual',
      readOnly: true,
      restricted: false,
    })
    expect(projectedUnsafeGroup).not.toHaveProperty('hasReviewerPermission')

    await expect(
      assignOrganizationReviewerOrdinaryGroup({
        ...reviewerCommandBinding(
          {
            ...fixture,
            targetManagedMemberLifecycleId: await loadActiveManagedMemberLifecycleId(userId),
            targetUserId: userId,
          },
          'member-audit.groups.manage',
        ),
        groupId: fixture.ordinaryGroupId,
        reason: 'Self escalation attempt.',
      }),
    ).rejects.toMatchObject({ code: 'self-target-not-allowed' })
    await expect(
      revokeOrganizationReviewerOrdinaryGroup({
        ...reviewerCommandBinding(
          {
            ...fixture,
            targetManagedMemberLifecycleId: await loadActiveManagedMemberLifecycleId(userId),
            targetUserId: userId,
          },
          'member-audit.groups.manage',
        ),
        assignmentId: fixture.reviewerAssignmentId,
        groupId: fixture.reviewerGroupId,
        reason: 'Own reviewer grant revocation attempt.',
      }),
    ).rejects.toMatchObject({ code: 'self-target-not-allowed' })

    await connection`
      update organization_managed_member_lifecycles
      set ended_at = now(), updated_at = now()
      where managed_member_lifecycle_id = ${fixture.targetManagedMemberLifecycleId}
    `
    await expect(
      assignOrganizationReviewerOrdinaryGroup({
        ...base,
        groupId: fixture.ordinaryGroupId,
        reason: 'Stale target attempt.',
      }),
    ).rejects.toMatchObject({ code: 'invalid-binding' })
  })

  test('rechecks the current reviewer role and exact action permission in the command transaction', async () => {
    const fixture = await establishReviewerCommandFixture()
    const command = {
      ...reviewerCommandBinding(fixture, 'member-audit.groups.manage'),
      groupId: fixture.ordinaryGroupId,
      reason: 'Current authorization required.',
    } as const
    await revokeOrganizationRole({
      actorUserId: userId,
      grantId: fixture.reviewerRoleGrantId,
      reason: 'Reviewer role removed.',
    })
    await expect(assignOrganizationReviewerOrdinaryGroup(command)).rejects.toMatchObject({
      code: 'reviewer-authority-required',
    })

    await grantOrganizationRole({
      actorUserId: userId,
      reason: 'Reviewer role restored for permission check.',
      role: 'director',
      targetUserId: userId,
    })
    await revokeOrganizationGroupAssignment({
      actorUserId: userId,
      assignmentId: fixture.reviewerAssignmentId,
      groupId: fixture.reviewerGroupId,
      reason: 'Reviewer action permission removed.',
    })
    await expect(assignOrganizationReviewerOrdinaryGroup(command)).rejects.toMatchObject({
      code: 'reviewer-permission-required',
    })

    await updateDeploymentOrganization(
      { id: 98_000_002, name: 'Second Corporation', ticker: 'TWO', type: 'corporation' },
      adminId,
    )
    await expect(assignOrganizationReviewerOrdinaryGroup(command)).rejects.toMatchObject({
      code: 'invalid-binding',
    })
  })

  test('executes reviewer block commands with block precedence and rejects reviewer peers', async () => {
    const fixture = await establishReviewerCommandFixture()
    await assignOrganizationReviewerOrdinaryGroup({
      ...reviewerCommandBinding(fixture, 'member-audit.groups.manage'),
      groupId: fixture.ordinaryGroupId,
      reason: 'Current service access.',
    })
    await expect(
      blockOrganizationReviewerMember({
        ...reviewerCommandBinding(fixture, 'member-audit.members.block'),
        reason: 'Immediate review hold.',
      }),
    ).resolves.toMatchObject({
      blockId: expect.any(String),
      decision: 'blocked',
      targetUserId: fixture.targetUserId,
    })
    await expect(getOrganizationGroupPermissions(fixture.targetUserId)).resolves.toStrictEqual({
      modules: [],
      services: [],
    })
    await expect(
      unblockOrganizationReviewerMember({
        ...reviewerCommandBinding(fixture, 'member-audit.members.block'),
        reason: 'Review hold cleared.',
      }),
    ).resolves.toMatchObject({
      decision: 'unblocked',
      targetUserId: fixture.targetUserId,
      unblockedAt: expect.any(String),
    })
    await expect(getOrganizationGroupPermissions(fixture.targetUserId)).resolves.toStrictEqual({
      modules: [],
      services: ['discord.reviewer-command'],
    })

    await grantOrganizationRole({
      actorUserId: userId,
      reason: 'Peer reviewer assignment.',
      role: 'hr_auditor',
      targetUserId: fixture.targetUserId,
    })
    await expect(
      blockOrganizationReviewerMember({
        ...reviewerCommandBinding(fixture, 'member-audit.members.block'),
        reason: 'Peer lockout attempt.',
      }),
    ).rejects.toMatchObject({ code: 'reviewer-target-not-allowed' })

    const [counts] = await connection<{ decisions: number; events: number; transitions: number }[]>`
      select
        (select count(*)::integer from organization_audit_events
          where event_type in ('member.blocked', 'member.unblocked')
            and subject_id = ${fixture.targetUserId}) as decisions,
        (select count(*)::integer from domain_events
          where event_type in ('organization.member-blocked', 'organization.member-unblocked')
            and aggregate_id = ${fixture.targetUserId}) as events,
        (select count(*)::integer from organization_audit_events
          where event_type in ('entitlement.granted', 'entitlement.revoked')
            and subject_id = 'discord.reviewer-command') as transitions
    `
    expect(counts).toStrictEqual({ decisions: 2, events: 2, transitions: 2 })
  })

  test('gives director-issued member blocks precedence and reevaluates only current grants on unblock', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const directorUserId = randomUUID()
    const targetUserId = randomUUID()
    await establishCompliantAccount(directorUserId, 90_000_010)
    await establishCompliantAccount(targetUserId, 90_000_001)
    await grantOrganizationRole({
      actorUserId: userId,
      reason: 'Member policy management.',
      role: 'director',
      targetUserId: directorUserId,
    })
    const targetDirectorGrant = await grantOrganizationRole({
      actorUserId: userId,
      reason: 'Operational leadership.',
      role: 'director',
      targetUserId,
    })
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Block precedence access',
      permissions: [
        organizationActivityPermission(),
        { type: 'service', key: 'discord.operations' },
      ],
      reason: 'Create block precedence access.',
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [bundle.bundleId],
      complianceSource: null,
      managementMode: 'manual',
      name: 'Block precedence group',
      restricted: false,
    })
    const assignment = await assignOrganizationGroup({
      actorUserId: userId,
      expiresAt: new Date(Date.now() + 60_000),
      groupId: group.groupId,
      reason: 'Current operations assignment.',
      targetUserId,
    })

    await expect(
      blockOrganizationMember({
        actorUserId: directorUserId,
        reason: 'Attempted governance lockout.',
        targetUserId: userId,
      }),
    ).rejects.toMatchObject({ code: 'owner-block-not-allowed' })
    await expect(hasCurrentOrganizationManagerAuthority(targetUserId)).resolves.toBe(true)
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: ['organization-activity.view'],
      services: ['discord.operations'],
    })
    const firstBlock = await blockOrganizationMember({
      actorUserId: directorUserId,
      reason: 'Investigating a policy violation.',
      targetUserId,
    })
    await expect(hasCurrentOrganizationMemberBlock(targetUserId)).resolves.toBe(true)
    await expect(hasCurrentOrganizationManagerAuthority(targetUserId)).resolves.toBe(false)
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: [],
      services: [],
    })

    await unblockOrganizationMember({
      actorUserId: directorUserId,
      reason: 'Initial review cleared.',
      targetUserId,
    })
    await expect(hasCurrentOrganizationManagerAuthority(targetUserId)).resolves.toBe(true)
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: ['organization-activity.view'],
      services: ['discord.operations'],
    })

    await blockOrganizationMember({
      actorUserId: directorUserId,
      reason: 'New evidence requires a second review.',
      targetUserId,
    })
    await revokeOrganizationGroupAssignment({
      actorUserId: userId,
      assignmentId: assignment.assignmentId,
      groupId: group.groupId,
      reason: 'Operations assignment independently ended.',
    })
    await revokeOrganizationRole({
      actorUserId: userId,
      grantId: targetDirectorGrant.grantId,
      reason: 'Leadership delegation independently ended.',
    })
    await unblockOrganizationMember({
      actorUserId: directorUserId,
      reason: 'Second review completed against current grants.',
      targetUserId,
    })

    await expect(hasCurrentOrganizationMemberBlock(targetUserId)).resolves.toBe(false)
    await expect(hasCurrentOrganizationManagerAuthority(targetUserId)).resolves.toBe(false)
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toStrictEqual({
      modules: [],
      services: [],
    })
    const decisions = await connection<
      {
        event_type: string
        actor_id: string
        subject_id: string
        reason: string
        outcome: string
        organization_version: string
      }[]
    >`
      select event_type, actor_id, subject_id, reason, outcome, organization_version
      from organization_audit_events
      where event_type in ('member.blocked', 'member.unblocked')
      order by audit_sequence
    `
    expect([...decisions]).toStrictEqual([
      {
        actor_id: directorUserId,
        event_type: 'member.blocked',
        organization_version: '1',
        outcome: 'denied',
        reason: 'Investigating a policy violation.',
        subject_id: targetUserId,
      },
      {
        actor_id: directorUserId,
        event_type: 'member.unblocked',
        organization_version: '1',
        outcome: 'transitioned',
        reason: 'Initial review cleared.',
        subject_id: targetUserId,
      },
      {
        actor_id: directorUserId,
        event_type: 'member.blocked',
        organization_version: '1',
        outcome: 'denied',
        reason: 'New evidence requires a second review.',
        subject_id: targetUserId,
      },
      {
        actor_id: directorUserId,
        event_type: 'member.unblocked',
        organization_version: '1',
        outcome: 'transitioned',
        reason: 'Second review completed against current grants.',
        subject_id: targetUserId,
      },
    ])
    expect(firstBlock).toMatchObject({
      blockedByUserId: directorUserId,
      unblockedAt: null,
      userId: targetUserId,
    })
    const entitlementDecisions = await connection<
      { event_type: string; subject_id: string; causation_type: string }[]
    >`
      select entitlement.event_type, entitlement.subject_id,
        causation.event_type as causation_type
      from organization_audit_events entitlement
      join organization_audit_events causation
        on causation.audit_id = entitlement.causation_audit_id
      where entitlement.event_type in ('entitlement.granted', 'entitlement.revoked')
      order by entitlement.audit_sequence
    `
    expect([...entitlementDecisions]).toStrictEqual([
      {
        causation_type: 'member.blocked',
        event_type: 'entitlement.revoked',
        subject_id: 'discord.operations',
      },
      {
        causation_type: 'member.unblocked',
        event_type: 'entitlement.granted',
        subject_id: 'discord.operations',
      },
      {
        causation_type: 'member.blocked',
        event_type: 'entitlement.revoked',
        subject_id: 'discord.operations',
      },
    ])
  })

  test('serializes duplicate blocks and isolates prior-version decisions', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await connection`insert into users (id) values (${targetUserId})`

    const results = await Promise.allSettled([
      blockOrganizationMember({
        actorUserId: userId,
        reason: 'First concurrent decision.',
        targetUserId,
      }),
      blockOrganizationMember({
        actorUserId: userId,
        reason: 'Second concurrent decision.',
        targetUserId,
      }),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toStrictEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'block-already-active' }),
      }),
    ])

    await updateDeploymentOrganization(
      { id: 98_000_002, name: 'Second Corporation', ticker: 'TWO', type: 'corporation' },
      adminId,
    )
    await expect(hasCurrentOrganizationMemberBlock(targetUserId)).resolves.toBe(false)
  })

  test('bulk compliance recomputation locks all users before compliance groups', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const userIds = [randomUUID(), randomUUID()].toSorted((left, right) =>
      left.localeCompare(right),
    )
    const firstUserId = userIds[0]!
    const secondUserId = userIds[1]!
    await establishCompliantAccount(firstUserId, 90_000_001)
    await establishCompliantAccount(secondUserId, 90_000_002)
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Bulk lock order bundle',
      permissions: [{ type: 'service', key: 'discord.bulk-lock' }],
      reason: 'Create the bulk lock order bundle.',
    })
    await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [bundle.bundleId],
      complianceSource: 'core.registration',
      managementMode: 'compliance',
      name: 'Bulk lock order group',
      restricted: false,
    })
    let userLocked!: () => void
    let allowGroupLock!: () => void
    let groupLocked!: () => void
    let releaseBlocker!: () => void
    const userLockAcquired = new Promise<void>((resolve) => {
      userLocked = resolve
    })
    const groupLockAllowed = new Promise<void>((resolve) => {
      allowGroupLock = resolve
    })
    const groupLockAcquired = new Promise<void>((resolve) => {
      groupLocked = resolve
    })
    const blockerReleased = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const blocker = secondConnection.begin(async (transaction) => {
      await transaction`select id from users where id = ${secondUserId} for update`
      userLocked()
      await groupLockAllowed
      await transaction`
        select group_id from organization_groups
        where deployment_id = 1 and organization_version = 1
        for update
      `
      groupLocked()
      await blockerReleased
    })
    await userLockAcquired

    let bulkSettled = false
    const bulk = dbClient.db
      .transaction((transaction) =>
        recomputeAllOrganizationAccountsInTransaction(transaction, {
          deploymentId: 1,
          organizationVersion: 1,
        }),
      )
      .finally(() => {
        bulkSettled = true
      })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(bulkSettled).toBe(false)
    allowGroupLock()
    try {
      await groupLockAcquired
    } finally {
      releaseBlocker()
    }
    await blocker
    await expect(bulk).resolves.toHaveLength(3)
  })

  test('serializes group management changes against concurrent assignments', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await connection`insert into users (id) values (${targetUserId})`
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Concurrent assignment bundle',
      permissions: [organizationActivityPermission()],
      reason: 'Create the concurrent assignment bundle.',
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      bundleIds: [bundle.bundleId],
      complianceSource: null,
      managementMode: 'manual',
      name: 'Concurrent assignment group',
      restricted: false,
    })
    let releaseAssignment!: () => void
    let assignmentInserted!: () => void
    const release = new Promise<void>((resolve) => {
      releaseAssignment = resolve
    })
    const inserted = new Promise<void>((resolve) => {
      assignmentInserted = resolve
    })
    const assignmentTransaction = connection.begin(async (transaction) => {
      await transaction`
        insert into organization_group_assignments (
          group_id,
          deployment_id,
          organization_version,
          user_id,
          assignment_source,
          assigned_actor_type,
          assigned_by_user_id,
          reason
        ) values (
          ${group.groupId},
          1,
          1,
          ${targetUserId},
          'manual',
          'user',
          ${userId},
          'Concurrent assignment.'
        )
      `
      assignmentInserted()
      await release
    })
    await inserted

    let updateSettled = false
    const managementUpdate = secondConnection`
      update organization_groups
      set management_mode = 'compliance', compliance_source = 'core.registration'
      where group_id = ${group.groupId}
    `.finally(() => {
      updateSettled = true
    })
    // Captured before the commit rejects it; a later assertion leaves it unhandled in between.
    const managementFailure = managementUpdate.then(
      () => null,
      (error: unknown) => error,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(updateSettled).toBe(false)

    releaseAssignment()
    await assignmentTransaction
    const managementError = await managementFailure
    expect(managementError).toBeInstanceOf(Error)
    expect((managementError as Error).message).toContain(
      'group management cannot change after assignment',
    )
  })

  test('serializes concurrent organization changes into consecutive isolated epochs', async () => {
    await Promise.all([
      updateDeploymentOrganization(
        { id: 98_000_002, name: 'Second Corporation', ticker: 'TWO', type: 'corporation' },
        adminId,
      ),
      updateDeploymentOrganization(
        { id: 99_000_003, name: 'Third Alliance', ticker: 'THREE', type: 'alliance' },
        adminId,
      ),
    ])

    const [settings] = await connection<
      { organization_version: string; organization_id: string }[]
    >`select organization_version, organization_id from deployment_settings where id = 1`
    const epochs = await connection<
      { organization_version: string; organization_id: string; superseded_at: Date | null }[]
    >`
      select organization_version, organization_id, superseded_at
      from organization_epochs
      order by organization_version
    `
    const events = await connection<
      { payload: { previousOrganizationVersion: number; organizationVersion: number } }[]
    >`
      select payload from domain_events
      where event_type = 'organization.changed'
      order by event_sequence
    `
    const [auditCount] = await connection<{ count: number }[]>`
      select count(*)::integer as count
      from organization_audit_events
      where event_type = 'organization.changed'
    `

    expect(settings?.organization_version).toBe('3')
    expect(['98000002', '99000003']).toContain(settings?.organization_id)
    expect(epochs.map(({ organization_version }) => organization_version)).toStrictEqual([
      '1',
      '2',
      '3',
    ])
    expect(epochs.slice(0, 2).every(({ superseded_at }) => superseded_at instanceof Date)).toBe(
      true,
    )
    expect(epochs[2]?.superseded_at).toBeNull()
    expect(events.map(({ payload }) => payload)).toStrictEqual([
      expect.objectContaining({ organizationVersion: 2, previousOrganizationVersion: 1 }),
      expect.objectContaining({ organizationVersion: 3, previousOrganizationVersion: 2 }),
    ])
    expect(auditCount?.count).toBe(2)
  })

  test('invalidates old organization state and recomputes every account for the new epoch', async () => {
    const firstUserId = randomUUID()
    const secondUserId = randomUUID()
    await establishCompliantAccount(firstUserId, 90_000_011)
    await establishCompliantAccount(secondUserId, 90_000_012)
    await establishRosterObservation()

    await updateDeploymentOrganization(
      { id: 98_000_002, name: 'Second Corporation', ticker: 'TWO', type: 'corporation' },
      adminId,
    )

    const [oldState] = await connection<
      {
        current_corporations: number
        authoritative_compliance: number
        roster_observations: number
        active_managed_members: number
      }[]
    >`
      select
        (
          select count(*)::integer
          from organization_managed_corporations
          where organization_version = 1 and is_current
        ) as current_corporations,
        (
          select count(*)::integer
          from organization_account_compliance
          where organization_version = 1 and authoritative
        ) as authoritative_compliance,
        (
          select count(*)::integer
          from organization_corporation_roster_observations
          where organization_version = 1
        ) as roster_observations,
        (
          select count(*)::integer
          from organization_managed_member_lifecycles
          where organization_version = 1 and ended_at is null
        ) as active_managed_members
    `
    const newProjections = await connection<
      { user_id: string; state: string; authoritative: boolean }[]
    >`
      select user_id, state, authoritative
      from organization_account_compliance
      where organization_version = 2 and user_id in (${firstUserId}, ${secondUserId})
      order by user_id
    `

    expect(oldState).toStrictEqual({
      active_managed_members: 0,
      authoritative_compliance: 0,
      current_corporations: 0,
      roster_observations: 1,
    })
    expect(newProjections).toHaveLength(2)
    expect(newProjections.every(({ authoritative }) => authoritative)).toBe(true)
    await expect(loadOrganizationSessionContext(firstUserId)).resolves.toMatchObject({
      accessValidUntil: null,
      organizationVersion: 2,
      state: 'suspended',
    })
  })

  test('stores bounded sensitive access decisions without retaining account rows', async () => {
    const targetUserId = randomUUID()
    const occurredAt = new Date('2026-09-18T12:00:00.000Z')
    await connection`insert into users (id) values (${targetUserId})`
    const revisionsBefore = await loadOrganizationRevisionFacts(userId, 1, occurredAt)

    await dbClient.db.transaction((transaction) =>
      appendOrganizationSensitiveAccessDecision(transaction, {
        actorUserId: userId,
        decision: 'allowed',
        disclosureVersion: 3,
        occurredAt,
        organizationVersion: 1,
        policyVersion: 1,
        reason: 'authorized',
        sectionId: 'wallet',
        targetCharacterId: 90_000_001,
        targetUserId,
      }),
    )

    const [stored] = await connection<
      {
        event_type: string
        actor_id: string
        subject_id: string
        target_user_id: string
        target_character_id: string
        section_id: string
        reason: string
        outcome: string
        policy_version: string
        disclosure_version: string
        occurred_at: Date
      }[]
    >`
      select event_type, actor_id, subject_id, target_user_id, target_character_id,
        section_id, reason, outcome, policy_version, disclosure_version, occurred_at
      from organization_audit_events
      where event_type = 'sensitive-access.decided'
    `
    expect(stored).toStrictEqual({
      actor_id: userId,
      disclosure_version: '3',
      event_type: 'sensitive-access.decided',
      occurred_at: occurredAt,
      outcome: 'granted',
      policy_version: '1',
      reason: 'authorized',
      section_id: 'wallet',
      subject_id: targetUserId,
      target_character_id: '90000001',
      target_user_id: targetUserId,
    })
    const revisionsAfter = await loadOrganizationRevisionFacts(userId, 1, occurredAt)
    expect(revisionsAfter.latestAuditSequence).toBe(revisionsBefore.latestAuditSequence)
    await dbClient.db.transaction((transaction) =>
      appendOrganizationSensitiveAccessDecision(transaction, {
        actorUserId: userId,
        decision: 'denied',
        disclosureVersion: 4,
        occurredAt: new Date('2026-09-18T12:01:00.000Z'),
        organizationVersion: 1,
        policyVersion: 2,
        reason: 'target-not-authorized',
        sectionId: 'skills',
        targetCharacterId: null,
        targetUserId: null,
      }),
    )
    const [denied] = await connection<
      {
        subject_type: string
        subject_id: string
        target_user_id: string | null
        target_character_id: string | null
        reason: string
        outcome: string
        policy_version: string
      }[]
    >`
      select subject_type, subject_id, target_user_id, target_character_id,
        reason, outcome, policy_version
      from organization_audit_events
      where event_type = 'sensitive-access.decided' and reason = 'target-not-authorized'
    `
    expect(denied).toStrictEqual({
      outcome: 'denied',
      policy_version: '2',
      reason: 'target-not-authorized',
      subject_id: '1',
      subject_type: 'deployment',
      target_character_id: null,
      target_user_id: null,
    })
    await connection`delete from users where id = ${targetUserId}`
    await expect(
      connection`select audit_id from organization_audit_events where event_type = 'sensitive-access.decided'`,
    ).resolves.toHaveLength(2)
    await expect(connection`
      insert into organization_audit_events (
        deployment_id, organization_version, policy_version, event_type,
        actor_type, actor_id, subject_type, subject_id, reason, outcome,
        target_user_id, section_id, disclosure_version
      ) values (
        1, 1, 1, 'sensitive-access.decided',
        'user', ${userId}, 'user', ${userId}, 'authorized', 'granted',
        ${userId}, 'overview', 1
      )
    `).rejects.toThrow('organization_audit_events_context_check')
    await expect(connection`
      insert into organization_audit_events (
        deployment_id, organization_version, policy_version, event_type,
        actor_type, actor_id, subject_type, subject_id, reason, outcome,
        target_user_id, section_id, disclosure_version
      ) values (
        1, 1, 1, 'sensitive-access.decided',
        'user', ${userId}, 'user', ${userId}, 'authorized', 'granted',
        ${userId}, null, 1
      )
    `).rejects.toThrow('organization_audit_events_context_check')
    await expect(connection`
      insert into organization_audit_events (
        deployment_id, organization_version, policy_version, event_type,
        actor_type, actor_id, subject_type, subject_id, reason, outcome,
        target_user_id, section_id, disclosure_version
      ) values (
        1, 1, 1, 'sensitive-access.decided',
        'user', ${userId}, 'user', ${userId}, 'target-not-authorized', 'denied',
        ${userId}, 'mail', 1
      )
    `).rejects.toThrow('organization_audit_events_context_check')
    await expect(connection`
      insert into organization_audit_events (
        deployment_id, organization_version, policy_version, event_type,
        actor_type, actor_id, subject_type, subject_id, reason, outcome,
        target_user_id, section_id, disclosure_version
      ) values (
        1, 1, 1, 'sensitive-access.decided',
        'user', ${userId}, 'user', ${userId}, 'authorized', 'granted',
        ${userId}, 'mail', null
      )
    `).rejects.toThrow('organization_audit_events_context_check')
    await expect(connection`
      insert into organization_audit_events (
        deployment_id, organization_version, policy_version, event_type,
        actor_type, actor_id, subject_type, subject_id, reason, outcome,
        target_user_id, section_id, disclosure_version
      ) values (
        1, 1, 1, 'sensitive-access.decided',
        'user', ${userId}, 'user', ${userId}, 'authorized', 'granted',
        ${userId}, 'mail', 0
      )
    `).rejects.toThrow('organization_audit_events_context_check')
  })

  test('rejects updates and deletes from the append-only audit ledger', async () => {
    const [audit] = await connection<{ audit_id: string }[]>`
      insert into organization_audit_events (
        deployment_id,
        organization_version,
        policy_version,
        event_type,
        actor_type,
        actor_id,
        subject_type,
        subject_id,
        reason,
        outcome
      ) values (
        1,
        1,
        1,
        'role.granted',
        'deployment_admin',
        ${adminId},
        'user',
        ${userId},
        'PostgreSQL append-only probe.',
        'granted'
      )
      returning audit_id
    `

    await expect(
      connection`update organization_audit_events set reason = 'changed' where audit_id = ${audit!.audit_id}`,
    ).rejects.toThrow('organization audit events are append-only')
    await expect(
      connection`delete from organization_audit_events where audit_id = ${audit!.audit_id}`,
    ).rejects.toThrow('organization audit events are append-only')
  })

  test('permits only one compliance projection for each user and organization version', async () => {
    await connection`
      insert into organization_account_compliance (
        deployment_id,
        organization_version,
        user_id,
        state,
        evidence_freshness
      ) values (1, 1, ${userId}, 'pending', 'unavailable')
    `

    await expect(
      connection`
        insert into organization_account_compliance (
          deployment_id,
          organization_version,
          user_id,
          state,
          evidence_freshness
        ) values (1, 1, ${userId}, 'pending', 'unavailable')
      `,
    ).rejects.toMatchObject({ code: '23505' })
  })

  test('permits only one active corporation source per corporation and version', async () => {
    await insertCorporationSourceFixture(randomUUID(), userId, characterId)

    await expect(
      insertCorporationSourceFixture(randomUUID(), userId, characterId),
    ).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'organization_corporation_sources_active_key',
    })
  })
})

async function establishRosterObservation() {
  await connection`
    update eve_tokens
    set scopes = '[
      "esi-characters.read_corporation_roles.v1",
      "esi-corporations.read_corporation_membership.v1"
    ]'::jsonb
    where character_id = ${characterId}
  `
  await claimOrganizationOwnership(
    ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
  )
  const registration = await registerOrganizationCorporationSource({
    actorUserId: userId,
    characterId,
    corporationId: 98_000_001,
  })
  const [identity] = await connection<
    { subject_lifecycle_id: string; authorization_generation: number }[]
  >`
    select lifecycle.subject_lifecycle_id, token.token_version as authorization_generation
    from platform_subject_lifecycles lifecycle
    join eve_tokens token on token.character_id = ${characterId}
    where lifecycle.corporation_source_id = ${registration.source.sourceId}
  `
  if (!identity) {
    throw new Error('Corporation source lifecycle is missing')
  }
  const observedAt = new Date()
  const observedCharacterId = characterId + 100
  await connection`
    insert into platform_collection_state (
      module_id,
      resource_id,
      subject_kind,
      subject_lifecycle_id,
      subject_id,
      next_eligible_at,
      authorization_generation,
      validated_at
    ) values (
      'core',
      'corporation-roster',
      'corporation',
      ${identity.subject_lifecycle_id},
      '98000001',
      ${new Date(observedAt.getTime() + 3_600_000)},
      ${identity.authorization_generation},
      ${observedAt}
    )
  `
  await connection`
    insert into organization_corporation_roster_observations (
      deployment_id,
      organization_version,
      corporation_id,
      character_id,
      source_id,
      authorization_generation,
      observed_at
    ) values (
      1,
      1,
      98000001,
      ${observedCharacterId},
      ${registration.source.sourceId},
      ${identity.authorization_generation},
      ${observedAt}
    )
  `
  return { observedCharacterId }
}

async function prepareCorporationSourceReplacementCharacter() {
  const replacementCharacterId = characterId + 1
  await attachCharacterToExistingAccount(userId, replacementCharacterId)
  await connection`
    update eve_tokens
    set scopes = '[
      "esi-characters.read_corporation_roles.v1",
      "esi-corporations.read_corporation_membership.v1"
    ]'::jsonb
    where character_id = ${replacementCharacterId}
  `
  const affiliationCheckedAt = await loadAffiliationCheckedAt(replacementCharacterId)
  ownerEvidenceMocks.observeAndPersistCharacterAffiliation.mockResolvedValue({
    affiliationCheckedAt,
    affiliationFreshUntil: new Date(Date.now() + 60 * 60 * 1000),
    allianceId: null,
    characterId: replacementCharacterId,
    corporationId: 98_000_001,
    stale: false,
  })
  ownerEvidenceMocks.getCharacterCorporationRolesEvidence.mockResolvedValue(
    roleEvidence({ authorizationGeneration: 0 }),
  )
  return replacementCharacterId
}

async function seedAdditionalDirectoryCharacter(
  targetUserId: string,
  targetCharacterId: number,
  name: string,
  isMain: boolean,
) {
  await connection`
    insert into characters (
      character_id, user_id, owner_hash, name, corporation_id, affiliation_checked_at,
      next_affiliation_check, affiliation_resolution_state, is_main
    ) values (
      ${targetCharacterId}, ${targetUserId}, ${`owner-${targetCharacterId}`}, ${name}, 98000001,
      '2026-09-18T10:00:00Z', '2026-09-19T00:00:00Z', 'resolved', ${isMain}
    )
  `
  await connection`
    insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
    values ('character', ${String(targetCharacterId)}, ${targetCharacterId})
  `
}

async function seedDirectoryGroups() {
  const groups = {
    alpha: randomUUID(),
    compliance: randomUUID(),
    expired: randomUUID(),
    restricted: randomUUID(),
    revoked: randomUUID(),
    zulu: randomUUID(),
  }
  await connection`
    insert into organization_groups (
      group_id, deployment_id, organization_version, name, restricted,
      management_mode, compliance_source, created_by_user_id
    ) values
      (${groups.alpha}, 1, 1, 'Alpha current', false, 'manual', null, ${userId}),
      (${groups.compliance}, 1, 1, 'Compliance current', false, 'compliance',
        'core.registration', ${userId}),
      (${groups.expired}, 1, 1, 'Expired assignment', false, 'manual', null, ${userId}),
      (${groups.restricted}, 1, 1, 'Restricted current', true, 'manual', null, ${userId}),
      (${groups.revoked}, 1, 1, 'Revoked assignment', false, 'manual', null, ${userId}),
      (${groups.zulu}, 1, 1, 'Zulu current', false, 'manual', null, ${userId})
  `
  await connection`
    insert into organization_group_assignments (
      assignment_id, group_id, deployment_id, organization_version, user_id,
      assignment_source, compliance_source, assigned_actor_type, assigned_by_user_id,
      reason, assigned_at, expires_at, revoked_at, revoked_actor_type,
      revoked_by_user_id, revocation_reason
    ) values
      (${randomUUID()}, ${groups.alpha}, 1, 1, ${userId}, 'manual', null, 'user', ${userId},
        'Current assignment', '2026-09-16T00:00:00Z', null, null, null, null, null),
      (${randomUUID()}, ${groups.compliance}, 1, 1, ${userId}, 'compliance',
        'core.registration', 'system', null, 'Current compliance assignment',
        '2026-09-16T00:00:00Z', null, null, null, null, null),
      (${randomUUID()}, ${groups.expired}, 1, 1, ${userId}, 'manual', null, 'user', ${userId},
        'Expired assignment', '2026-09-16T00:00:00Z', '2026-09-17T00:00:00Z',
        null, null, null, null),
      (${randomUUID()}, ${groups.restricted}, 1, 1, ${userId}, 'manual', null, 'user',
        ${userId}, 'Current restricted assignment', '2026-09-16T00:00:00Z',
        null, null, null, null, null),
      (${randomUUID()}, ${groups.revoked}, 1, 1, ${userId}, 'manual', null, 'user', ${userId},
        'Revoked assignment', '2026-09-16T00:00:00Z', null, '2026-09-17T00:00:00Z',
        'user', ${userId}, 'No longer assigned'),
      (${randomUUID()}, ${groups.zulu}, 1, 1, ${userId}, 'manual', null, 'user', ${userId},
        'Current assignment', '2026-09-16T00:00:00Z', null, null, null, null, null)
  `
  return groups
}

async function enableDirectoryAuditSections(sections: readonly string[]) {
  for (const sectionId of sections) {
    await connection`
      insert into deployment_module_sections (
        module_id, section_id, kind, enabled, declaration_revision,
        disclosure_version, activation_version
      ) values ('member-audit', ${sectionId}, 'sensitive-evidence', true, 1, 1, 1)
      on conflict (module_id, section_id) do update set
        kind = excluded.kind,
        enabled = excluded.enabled,
        declaration_revision = excluded.declaration_revision,
        disclosure_version = excluded.disclosure_version,
        activation_version = excluded.activation_version
    `
  }
}

async function authorizeDirectoryAuditSections(
  sections: readonly string[],
  targetCharacterId = characterId,
) {
  await connection`
    update eve_tokens
    set scopes = ${connection.json([
      'esi-characters.read_corporation_roles.v1',
      'esi-skills.read_skills.v1',
      'esi-assets.read_assets.v1',
    ])}
    where character_id = ${targetCharacterId}
  `
  for (const sectionId of sections) {
    await connection`
      insert into character_reviewer_disclosure_acceptances (
        character_id, module_id, section_id, disclosure_version, authorization_generation
      ) values (${targetCharacterId}, 'member-audit', ${sectionId}, 1, 0)
    `
  }
}

async function seedDirectoryAuditState(input: {
  resourceId: string
  sectionId: string
  validatedAt: string | null
  nextEligibleAt: string
  lastFailureClass?: 'esi-unavailable'
  targetUserId?: string
  targetCharacterId?: number
}) {
  const targetUserId = input.targetUserId ?? userId
  const targetCharacterId = input.targetCharacterId ?? characterId
  const managedMemberLifecycleId = await loadActiveManagedMemberLifecycleId(targetUserId)
  const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
    select subject_lifecycle_id
    from platform_subject_lifecycles
    where character_id = ${targetCharacterId}
  `
  if (!lifecycle) {
    throw new Error('Directory audit character lifecycle is missing')
  }
  await connection`
    insert into platform_collection_state (
      module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id,
      next_eligible_at, authorization_generation, organization_deployment_id,
      organization_version, target_user_id, managed_member_lifecycle_id, section_id,
      disclosure_version, section_activation_version, validated_at, last_failure_class,
      failure_started_at
    ) values (
      'member-audit', ${input.resourceId}, 'character', ${lifecycle.subject_lifecycle_id},
      ${String(targetCharacterId)}, ${input.nextEligibleAt}, 0, 1, 1, ${targetUserId},
      ${managedMemberLifecycleId}, ${input.sectionId}, 1, 1, ${input.validatedAt},
      ${input.lastFailureClass ?? null},
      ${input.lastFailureClass ? '2026-09-18T11:00:00Z' : null}
    )
  `
}

async function loadDirectoryAuditData(targetUserId = userId) {
  const page = await searchManagedOrganizationDirectory({
    filters: {},
    now: directoryNow,
    organizationVersion: 1,
  })
  const item = page.items.find(({ account }) => account.userId === targetUserId)
  if (!item) {
    throw new Error('Seeded directory member is missing')
  }
  return item.auditData
}

async function directoryUserIds(
  filters: Parameters<typeof searchManagedOrganizationDirectory>[0]['filters'],
) {
  const page = await searchManagedOrganizationDirectory({
    filters,
    now: directoryNow,
    organizationVersion: 1,
  })
  return page.items.map(({ account }) => account.userId)
}

async function seedDirectoryAccount(input: {
  targetUserId: string
  targetCharacterId: number
  name: string
  corporationId: number
  siteRegisteredAt: string
  managedSince: string
  affiliationCheckedAt: string
}) {
  await connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at
    ) values (1, 1, ${input.corporationId}, ${input.managedSince}, ${input.affiliationCheckedAt})
    on conflict (deployment_id, organization_version, corporation_id)
    do update set is_current = true, removed_at = null,
      last_observed_at = greatest(
        organization_managed_corporations.last_observed_at,
        excluded.last_observed_at
      )
  `
  await connection`
    insert into users (id, created_at) values (${input.targetUserId}, ${input.siteRegisteredAt})
  `
  await connection`
    insert into characters (
      character_id, user_id, owner_hash, name, corporation_id, affiliation_checked_at,
      next_affiliation_check, affiliation_resolution_state, is_main
    ) values (
      ${input.targetCharacterId}, ${input.targetUserId}, ${`owner-${input.targetCharacterId}`}, ${input.name}, ${input.corporationId},
      ${input.affiliationCheckedAt}, '2026-09-19T00:00:00Z', 'resolved', true
    )
  `
  await connection`
    insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes)
    values (
      ${input.targetCharacterId}, 'encrypted-test-token', '2026-09-19T00:00:00Z',
      '["esi-characters.read_corporation_roles.v1"]'::jsonb
    )
  `
  await connection`
    insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
    values ('character', ${String(input.targetCharacterId)}, ${input.targetCharacterId})
  `
  await connection`
    insert into organization_managed_member_lifecycles (
      deployment_id, organization_version, user_id, started_at
    ) values (1, 1, ${input.targetUserId}, ${input.managedSince})
  `
}

async function seedDirectoryCompliance(input: {
  targetUserId: string
  state: 'pending' | 'compliant' | 'review_required' | 'suspended'
  evidenceFreshness: 'fresh' | 'stale' | 'unavailable'
  evidenceAt?: string
  reviewDeadline?: string
  accessValidUntil?: string
  establishedCompliantAt?: string
}) {
  await connection`
    insert into organization_account_compliance (
      deployment_id, organization_version, user_id, state, evidence_freshness,
      evidence_at, review_deadline, access_valid_until, established_compliant_at,
      evaluated_at
    ) values (
      1, 1, ${input.targetUserId}, ${input.state}, ${input.evidenceFreshness},
      ${input.evidenceAt ?? null}, ${input.reviewDeadline ?? null},
      ${input.accessValidUntil ?? null}, ${input.establishedCompliantAt ?? null},
      '2026-09-18T11:00:00Z'
    )
  `
}

async function seedDirectoryBlock(targetUserId: string, blockedAt: string) {
  await connection`
    insert into organization_member_blocks (
      deployment_id, organization_version, user_id, blocked_by_user_id, reason, blocked_at
    ) values (1, 1, ${targetUserId}, ${userId}, 'Directory fixture block', ${blockedAt})
  `
}

async function seedDeployment() {
  await connection`
    insert into deployment_admins (id, email, password_hash)
    values (${adminId}, 'owner@example.com', 'test-password-hash')
  `
  await connection`
    insert into deployment_installation_settings (id, owner_admin_id)
    values (1, ${adminId})
    on conflict (id) do update set owner_admin_id = excluded.owner_admin_id
  `
  await connection`
    insert into organization_epochs (
      deployment_id,
      organization_version,
      organization_type,
      organization_id,
      organization_name,
      organization_ticker
    ) values (1, 1, 'corporation', 98000001, 'First Corporation', 'ONE')
  `
  await connection`
    insert into deployment_settings (
      id,
      organization_type,
      organization_id,
      organization_name,
      organization_ticker,
      organization_version
    ) values (1, 'corporation', 98000001, 'First Corporation', 'ONE', 1)
  `
  await connection`
    insert into deployment_modules (module_id, enabled)
    values ('organization-activity', true), ('member-audit', true)
    on conflict (module_id) do update set enabled = excluded.enabled
  `
  await connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at
    ) values (1, 1, 98000001, now(), now())
  `
  await seedCharacter(userId, characterId)
  await connection`
    insert into organization_managed_member_lifecycles (
      deployment_id, organization_version, user_id
    ) values (1, 1, ${userId})
  `
}

async function ensureManagedCorporation() {
  await connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at
    ) values (1, 1, 98000001, now(), now())
    on conflict (deployment_id, organization_version, corporation_id)
    do update set is_current = true, removed_at = null, last_observed_at = excluded.last_observed_at
  `
}

async function loadComplianceState(targetUserId: string) {
  const [projection] = await connection<{ state: string }[]>`
    select state
    from organization_account_compliance
    where deployment_id = 1 and organization_version = 1 and user_id = ${targetUserId}
  `
  return projection?.state ?? null
}

async function establishCompliantAccount(targetUserId: string, targetCharacterId: number) {
  await ensureManagedCorporation()
  await seedCharacter(targetUserId, targetCharacterId)
  await connection`update characters set is_main = true where character_id = ${targetCharacterId}`
  await recomputeOrganizationAccountCompliance({
    deploymentId: 1,
    organizationVersion: 1,
    userId: targetUserId,
  })
}

async function establishReviewerCommandFixture() {
  await claimOrganizationOwnership(
    ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
  )
  const reviewerRoleGrant = await grantOrganizationRole({
    actorUserId: userId,
    reason: 'Independent reviewer grant.',
    role: 'director',
    targetUserId: userId,
  })
  const reviewerBundle = await createOrganizationPermissionBundle({
    actorUserId: userId,
    name: 'Reviewer command permissions',
    permissions: [
      memberAuditPermission('member-audit.groups.manage'),
      memberAuditPermission('member-audit.members.block'),
    ],
    reason: 'Create reviewer command permissions.',
  })
  const reviewerGroup = await createOrganizationGroup({
    actorUserId: userId,
    bundleIds: [reviewerBundle.bundleId],
    complianceSource: null,
    managementMode: 'manual',
    name: 'Reviewer command grants',
    restricted: true,
  })
  const reviewerAssignment = await assignOrganizationGroup({
    actorUserId: userId,
    expiresAt: null,
    groupId: reviewerGroup.groupId,
    reason: 'Grant reviewer command permissions.',
    targetUserId: userId,
  })
  const ordinaryBundle = await createOrganizationPermissionBundle({
    actorUserId: userId,
    name: 'Reviewer command ordinary access',
    permissions: [{ type: 'service', key: 'discord.reviewer-command' }],
    reason: 'Create reviewer command ordinary access.',
  })
  const ordinaryGroup = await createOrganizationGroup({
    actorUserId: userId,
    bundleIds: [ordinaryBundle.bundleId],
    complianceSource: null,
    managementMode: 'manual',
    name: 'Reviewer command ordinary group',
    restricted: false,
  })
  const targetUserId = randomUUID()
  await establishCompliantAccount(targetUserId, 90_000_020)
  return {
    ordinaryBundleId: ordinaryBundle.bundleId,
    ordinaryGroupId: ordinaryGroup.groupId,
    reviewerAssignmentId: reviewerAssignment.assignmentId,
    reviewerBundleId: reviewerBundle.bundleId,
    reviewerGroupId: reviewerGroup.groupId,
    reviewerRoleGrantId: reviewerRoleGrant.grantId,
    targetManagedMemberLifecycleId: await loadActiveManagedMemberLifecycleId(targetUserId),
    targetUserId,
  }
}

function reviewerCommandBinding<
  const Permission extends 'member-audit.groups.manage' | 'member-audit.members.block',
>(
  fixture: {
    targetUserId: string
    targetManagedMemberLifecycleId: string
  },
  requiredPermission: Permission,
) {
  return {
    actorUserId: userId,
    managedMemberLifecycleId: fixture.targetManagedMemberLifecycleId,
    moduleId: 'member-audit',
    organizationDeploymentId: 1 as const,
    organizationVersion: 1,
    publisherPackage: '@eve-space/member-audit-manifest',
    reason: '',
    requiredPermission,
    targetUserId: fixture.targetUserId,
  }
}

function organizationActivityPermission() {
  return {
    key: 'organization-activity.view',
    moduleId: 'organization-activity',
    publisherPackage: '@eve-space/organization-activity-manifest',
    type: 'module' as const,
  }
}

function memberAuditPermission(key: 'member-audit.groups.manage' | 'member-audit.members.block') {
  return {
    key,
    moduleId: 'member-audit',
    publisherPackage: '@eve-space/member-audit-manifest',
    type: 'module' as const,
  }
}

async function loadActiveManagedMemberLifecycleId(targetUserId: string) {
  const [lifecycle] = await connection<{ managed_member_lifecycle_id: string }[]>`
    select managed_member_lifecycle_id
    from organization_managed_member_lifecycles
    where deployment_id = 1 and organization_version = 1 and user_id = ${targetUserId}
      and ended_at is null
  `
  if (!lifecycle) {
    throw new Error('Active managed-member lifecycle is missing')
  }
  return lifecycle.managed_member_lifecycle_id
}

async function seedCharacter(seedUserId: string, seedCharacterId: number) {
  await connection`insert into users (id) values (${seedUserId})`
  await connection`
    insert into characters (
      character_id,
      user_id,
      owner_hash,
      name,
      corporation_id,
      affiliation_checked_at,
      next_affiliation_check,
      affiliation_resolution_state,
      is_main
    ) values (
      ${seedCharacterId},
      ${seedUserId},
      ${`owner-${seedCharacterId}`},
      'Organization Pilot',
      98000001,
      now(),
      now() + interval '1 hour',
      'resolved',
      ${seedCharacterId === characterId}
    )
  `
  await connection`
    insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes)
    values (
      ${seedCharacterId},
      'encrypted-test-token',
      now() + interval '1 hour',
      '["esi-characters.read_corporation_roles.v1"]'::jsonb
    )
  `
  const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
    insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
    values ('character', ${String(seedCharacterId)}, ${seedCharacterId})
    returning subject_lifecycle_id
  `
  return lifecycle!.subject_lifecycle_id
}

async function attachCharacterToExistingAccount(targetUserId: string, targetCharacterId: number) {
  await connection`
    insert into characters (
      character_id, user_id, owner_hash, name, corporation_id, affiliation_checked_at,
      next_affiliation_check, affiliation_resolution_state, is_main
    ) values (
      ${targetCharacterId}, ${targetUserId}, ${`owner-${targetCharacterId}`},
      'Derived Authority Pilot', 98000001, now(), now() + interval '1 hour', 'resolved', false
    )
  `
  await connection`
    insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes)
    values (
      ${targetCharacterId}, 'encrypted-test-token', now() + interval '1 hour',
      '["esi-characters.read_corporation_roles.v1"]'::jsonb
    )
  `
  const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
    insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
    values ('character', ${String(targetCharacterId)}, ${targetCharacterId})
    returning subject_lifecycle_id
  `
  if (!lifecycle) {
    throw new Error('Attached character lifecycle is missing')
  }
  return lifecycle.subject_lifecycle_id
}

function ownerClaimInput(
  override: Partial<Parameters<typeof claimOrganizationOwnership>[0]> & {
    affiliationCheckedAt: Date
  },
) {
  return {
    authorityCorporationId: 98_000_001,
    authorizationGeneration: 0,
    characterId,
    evidenceAuthorizationGeneration: 0,
    evidenceFreshUntil: new Date(Date.now() + 60 * 60 * 1000),
    observedAllianceId: null,
    observedCorporationId: 98_000_001,
    organizationId: 98_000_001,
    organizationVersion: 1,
    requiredScope: 'esi-characters.read_corporation_roles.v1',
    roleEvidenceRevision: 'roles-0',
    subjectLifecycleId,
    userId,
    ...override,
  }
}

async function refreshOwnerEvidence(grantId: string) {
  const [candidate] = await connection<
    {
      grant_id: string
      organization_version: string
      source_subject_lifecycle_id: string
      authorization_generation: number
      role_evidence_revision: string
    }[]
  >`
    select grant_id, organization_version, source_subject_lifecycle_id,
      authorization_generation, role_evidence_revision
    from organization_authority_evidence
    where grant_id = ${grantId}
  `
  if (!candidate) {
    throw new Error('Owner evidence candidate is missing')
  }
  return refreshOrganizationOwnerEvidence({
    authorizationGeneration: candidate.authorization_generation,
    grantId: candidate.grant_id,
    organizationVersion: Number(candidate.organization_version),
    roleEvidenceRevision: candidate.role_evidence_revision,
    sourceSubjectLifecycleId: candidate.source_subject_lifecycle_id,
  })
}

async function insertCorporationSourceFixture(
  sourceId: string,
  sourceUserId: string,
  sourceCharacterId: number,
) {
  const [binding] = await connection<
    { subject_lifecycle_id: string; authorization_generation: number }[]
  >`
    select lifecycle.subject_lifecycle_id, token.token_version as authorization_generation
    from platform_subject_lifecycles lifecycle
    join eve_tokens token on token.character_id = lifecycle.character_id
    where lifecycle.character_id = ${sourceCharacterId}
  `
  if (!binding) {
    throw new Error('Corporation-source character binding is missing')
  }
  await connection`
    insert into organization_corporation_sources (
      source_id, deployment_id, organization_version, corporation_id,
      character_id, evidence_character_id, source_user_id, source_subject_lifecycle_id,
      authorization_generation, role_evidence_revision, observed_corporation_id,
      required_scope, director_role_present, observed_at, fresh_until, status,
      registered_by_user_id
    ) values (
      ${sourceId}, 1, 1, 98000001, ${sourceCharacterId}, ${sourceCharacterId},
      ${sourceUserId}, ${binding.subject_lifecycle_id}, ${binding.authorization_generation},
      'fixture-role-evidence', 98000001,
      'esi-corporations.read_corporation_membership.v1', true, now(),
      now() + interval '1 hour', 'fresh', ${sourceUserId}
    )
  `
}

function roleEvidence(overrides: Record<string, unknown> = {}) {
  const observedAt = new Date()
  return {
    authorizationGeneration: 0,
    freshUntil: new Date(observedAt.getTime() + 60 * 60 * 1000),
    observedAt,
    roleEvidenceRevision: observedAt.toISOString(),
    roles: ['Director'],
    rolesAtBase: [],
    rolesAtHeadquarters: [],
    rolesAtOther: [],
    stale: false,
    ...overrides,
  }
}

async function loadAffiliationCheckedAt(targetCharacterId = characterId) {
  const [character] = await connection<{ affiliation_checked_at: Date }[]>`
    select affiliation_checked_at from characters where character_id = ${targetCharacterId}
  `
  if (!character) {
    throw new Error('Seeded character is missing')
  }
  return character.affiliation_checked_at
}

async function loadOwnerClaimRowCounts() {
  const [counts] = await connection<{ grants: number; evidence: number; audits: number }[]>`
    select
      (select count(*)::integer from organization_role_grants) as grants,
      (select count(*)::integer from organization_authority_evidence) as evidence,
      (select count(*)::integer from organization_audit_events) as audits
  `
  return counts
}

async function waitForDatabase() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await connection`select 1`
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('PostgreSQL test container did not become ready')
}
