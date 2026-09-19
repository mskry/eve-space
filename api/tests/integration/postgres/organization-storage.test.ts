import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'

const ownerEvidenceMocks = vi.hoisted(() => ({
  getCharacterCorporationRoles: vi.fn(),
  observeAndPersistCharacterAffiliation: vi.fn(),
}))

vi.mock('../../../src/characters/affiliation-sync.js', () => ({
  observeAndPersistCharacterAffiliation: ownerEvidenceMocks.observeAndPersistCharacterAffiliation,
}))
vi.mock('../../../src/characters/corporation-roles.js', () => ({
  characterCorporationRolesScope: 'esi-characters.read_corporation_roles.v1',
  getCharacterCorporationRoles: ownerEvidenceMocks.getCharacterCorporationRoles,
}))

let container: StartedTestContainer
let connection: postgres.Sql
let secondConnection: postgres.Sql
let updateDeploymentOrganization: typeof import('../../../src/admin/store.js').updateDeploymentOrganization
let claimOrganizationOwnership: typeof import('../../../src/organization/owner-claim.js').claimOrganizationOwnership
let refreshOrganizationOwnerEvidence: typeof import('../../../src/organization/owner-evidence.js').refreshOrganizationOwnerEvidence
let selectDueOrganizationOwnerEvidence: typeof import('../../../src/organization/owner-evidence.js').selectDueOrganizationOwnerEvidence
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
  ;({ deleteCharacter } = await import('../../../src/auth/character-lifecycle.js'))
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
  if (!lifecycle) throw new Error('Seeded character lifecycle is missing')
  subjectLifecycleId = lifecycle.subject_lifecycle_id
  ownerEvidenceMocks.observeAndPersistCharacterAffiliation.mockResolvedValue({
    characterId,
    corporationId: 98_000_001,
    allianceId: null,
    affiliationCheckedAt: await loadAffiliationCheckedAt(),
    stale: false,
  })
  ownerEvidenceMocks.getCharacterCorporationRoles.mockResolvedValue({
    roles: ['Director'],
    rolesAtBase: [],
    rolesAtHeadquarters: [],
    rolesAtOther: [],
  })
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
        reason: 'Attempt an invalid permission.',
        permissions: [{ ...organizationActivityPermission(), key: 'organization-activity.typo' }],
      }),
    ).rejects.toMatchObject({ code: 'permission-unavailable' })

    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Organization activity',
      reason: 'Create organization activity access.',
      permissions: [organizationActivityPermission()],
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      name: 'Activity viewers',
      restricted: false,
      managementMode: 'manual',
      complianceSource: null,
      bundleIds: [bundle.bundleId],
    })
    await assignOrganizationGroup({
      actorUserId: userId,
      groupId: group.groupId,
      targetUserId,
      reason: 'Grant activity access.',
      expiresAt: null,
    })

    const [stored] = await connection<
      { publisher_package: string; module_id: string; review_allowed: boolean }[]
    >`
      select publisher_package, module_id, review_allowed
      from organization_permission_bundle_entries
      where bundle_id = ${bundle.bundleId}
    `
    expect(stored).toEqual({
      publisher_package: '@eve-space/organization-activity-manifest',
      module_id: 'organization-activity',
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
              type: 'module',
              publisherPackage: '@replacement/organization-activity-manifest',
              moduleId: 'organization-activity',
              key: 'organization-activity.view',
              available: false,
            },
          ],
        },
      ],
    })

    const retainedBundles = await listCurrentOrganizationPermissionBundles(userId)
    const retainedEntry = retainedBundles.bundles[0]?.permissions[0]
    if (!retainedEntry) throw new Error('Retained permission entry is missing')
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
      reason: 'Keep the unavailable permission.',
      permissions: [],
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
    expect(afterRetention).toEqual(beforeRetention)

    await updateOrganizationPermissionBundle({
      actorUserId: userId,
      bundleId: bundle.bundleId,
      name: bundle.name,
      reason: 'Remove the unavailable permission.',
      permissions: [],
      retainedUnavailableEntryIds: [],
    })
    const [counts] = await connection<{ entries: number; audits: number }[]>`
      select
        (select count(*)::integer from organization_permission_bundle_entries
          where bundle_id = ${bundle.bundleId}) as entries,
        (select count(*)::integer from organization_audit_events
          where subject_type = 'permission_bundle' and subject_id = ${bundle.bundleId}) as audits
    `
    expect(counts).toEqual({ entries: 0, audits: 3 })
  })

  test('rejects retained IDs that are foreign, missing, service, available, or duplicated', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Mixed permissions',
      reason: 'Create permissions for retention validation.',
      permissions: [
        organizationActivityPermission(),
        { type: 'service', key: 'discord.operations', reviewAllowed: true },
      ],
    })
    const foreignBundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Foreign permissions',
      reason: 'Create a foreign permission entry.',
      permissions: [{ type: 'service', key: 'discord.foreign' }],
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
        reason: 'Validate retained permission IDs.',
        permissions: [],
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
    expect(unchanged).toEqual({ name: bundle.name, entries: 2 })
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
      organizationVersion: 1,
      filters: { limit: 1 },
    })
    expect(firstPage.status).toBe('available')
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    const decodedCursor = Buffer.from(firstPage.nextCursor!, 'base64url').toString('utf8')
    expect(decodedCursor).not.toContain(firstPage.items[0]!.account.userId)
    expect(decodedCursor).not.toContain(secondUserId)
    expect(firstPage.items[0]).toEqual(
      expect.objectContaining({
        account: expect.objectContaining({ mainCharacter: expect.any(Object) }),
        managedAffiliation: expect.objectContaining({ corporationId: 98_000_001 }),
        compliance: expect.objectContaining({ state: 'pending' }),
      }),
    )
    expect(firstPage.items[0]).not.toHaveProperty('groups')
    expect(firstPage.items[0]).not.toHaveProperty('evidence')

    const secondPage = await searchManagedOrganizationAccounts({
      organizationVersion: 1,
      filters: { limit: 1, cursor: firstPage.nextCursor! },
    })
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0]!.account.userId).not.toBe(firstPage.items[0]!.account.userId)
    expect(secondPage.nextCursor).toBeNull()

    await expect(
      searchManagedOrganizationAccounts({
        organizationVersion: 1,
        filters: { query: 'different filter', cursor: firstPage.nextCursor! },
      }),
    ).rejects.toThrow('Invalid reviewer account search input')
    const tamperedCursor = `${firstPage.nextCursor!.startsWith('A') ? 'B' : 'A'}${firstPage.nextCursor!.slice(1)}`
    await expect(
      searchManagedOrganizationAccounts({
        organizationVersion: 1,
        filters: { cursor: tamperedCursor },
      }),
    ).rejects.toThrow('Invalid reviewer account search input')

    const blocked = await searchManagedOrganizationAccounts({
      organizationVersion: 1,
      filters: { blocked: true },
    })
    expect(blocked.items.map(({ account }) => account.userId)).toEqual([secondUserId])

    await connection`
      update characters
      set corporation_id = 98000002
      where character_id = ${secondCharacterId}
    `
    await expect(
      searchManagedOrganizationAccounts({
        organizationVersion: 1,
        filters: { query: String(secondCharacterId) },
      }),
    ).resolves.toEqual({
      organizationVersion: 1,
      status: 'available',
      items: [],
      nextCursor: null,
    })
    for (const query of ['%', '_', '\\'])
      await expect(
        searchManagedOrganizationAccounts({ organizationVersion: 1, filters: { query } }),
      ).resolves.toEqual({
        organizationVersion: 1,
        status: 'available',
        items: [],
        nextCursor: null,
      })
  })

  test('projects the core reviewer directory without compliance, block, or module evidence', async () => {
    const page = await searchManagedOrganizationDirectory({
      organizationVersion: 1,
      filters: { query: 'Organization Pilot' },
    })

    expect(page.status).toBe('available')
    expect(page.items).toHaveLength(1)
    expect(Object.keys(page.items[0]!).toSorted()).toEqual([
      'account',
      'managedAffiliation',
      'managedMemberLifecycleId',
    ])
    expect(page.items[0]).not.toHaveProperty('compliance')
    expect(page.items[0]).not.toHaveProperty('block')
    expect(page.items[0]).not.toHaveProperty('evidenceSections')
    await expect(
      searchManagedOrganizationDirectory({ organizationVersion: 2, filters: {} }),
    ).resolves.toEqual({
      organizationVersion: 2,
      status: 'unavailable',
      items: [],
      nextCursor: null,
    })
  })

  test('does not expose or match an unclassified main character', async () => {
    const managedCharacterId = characterId + 1
    await connection`
      update characters set corporation_id = 98000002 where character_id = ${characterId}
    `
    await connection`
      insert into characters (
        character_id, user_id, name, corporation_id, affiliation_checked_at,
        next_affiliation_check, affiliation_resolution_state, is_main
      ) values (
        ${managedCharacterId}, ${userId}, 'Managed Alt', 98000001, now(),
        now() + interval '1 hour', 'resolved', false
      )
    `
    await connection`
      insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
      values ('character', ${String(managedCharacterId)}, ${managedCharacterId})
    `

    const visible = await searchManagedOrganizationAccounts({
      organizationVersion: 1,
      filters: { query: 'Managed Alt' },
    })
    expect(visible.items).toHaveLength(1)
    expect(visible.items[0]!.account.mainCharacter).toBeNull()

    await expect(
      searchManagedOrganizationAccounts({
        organizationVersion: 1,
        filters: { query: 'Organization Pilot' },
      }),
    ).resolves.toEqual({
      organizationVersion: 1,
      status: 'available',
      items: [],
      nextCursor: null,
    })

    await connection`
      insert into organization_character_exceptions (
        deployment_id, organization_version, user_id, character_id, approver_user_id, reason
      ) values (1, 1, ${userId}, ${characterId}, ${userId}, 'Approved external main')
    `
    const withApprovedMain = await searchManagedOrganizationAccounts({
      organizationVersion: 1,
      filters: { query: 'Managed Alt' },
    })
    expect(withApprovedMain.items[0]!.account.mainCharacter).toEqual({
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
      searchManagedOrganizationAccounts({ organizationVersion: 1, filters: {} }),
    ).resolves.toEqual({
      organizationVersion: 1,
      status: 'unavailable',
      items: [],
      nextCursor: null,
    })
  })

  test('rejects malformed reviewer account search filters before querying', async () => {
    await expect(
      searchManagedOrganizationAccounts({ organizationVersion: 1, filters: { limit: 51 } }),
    ).rejects.toThrow('Invalid reviewer account search input')
    await expect(
      searchManagedOrganizationAccounts({
        organizationVersion: 1,
        filters: { query: 'bad\nquery' },
      }),
    ).rejects.toThrow('Invalid reviewer account search input')
    await expect(
      searchManagedOrganizationAccounts({ organizationVersion: 1, filters: { corporationId: -1 } }),
    ).rejects.toThrow('Invalid reviewer account search input')
  })

  test('resolves a reviewer target through a repeatable-read locked PostgreSQL snapshot', async () => {
    await expect(
      resolveOrganizationReviewerTarget({ organizationVersion: 1, targetUserId: userId }),
    ).resolves.toMatchObject({
      organizationVersion: 1,
      selection: { kind: 'account' },
      account: {
        userId,
        mainCharacter: { characterId, name: 'Organization Pilot' },
      },
      characters: [
        {
          characterId,
          subjectLifecycleId,
          affiliation: { membership: 'managed', freshness: 'fresh' },
        },
      ],
    })
  })

  test('blocks active source deletion but detaches historical source evidence safely', async () => {
    const sourceId = randomUUID()
    await connection`
      insert into organization_corporation_sources (
        source_id, deployment_id, organization_version, corporation_id,
        character_id, evidence_character_id, registered_by_user_id
      ) values (${sourceId}, 1, 1, 98000001, ${characterId}, ${characterId}, ${userId})
    `
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
    expect(historical).toEqual({ character_id: null, evidence_character_id: String(characterId) })
    await expect(connection<{ ended_at: Date | null }[]>`
      select ended_at
      from organization_managed_member_lifecycles
      where deployment_id = 1 and organization_version = 1 and user_id = ${userId}
    `).resolves.toEqual([{ ended_at: expect.any(Date) }])
  })

  test('persists compliance changes idempotently with normalized issues and stable events', async () => {
    const evaluatedAt = new Date('2026-09-01T12:00:00.000Z')

    await expect(
      recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        organizationVersion: 1,
        userId,
        now: evaluatedAt,
      }),
    ).resolves.toMatchObject({ outcome: 'changed', evaluation: { state: 'compliant' } })
    await expect(
      recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        organizationVersion: 1,
        userId,
        now: new Date('2026-09-01T12:05:00.000Z'),
      }),
    ).resolves.toMatchObject({ outcome: 'unchanged', evaluation: { state: 'compliant' } })

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
    expect(counts).toEqual({ projections: 1, issues: 0, audits: 1, events: 1 })
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
        state: 'suspended',
        accessValidUntil: null,
        issues: [
          {
            issueKey: `character:${characterId}:authorization-missing`,
            issueCode: 'character-authorization-missing',
            characterId,
            requiredScope: null,
          },
        ],
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
        requiredScopes: ['esi-wallet.read_character_wallet.v1'],
        strictRemediationDurationSeconds: 0,
        staleEvidenceGraceDurationSeconds: 3600,
        reason: 'Require current wallet authorization.',
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
    expect(unchanged).toEqual({
      policy_version: '1',
      required_scopes: [],
      state: 'compliant',
      audits: 0,
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
        requiredScopes: [],
        strictRemediationDurationSeconds: 0,
        staleEvidenceGraceDurationSeconds: 3600,
        reason: 'Restore a policy the verified owner satisfies.',
      }),
    ).resolves.toMatchObject({ policyVersion: 3, requiredScopes: [] })
    const [recovered] = await connection<{ state: string }[]>`
      select state from organization_account_compliance where user_id = ${userId}
    `
    expect(recovered).toEqual({ state: 'compliant' })
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
          requiredScopes: ['esi-wallet.read_character_wallet.v1'],
          strictRemediationDurationSeconds: 0,
          staleEvidenceGraceDurationSeconds: 3600,
          reason: 'This mutation must roll back.',
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
    expect(state).toEqual({
      policy_version: '1',
      required_scopes: [],
      compliance_state: 'compliant',
      audits: 0,
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
      requiredScopes: [],
      strictRemediationDurationSeconds: 3600,
      staleEvidenceGraceDurationSeconds: 3600,
      reason: 'Allow one hour for established member remediation.',
    })
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Review-period access',
      reason: 'Create review-period access.',
      permissions: [
        { type: 'service', key: 'discord.review-member', reviewAllowed: true },
        { type: 'service', key: 'discord.review-denied', reviewAllowed: false },
      ],
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      name: 'Review-period members',
      restricted: false,
      managementMode: 'manual',
      complianceSource: null,
      bundleIds: [bundle.bundleId],
    })
    await assignOrganizationGroup({
      actorUserId: userId,
      groupId: group.groupId,
      targetUserId,
      reason: 'Established member access.',
      expiresAt: null,
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
    expect(review!.access_valid_until).toEqual(review!.review_deadline)
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
      modules: [],
      services: ['discord.review-member'],
    })

    const afterDeadline = new Date(review!.review_deadline.getTime() + 1)
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId: targetUserId,
      now: afterDeadline,
    })
    await expect(getOrganizationGroupPermissions(targetUserId, afterDeadline)).resolves.toEqual({
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
      requiredScopes: [],
      strictRemediationDurationSeconds: 3600,
      staleEvidenceGraceDurationSeconds: 3600,
      reason: 'Allow a bounded first-time review.',
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
      evaluation: { state: 'review_required', accessValidUntil: null },
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
      evaluation: { state: 'pending', reviewDeadline: null, accessValidUntil: null },
    })
  })

  test('approves, expires, and revokes exceptions with same-transaction compliance changes', async () => {
    await ensureManagedCorporation()
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await grantOrganizationRole({
      actorUserId: userId,
      targetUserId: userId,
      role: 'hr_auditor',
      reason: 'Registration review duty.',
    })
    const targetUserId = randomUUID()
    const managedCharacterId = 90_000_001
    const externalCharacterId = 90_000_002
    await seedCharacter(targetUserId, managedCharacterId)
    await connection`
      insert into characters (
        character_id, user_id, name, corporation_id, affiliation_checked_at,
        next_affiliation_check, affiliation_resolution_state, is_main
      ) values (
        ${externalCharacterId}, ${targetUserId}, 'External Pilot', 98000002, now(),
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
      userId: targetUserId,
      characterId: externalCharacterId,
      reason: 'Approved disclosed external character.',
      expiresAt,
    })
    await expect(loadComplianceState(targetUserId)).resolves.toBe('compliant')

    await expireOrganizationCharacterExceptions(new Date(expiresAt.getTime() + 1), 10)
    await expect(loadComplianceState(targetUserId)).resolves.toBe('suspended')

    const second = await approveOrganizationCharacterException({
      actorUserId: userId,
      userId: targetUserId,
      characterId: externalCharacterId,
      reason: 'Renewed external-character approval.',
      expiresAt: null,
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
      userId: targetUserId,
      characterId: externalCharacterId,
      reason: 'Final external-character approval.',
      expiresAt: null,
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
    expect(decisions).toEqual([
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
      { type: 'alliance', id: 99_000_001, name: 'Test Alliance', ticker: 'ALLY' },
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
        userId: targetUserId,
        characterId: targetCharacterId,
        reason: 'Cannot be approved from stale alliance evidence.',
        expiresAt: null,
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
      organizationVersion: 1,
      state: 'pending',
      evidenceFreshness: 'unavailable',
      accountReasons: [{ code: 'no-attached-characters' }],
      remediationActions: [{ type: 'attach-character', path: '/auth/eve/attach' }],
      characters: [],
      disclosureNotice: expect.stringContaining('member disclosure'),
    })

    await ensureManagedCorporation()
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId,
    })
    await expect(getOrganizationAccountComplianceDetails(userId)).resolves.toMatchObject({
      state: 'compliant',
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
      organizationVersion: 1,
      state: 'compliant',
      evidenceFreshness: 'fresh',
      accessValidUntil: expect.any(Date),
      blocked: false,
    })
    const context = await loadOrganizationSessionContext(userId)
    expect(context.accessValidUntil!.getTime()).toBeGreaterThan(Date.now())
  })

  test('recomputes disclosed accounts from current state when a managed corporation departs', async () => {
    const observedAt = new Date()
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: 1,
      userId,
      now: observedAt,
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
      deploymentId: 1,
      organizationVersion: 1,
      corporationId: 98000001,
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
    expect(projections).toEqual([
      {
        state: 'suspended',
        issue_code: 'no-managed-organization-character',
        character_id: null,
      },
      {
        state: 'suspended',
        issue_code: 'character-outside-managed-organization',
        character_id: String(characterId),
      },
    ])
    await expect(connection<{ ended_at: Date | null }[]>`
      select ended_at
      from organization_managed_member_lifecycles
      where managed_member_lifecycle_id = ${initialLifecycle!.managed_member_lifecycle_id}
    `).resolves.toEqual([{ ended_at: expect.any(Date) }])

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
      managed_member_lifecycle_id: initialLifecycle!.managed_member_lifecycle_id,
      ended_at: expect.any(Date),
    })
    expect(lifecycles).toContainEqual({
      managed_member_lifecycle_id: expect.not.stringMatching(
        initialLifecycle!.managed_member_lifecycle_id,
      ),
      ended_at: null,
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
        corporationId: 98_000_001,
        characterId,
      }),
    ).resolves.toMatchObject({
      replaced: false,
      source: { organizationVersion: 1, corporationId: 98_000_001, characterId },
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
      lifecycle_source_id: stored?.source_id,
      audit_type: 'corporation-source.registered',
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
        corporationId: 98_000_001,
        characterId,
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
    const replacementCharacterId = characterId + 1
    await connection`
      insert into characters (
        character_id,
        user_id,
        name,
        corporation_id,
        affiliation_checked_at,
        next_affiliation_check,
        affiliation_resolution_state,
        is_main
      ) values (
        ${replacementCharacterId},
        ${userId},
        'Replacement Source',
        98000001,
        now(),
        now() + interval '1 hour',
        'resolved',
        false
      )
    `
    await connection`
      insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes)
      values (
        ${replacementCharacterId},
        'encrypted-test-token',
        now() + interval '1 hour',
        '["esi-corporations.read_corporation_membership.v1"]'::jsonb
      )
    `
    await connection`
      insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
      values ('character', ${String(replacementCharacterId)}, ${replacementCharacterId})
    `

    await expect(
      registerOrganizationCorporationSource({
        actorUserId: userId,
        corporationId: 98_000_001,
        characterId: replacementCharacterId,
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

    expect(stored).toEqual({
      grant_id: grant.grantId,
      role: 'organization_owner',
      evidence_status: 'fresh',
      director_role_present: true,
      event_type: 'role.granted',
      outcome: 'granted',
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
          userId: secondUserId,
          characterId: secondCharacterId,
          subjectLifecycleId: secondSubjectLifecycleId,
          affiliationCheckedAt: await loadAffiliationCheckedAt(secondCharacterId),
        }),
      ),
    ])
    const activeOwners = await connection<{ user_id: string }[]>`
      select user_id
      from organization_role_grants
      where role = 'organization_owner' and revoked_at is null
    `

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toEqual([
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
      await expect(loadOwnerClaimRowCounts()).resolves.toEqual({
        grants: 0,
        evidence: 0,
        audits: 0,
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
    await expect(loadOwnerClaimRowCounts()).resolves.toEqual({ grants: 0, evidence: 0, audits: 0 })
  })

  test('reconstructs due owner evidence and refreshes it from current authority', async () => {
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update organization_authority_evidence
      set
        verified_at = now() - interval '2 hours',
        last_checked_at = now() - interval '2 hours'
      where grant_id = ${grant.grantId}
    `

    await expect(selectDueOrganizationOwnerEvidence()).resolves.toEqual([
      { grantId: grant.grantId },
    ])
    await expect(refreshOrganizationOwnerEvidence(grant.grantId)).resolves.toBe('fresh')
    expect(ownerEvidenceMocks.observeAndPersistCharacterAffiliation).toHaveBeenCalledWith(
      characterId,
      undefined,
      expect.any(Function),
    )
    await expect(selectDueOrganizationOwnerEvidence()).resolves.toEqual([])
  })

  test('revokes and audits owner authority immediately after fresh Director loss by default', async () => {
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    ownerEvidenceMocks.getCharacterCorporationRoles.mockResolvedValue({
      roles: ['Accountant'],
      rolesAtBase: [],
      rolesAtHeadquarters: [],
      rolesAtOther: [],
    })

    await expect(refreshOrganizationOwnerEvidence(grant.grantId)).resolves.toBe('revoked')
    const [stored] = await connection<
      { revoked_at: Date; status: string; failure_class: string; audit_count: number }[]
    >`
      select
        grants.revoked_at,
        evidence.status,
        evidence.failure_class,
        (select count(*)::integer from organization_audit_events where event_type = 'role.revoked') as audit_count
      from organization_role_grants grants
      join organization_authority_evidence evidence on evidence.grant_id = grants.grant_id
      where grants.grant_id = ${grant.grantId}
    `
    expect(stored).toMatchObject({
      revoked_at: expect.any(Date),
      status: 'invalid',
      failure_class: 'strict:not-director',
      audit_count: 1,
    })
  })

  test('bounds transient review by the last successful verification without sliding its deadline', async () => {
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update organization_authority_evidence
      set
        verified_at = now() - interval '2 hours',
        last_checked_at = now() - interval '2 hours'
      where grant_id = ${grant.grantId}
    `
    ownerEvidenceMocks.observeAndPersistCharacterAffiliation.mockResolvedValue({
      characterId,
      corporationId: 98_000_001,
      allianceId: null,
      affiliationCheckedAt: new Date(),
      stale: true,
    })

    await expect(refreshOrganizationOwnerEvidence(grant.grantId)).resolves.toBe('review-required')
    const [first] = await connection<{ review_deadline: Date }[]>`
      select review_deadline
      from organization_authority_evidence
      where grant_id = ${grant.grantId}
    `
    await expect(refreshOrganizationOwnerEvidence(grant.grantId)).resolves.toBe('review-required')
    const [second] = await connection<{ review_deadline: Date }[]>`
      select review_deadline
      from organization_authority_evidence
      where grant_id = ${grant.grantId}
    `
    expect(second?.review_deadline).toEqual(first?.review_deadline)
    expect(first?.review_deadline.getTime()).toBeGreaterThan(Date.now())
  })

  test('never extends an owner review deadline when the failure kind changes', async () => {
    await connection`
      update deployment_settings
      set strict_remediation_duration_seconds = 86400, stale_evidence_grace_duration_seconds = 7200
      where id = 1
    `
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    ownerEvidenceMocks.getCharacterCorporationRoles.mockResolvedValue({
      roles: ['Accountant'],
      rolesAtBase: [],
      rolesAtHeadquarters: [],
      rolesAtOther: [],
    })

    await expect(refreshOrganizationOwnerEvidence(grant.grantId)).resolves.toBe('review-required')
    const [strictFailure] = await connection<{ review_deadline: Date }[]>`
      select review_deadline from organization_authority_evidence where grant_id = ${grant.grantId}
    `

    ownerEvidenceMocks.observeAndPersistCharacterAffiliation.mockResolvedValue({
      characterId,
      corporationId: 98_000_001,
      allianceId: null,
      affiliationCheckedAt: new Date(),
      stale: true,
    })
    await expect(refreshOrganizationOwnerEvidence(grant.grantId)).resolves.toBe('review-required')
    const [transientFailure] = await connection<{ review_deadline: Date }[]>`
      select review_deadline from organization_authority_evidence where grant_id = ${grant.grantId}
    `

    ownerEvidenceMocks.observeAndPersistCharacterAffiliation.mockResolvedValue({
      characterId,
      corporationId: 98_000_001,
      allianceId: null,
      affiliationCheckedAt: new Date(),
      stale: false,
    })
    await expect(refreshOrganizationOwnerEvidence(grant.grantId)).resolves.toBe('review-required')
    const [secondStrictFailure] = await connection<{ review_deadline: Date }[]>`
      select review_deadline from organization_authority_evidence where grant_id = ${grant.grantId}
    `

    expect(transientFailure?.review_deadline.getTime()).toBeLessThanOrEqual(
      strictFailure?.review_deadline.getTime() ?? 0,
    )
    expect(secondStrictFailure?.review_deadline).toEqual(transientFailure?.review_deadline)
  })

  test('revokes instead of endlessly requeueing when newer affiliation supersedes a successful read', async () => {
    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update characters
      set corporation_id = 98000002, affiliation_checked_at = now() + interval '1 second'
      where character_id = ${characterId}
    `

    await expect(refreshOrganizationOwnerEvidence(grant.grantId)).resolves.toBe('revoked')
    await expect(selectDueOrganizationOwnerEvidence()).resolves.toEqual([])
  })

  test('atomically replaces an owner whose strict authority failure is under review', async () => {
    const original = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await connection`
      update organization_authority_evidence
      set
        status = 'review_required',
        failure_class = 'strict:not-director',
        review_deadline = now() + interval '1 hour'
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
        userId: replacementUserId,
        characterId: replacementCharacterId,
        subjectLifecycleId: replacementSubjectLifecycleId,
        affiliationCheckedAt: await loadAffiliationCheckedAt(replacementCharacterId),
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

    expect(grants).toEqual([
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
        status = 'review_required',
        failure_class = 'transient:esi-unavailable',
        review_deadline = now() + interval '1 hour'
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
          userId: claimantUserId,
          characterId: claimantCharacterId,
          subjectLifecycleId: claimantSubjectLifecycleId,
          affiliationCheckedAt: await loadAffiliationCheckedAt(claimantCharacterId),
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
          userId: claimantUserId,
          characterId: claimantCharacterId,
          subjectLifecycleId: claimantSubjectLifecycleId,
          affiliationCheckedAt: await loadAffiliationCheckedAt(claimantCharacterId),
        }),
      ),
    ).rejects.toMatchObject({ code: 'owner-already-claimed' })
    const active = await connection<{ grant_id: string }[]>`
      select grant_id from organization_role_grants where revoked_at is null
    `
    expect(active).toEqual([{ grant_id: original.grantId }])
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
      targetUserId: claimantUserId,
      reason: 'Member access remains under review.',
    })
    ownerEvidenceMocks.getCharacterCorporationRoles.mockResolvedValue({
      roles: ['Accountant'],
      rolesAtBase: [],
      rolesAtHeadquarters: [],
      rolesAtOther: [],
    })
    await expect(refreshOrganizationOwnerEvidence(ownerGrant.grantId)).resolves.toBe('revoked')
    await expect(getOrganizationAccessContext(claimantUserId)).resolves.toMatchObject({
      isBlocked: true,
      isOrganizationOwner: false,
      claimAvailable: false,
    })

    await expect(
      claimOrganizationOwnership(
        ownerClaimInput({
          userId: claimantUserId,
          characterId: claimantCharacterId,
          subjectLifecycleId: claimantSubjectLifecycleId,
          affiliationCheckedAt: await loadAffiliationCheckedAt(claimantCharacterId),
        }),
      ),
    ).rejects.toMatchObject({ code: 'member-blocked' })
    const [activeOwners] = await connection<{ count: number }[]>`
      select count(*)::integer as count
      from organization_role_grants
      where role = 'organization_owner' and revoked_at is null
    `
    expect(activeOwners).toEqual({ count: 0 })
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
        ownerClaimInput({ affiliationCheckedAt: new Date(checkedAt.getTime() - 1_000) }),
      ),
    ).resolves.toEqual({ grantId: expect.any(String) })
  })

  test('grants and revokes HR roles with complete immutable current-version audit entries', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await connection`insert into users (id) values (${targetUserId})`

    const grant = await grantOrganizationRole({
      actorUserId: userId,
      targetUserId,
      role: 'hr_auditor',
      reason: 'Delegated registration review.',
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
      role: 'hr_auditor',
      revokedAt: expect.any(String),
      revokedByUserId: userId,
      revocationReason: 'Delegation ended.',
    })
    expect(context).toMatchObject({
      isOrganizationOwner: true,
      claimAvailable: false,
      ownerStatus: 'fresh',
      authorityCharacter: {
        characterId,
        name: 'Organization Pilot',
        corporationId: 98_000_001,
      },
    })
    expect(activeRoles.grants).toEqual([
      expect.objectContaining({
        grantId: grant.grantId,
        userId: targetUserId,
        role: 'hr_auditor',
        mainCharacterId: null,
        mainCharacterName: null,
      }),
    ])
    await expect(listCurrentOrganizationRoles()).resolves.toEqual({ grants: [] })
    expect(audits).toEqual([
      {
        event_type: 'role.granted',
        actor_id: userId,
        subject_user_id: targetUserId,
        role: 'hr_auditor',
        reason: 'Delegated registration review.',
        outcome: 'granted',
        occurred_at: expect.any(Date),
      },
      {
        event_type: 'role.revoked',
        actor_id: userId,
        subject_user_id: targetUserId,
        role: 'hr_auditor',
        reason: 'Delegation ended.',
        outcome: 'revoked',
        occurred_at: expect.any(Date),
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
      targetUserId,
      role: 'hr_auditor',
      reason: 'Registration review duty.',
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
        targetUserId,
        role: 'hr_auditor',
        reason: 'Unauthorized attempt.',
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
      targetUserId,
      role: 'hr_auditor',
      reason: 'Current organization HR duty.',
    })

    await updateDeploymentOrganization(
      { type: 'corporation', id: 98_000_002, name: 'Second Corporation', ticker: 'TWO' },
      adminId,
    )

    await expect(getOrganizationAccessContext(userId)).resolves.toMatchObject({
      isOrganizationOwner: false,
      claimAvailable: true,
      ownerStatus: null,
      authorityCharacter: null,
    })
    await expect(listCurrentOrganizationRoles()).resolves.toEqual({ grants: [] })
    const [evidence] = await connection<{ status: string; failure_class: string }[]>`
      select status, failure_class
      from organization_authority_evidence
      where grant_id = ${ownerGrant.grantId}
    `
    expect(evidence).toEqual({
      status: 'invalid',
      failure_class: 'strict:organization-changed',
    })
    await expect(
      grantOrganizationRole({
        actorUserId: userId,
        targetUserId,
        role: 'director',
        reason: 'Stale owner attempt.',
      }),
    ).rejects.toMatchObject({ code: 'owner-authority-required' })
  })

  test('keeps deployment administration independent from EVE-backed owner authority', async () => {
    await connection`
      insert into deployment_admins (id, email, password_hash)
      values (${userId}, 'dual-authority@example.com', 'test-password-hash')
    `
    await expect(getOrganizationAccessContext(userId)).resolves.toMatchObject({
      isOrganizationOwner: false,
      claimAvailable: true,
    })

    const grant = await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    await expect(getOrganizationAccessContext(userId)).resolves.toMatchObject({
      isOrganizationOwner: true,
      authorityCharacter: { characterId },
    })

    ownerEvidenceMocks.getCharacterCorporationRoles.mockResolvedValue({
      roles: ['Accountant'],
      rolesAtBase: [],
      rolesAtHeadquarters: [],
      rolesAtOther: [],
    })
    await expect(refreshOrganizationOwnerEvidence(grant.grantId)).resolves.toBe('revoked')
    const [deploymentAdmin] = await connection<{ id: string }[]>`
      select id from deployment_admins where id = ${userId}
    `
    expect(deploymentAdmin?.id).toBe(userId)
    await expect(getOrganizationAccessContext(userId)).resolves.toMatchObject({
      isOrganizationOwner: false,
      claimAvailable: true,
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
      reason: 'Create operations access.',
      permissions: [
        organizationActivityPermission(),
        { type: 'service', key: 'discord.operations' },
        { type: 'service', key: 'discord.operations' },
      ],
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      name: 'Operations',
      restricted: false,
      managementMode: 'manual',
      complianceSource: null,
      bundleIds: [bundle.bundleId],
    })
    const expiresAt = new Date(Date.now() + 60_000)
    const assignment = await assignOrganizationGroup({
      actorUserId: userId,
      groupId: group.groupId,
      targetUserId,
      reason: 'Temporary operations duty.',
      expiresAt,
    })

    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
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
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
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
    expect(revocation).toEqual({
      event_type: 'entitlement.revoked',
      subject_id: 'discord.operations',
      causation_type: 'compliance.transitioned',
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
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
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
    expect(grant).toEqual({
      event_type: 'entitlement.granted',
      subject_id: 'discord.operations',
      causation_type: 'compliance.transitioned',
    })
    await expect(
      getOrganizationGroupPermissions(targetUserId, new Date(expiresAt.getTime() + 1)),
    ).resolves.toEqual({ modules: [], services: [] })

    await expect(
      revokeOrganizationGroupAssignment({
        actorUserId: userId,
        groupId: group.groupId,
        assignmentId: assignment.assignmentId,
        reason: 'Operations duty ended.',
      }),
    ).rejects.toMatchObject({ code: 'assignment-not-found' })
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
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
    expect(audits).toEqual([
      {
        event_type: 'group.assigned',
        actor_type: 'user',
        actor_id: userId,
        subject_id: group.groupId,
        assignment_id: assignment.assignmentId,
        target_user_id: targetUserId,
        assignment_source: 'manual',
        entitlement_expires_at: expiresAt,
        occurred_at: expect.any(Date),
      },
      {
        event_type: 'group.revoked',
        actor_type: 'system',
        actor_id: null,
        subject_id: group.groupId,
        assignment_id: assignment.assignmentId,
        target_user_id: targetUserId,
        assignment_source: 'manual',
        entitlement_expires_at: expiresAt,
        occurred_at: expiresAt,
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
      targetUserId: directorUserId,
      role: 'director',
      reason: 'Delegated group management.',
    })
    await expect(
      createOrganizationPermissionBundle({
        actorUserId: directorUserId,
        name: 'Unauthorized definition',
        reason: 'Attempt an unauthorized definition.',
        permissions: [{ type: 'service', key: 'discord.leadership' }],
      }),
    ).rejects.toMatchObject({ code: 'owner-authority-required' })
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Restricted services',
      reason: 'Create restricted services.',
      permissions: [{ type: 'service', key: 'discord.leadership' }],
    })
    const restricted = await createOrganizationGroup({
      actorUserId: userId,
      name: 'Leadership',
      restricted: true,
      managementMode: 'manual',
      complianceSource: null,
      bundleIds: [bundle.bundleId],
    })

    await expect(
      assignOrganizationGroup({
        actorUserId: directorUserId,
        groupId: restricted.groupId,
        targetUserId,
        reason: 'Unauthorized restricted assignment.',
        expiresAt: null,
      }),
    ).rejects.toMatchObject({ code: 'owner-authority-required' })
    const ordinary = await createOrganizationGroup({
      actorUserId: userId,
      name: 'Fleet operations',
      restricted: false,
      managementMode: 'manual',
      complianceSource: null,
      bundleIds: [bundle.bundleId],
    })
    await expect(
      assignOrganizationGroup({
        actorUserId: directorUserId,
        groupId: ordinary.groupId,
        targetUserId,
        reason: 'Delegated ordinary assignment.',
        expiresAt: null,
      }),
    ).resolves.toMatchObject({ userId: targetUserId, assignmentSource: 'manual' })
  })

  test('converges compliance-managed groups only from their declared source', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await establishCompliantAccount(targetUserId, 90_000_001)
    await updateOrganizationRegistrationPolicy({
      actorUserId: userId,
      requiredScopes: [],
      strictRemediationDurationSeconds: 3600,
      staleEvidenceGraceDurationSeconds: 3600,
      reason: 'Allow established members time to remediate.',
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
      reason: 'Create compliant member services.',
      permissions: [{ type: 'service', key: 'discord.member' }],
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      name: 'Compliant members',
      restricted: false,
      managementMode: 'compliance',
      complianceSource: 'core.registration',
      bundleIds: [bundle.bundleId],
    })

    await expect(
      assignOrganizationGroup({
        actorUserId: userId,
        groupId: group.groupId,
        targetUserId,
        reason: 'Manual override.',
        expiresAt: null,
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
    expect(reviewAssignment).toEqual({ assignment_source: 'compliance' })
    await expect(
      convergeRegistrationComplianceGroupAssignment({
        groupId: group.groupId,
        targetUserId,
        eligible: true,
        reason: 'Repeated compliance result.',
      }),
    ).resolves.toMatchObject({ changed: false })
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
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
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
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
    expect(serviceRevocation).toEqual({
      subject_id: 'discord.member',
      causation_type: 'compliance.transitioned',
    })

    await updateDeploymentOrganization(
      { type: 'corporation', id: 98_000_002, name: 'Second Corporation', ticker: 'TWO' },
      adminId,
    )
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
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
    expect(audit).toEqual({ actor_type: 'system', actor_id: null, event_type: 'group.assigned' })
  })

  test('executes reviewer ordinary-group commands against the exact managed-member binding', async () => {
    const fixture = await establishReviewerCommandFixture()
    const expiresAt = new Date(Date.now() + 60_000)
    const assigned = await assignOrganizationReviewerOrdinaryGroup({
      ...reviewerCommandBinding(fixture, 'member-audit.groups.manage'),
      groupId: fixture.ordinaryGroupId,
      reason: '  Temporary access after review.  ',
      expiresAt,
    })
    expect(assigned).toEqual({
      decision: 'assigned',
      organizationVersion: 1,
      targetUserId: fixture.targetUserId,
      groupId: fixture.ordinaryGroupId,
      assignmentId: expect.any(String),
      expiresAt: expiresAt.toISOString(),
    })

    const otherTargetUserId = randomUUID()
    await establishCompliantAccount(otherTargetUserId, 90_000_021)
    await expect(
      revokeOrganizationReviewerOrdinaryGroup({
        ...reviewerCommandBinding(
          {
            ...fixture,
            targetUserId: otherTargetUserId,
            targetManagedMemberLifecycleId:
              await loadActiveManagedMemberLifecycleId(otherTargetUserId),
          },
          'member-audit.groups.manage',
        ),
        groupId: fixture.ordinaryGroupId,
        assignmentId: assigned.assignmentId,
        reason: 'Attempt to substitute the selected target.',
      }),
    ).rejects.toMatchObject({ code: 'assignment-binding-invalid' })

    await expect(
      revokeOrganizationReviewerOrdinaryGroup({
        ...reviewerCommandBinding(fixture, 'member-audit.groups.manage'),
        groupId: fixture.ordinaryGroupId,
        assignmentId: assigned.assignmentId,
        reason: 'Review access ended.',
      }),
    ).resolves.toMatchObject({
      decision: 'revoked',
      targetUserId: fixture.targetUserId,
      assignmentId: assigned.assignmentId,
      revokedAt: expect.any(String),
    })
    const audits = await connection<
      { event_type: string; actor_id: string; target_user_id: string; reason: string }[]
    >`
      select event_type, actor_id, target_user_id, reason
      from organization_audit_events
      where assignment_id = ${assigned.assignmentId}
      order by audit_sequence
    `
    expect(audits).toEqual([
      {
        event_type: 'group.assigned',
        actor_id: userId,
        target_user_id: fixture.targetUserId,
        reason: 'Temporary access after review.',
      },
      {
        event_type: 'group.revoked',
        actor_id: userId,
        target_user_id: fixture.targetUserId,
        reason: 'Review access ended.',
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
      name: 'Reviewer command compliance group',
      restricted: false,
      managementMode: 'compliance',
      complianceSource: 'core.registration',
      bundleIds: [fixture.ordinaryBundleId],
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
      name: 'Unsafe ordinary reviewer group',
      restricted: false,
      managementMode: 'manual',
      complianceSource: null,
      bundleIds: [fixture.reviewerBundleId],
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
      targetUserId: fixture.targetUserId,
      groupId: unsafeGroup.groupId,
      reason: 'Existing reviewer access.',
      expiresAt: null,
    })
    const reviewerTarget = await resolveOrganizationReviewerTarget({
      organizationVersion: 1,
      targetUserId: fixture.targetUserId,
    })
    const projectedUnsafeGroup = reviewerTarget?.groups.find(
      ({ groupId }) => groupId === unsafeGroup.groupId,
    )
    expect(projectedUnsafeGroup).toMatchObject({
      restricted: false,
      managementMode: 'manual',
      readOnly: true,
    })
    expect(projectedUnsafeGroup).not.toHaveProperty('hasReviewerPermission')

    await expect(
      assignOrganizationReviewerOrdinaryGroup({
        ...reviewerCommandBinding(
          {
            ...fixture,
            targetUserId: userId,
            targetManagedMemberLifecycleId: await loadActiveManagedMemberLifecycleId(userId),
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
            targetUserId: userId,
            targetManagedMemberLifecycleId: await loadActiveManagedMemberLifecycleId(userId),
          },
          'member-audit.groups.manage',
        ),
        groupId: fixture.reviewerGroupId,
        assignmentId: fixture.reviewerAssignmentId,
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
      targetUserId: userId,
      role: 'director',
      reason: 'Reviewer role restored for permission check.',
    })
    await revokeOrganizationGroupAssignment({
      actorUserId: userId,
      groupId: fixture.reviewerGroupId,
      assignmentId: fixture.reviewerAssignmentId,
      reason: 'Reviewer action permission removed.',
    })
    await expect(assignOrganizationReviewerOrdinaryGroup(command)).rejects.toMatchObject({
      code: 'reviewer-permission-required',
    })

    await updateDeploymentOrganization(
      { type: 'corporation', id: 98_000_002, name: 'Second Corporation', ticker: 'TWO' },
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
      decision: 'blocked',
      targetUserId: fixture.targetUserId,
      blockId: expect.any(String),
    })
    await expect(getOrganizationGroupPermissions(fixture.targetUserId)).resolves.toEqual({
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
    await expect(getOrganizationGroupPermissions(fixture.targetUserId)).resolves.toEqual({
      modules: [],
      services: ['discord.reviewer-command'],
    })

    await grantOrganizationRole({
      actorUserId: userId,
      targetUserId: fixture.targetUserId,
      role: 'hr_auditor',
      reason: 'Peer reviewer assignment.',
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
    expect(counts).toEqual({ decisions: 2, events: 2, transitions: 2 })
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
      targetUserId: directorUserId,
      role: 'director',
      reason: 'Member policy management.',
    })
    const targetDirectorGrant = await grantOrganizationRole({
      actorUserId: userId,
      targetUserId,
      role: 'director',
      reason: 'Operational leadership.',
    })
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Block precedence access',
      reason: 'Create block precedence access.',
      permissions: [
        organizationActivityPermission(),
        { type: 'service', key: 'discord.operations' },
      ],
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      name: 'Block precedence group',
      restricted: false,
      managementMode: 'manual',
      complianceSource: null,
      bundleIds: [bundle.bundleId],
    })
    const assignment = await assignOrganizationGroup({
      actorUserId: userId,
      groupId: group.groupId,
      targetUserId,
      reason: 'Current operations assignment.',
      expiresAt: new Date(Date.now() + 60_000),
    })

    await expect(
      blockOrganizationMember({
        actorUserId: directorUserId,
        targetUserId: userId,
        reason: 'Attempted governance lockout.',
      }),
    ).rejects.toMatchObject({ code: 'owner-block-not-allowed' })
    await expect(hasCurrentOrganizationManagerAuthority(targetUserId)).resolves.toBe(true)
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
      modules: ['organization-activity.view'],
      services: ['discord.operations'],
    })
    const firstBlock = await blockOrganizationMember({
      actorUserId: directorUserId,
      targetUserId,
      reason: 'Investigating a policy violation.',
    })
    await expect(hasCurrentOrganizationMemberBlock(targetUserId)).resolves.toBe(true)
    await expect(hasCurrentOrganizationManagerAuthority(targetUserId)).resolves.toBe(false)
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
      modules: [],
      services: [],
    })

    await unblockOrganizationMember({
      actorUserId: directorUserId,
      targetUserId,
      reason: 'Initial review cleared.',
    })
    await expect(hasCurrentOrganizationManagerAuthority(targetUserId)).resolves.toBe(true)
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
      modules: ['organization-activity.view'],
      services: ['discord.operations'],
    })

    await blockOrganizationMember({
      actorUserId: directorUserId,
      targetUserId,
      reason: 'New evidence requires a second review.',
    })
    await revokeOrganizationGroupAssignment({
      actorUserId: userId,
      groupId: group.groupId,
      assignmentId: assignment.assignmentId,
      reason: 'Operations assignment independently ended.',
    })
    await revokeOrganizationRole({
      actorUserId: userId,
      grantId: targetDirectorGrant.grantId,
      reason: 'Leadership delegation independently ended.',
    })
    await unblockOrganizationMember({
      actorUserId: directorUserId,
      targetUserId,
      reason: 'Second review completed against current grants.',
    })

    await expect(hasCurrentOrganizationMemberBlock(targetUserId)).resolves.toBe(false)
    await expect(hasCurrentOrganizationManagerAuthority(targetUserId)).resolves.toBe(false)
    await expect(getOrganizationGroupPermissions(targetUserId)).resolves.toEqual({
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
    expect(decisions).toEqual([
      {
        event_type: 'member.blocked',
        actor_id: directorUserId,
        subject_id: targetUserId,
        reason: 'Investigating a policy violation.',
        outcome: 'denied',
        organization_version: '1',
      },
      {
        event_type: 'member.unblocked',
        actor_id: directorUserId,
        subject_id: targetUserId,
        reason: 'Initial review cleared.',
        outcome: 'transitioned',
        organization_version: '1',
      },
      {
        event_type: 'member.blocked',
        actor_id: directorUserId,
        subject_id: targetUserId,
        reason: 'New evidence requires a second review.',
        outcome: 'denied',
        organization_version: '1',
      },
      {
        event_type: 'member.unblocked',
        actor_id: directorUserId,
        subject_id: targetUserId,
        reason: 'Second review completed against current grants.',
        outcome: 'transitioned',
        organization_version: '1',
      },
    ])
    expect(firstBlock).toMatchObject({
      userId: targetUserId,
      blockedByUserId: directorUserId,
      unblockedAt: null,
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
    expect(entitlementDecisions).toEqual([
      {
        event_type: 'entitlement.revoked',
        subject_id: 'discord.operations',
        causation_type: 'member.blocked',
      },
      {
        event_type: 'entitlement.granted',
        subject_id: 'discord.operations',
        causation_type: 'member.unblocked',
      },
      {
        event_type: 'entitlement.revoked',
        subject_id: 'discord.operations',
        causation_type: 'member.blocked',
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
        targetUserId,
        reason: 'First concurrent decision.',
      }),
      blockOrganizationMember({
        actorUserId: userId,
        targetUserId,
        reason: 'Second concurrent decision.',
      }),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'block-already-active' }),
      }),
    ])

    await updateDeploymentOrganization(
      { type: 'corporation', id: 98_000_002, name: 'Second Corporation', ticker: 'TWO' },
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
      reason: 'Create the bulk lock order bundle.',
      permissions: [{ type: 'service', key: 'discord.bulk-lock' }],
    })
    await createOrganizationGroup({
      actorUserId: userId,
      name: 'Bulk lock order group',
      restricted: false,
      managementMode: 'compliance',
      complianceSource: 'core.registration',
      bundleIds: [bundle.bundleId],
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
      reason: 'Create the concurrent assignment bundle.',
      permissions: [organizationActivityPermission()],
    })
    const group = await createOrganizationGroup({
      actorUserId: userId,
      name: 'Concurrent assignment group',
      restricted: false,
      managementMode: 'manual',
      complianceSource: null,
      bundleIds: [bundle.bundleId],
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
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(updateSettled).toBe(false)

    releaseAssignment()
    await assignmentTransaction
    await expect(managementUpdate).rejects.toThrow(
      'group management cannot change after assignment',
    )
  })

  test('serializes concurrent organization changes into consecutive isolated epochs', async () => {
    await Promise.all([
      updateDeploymentOrganization(
        { type: 'corporation', id: 98_000_002, name: 'Second Corporation', ticker: 'TWO' },
        adminId,
      ),
      updateDeploymentOrganization(
        { type: 'alliance', id: 99_000_003, name: 'Third Alliance', ticker: 'THREE' },
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
    expect(epochs.map(({ organization_version }) => organization_version)).toEqual(['1', '2', '3'])
    expect(epochs.slice(0, 2).every(({ superseded_at }) => superseded_at instanceof Date)).toBe(
      true,
    )
    expect(epochs[2]?.superseded_at).toBeNull()
    expect(events.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ previousOrganizationVersion: 1, organizationVersion: 2 }),
      expect.objectContaining({ previousOrganizationVersion: 2, organizationVersion: 3 }),
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
      { type: 'corporation', id: 98_000_002, name: 'Second Corporation', ticker: 'TWO' },
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

    expect(oldState).toEqual({
      current_corporations: 0,
      authoritative_compliance: 0,
      roster_observations: 1,
      active_managed_members: 0,
    })
    expect(newProjections).toHaveLength(2)
    expect(newProjections.every(({ authoritative }) => authoritative)).toBe(true)
    await expect(loadOrganizationSessionContext(firstUserId)).resolves.toMatchObject({
      organizationVersion: 2,
      state: 'suspended',
      accessValidUntil: null,
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
        targetUserId,
        targetCharacterId: 90_000_001,
        sectionId: 'wallet',
        decision: 'allowed',
        reason: 'authorized',
        organizationVersion: 1,
        policyVersion: 1,
        disclosureVersion: 3,
        occurredAt,
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
    expect(stored).toEqual({
      event_type: 'sensitive-access.decided',
      actor_id: userId,
      subject_id: targetUserId,
      target_user_id: targetUserId,
      target_character_id: '90000001',
      section_id: 'wallet',
      reason: 'authorized',
      outcome: 'granted',
      policy_version: '1',
      disclosure_version: '3',
      occurred_at: occurredAt,
    })
    const revisionsAfter = await loadOrganizationRevisionFacts(userId, 1, occurredAt)
    expect(revisionsAfter.latestAuditSequence).toBe(revisionsBefore.latestAuditSequence)
    await dbClient.db.transaction((transaction) =>
      appendOrganizationSensitiveAccessDecision(transaction, {
        actorUserId: userId,
        targetUserId: null,
        targetCharacterId: null,
        sectionId: 'skills',
        decision: 'denied',
        reason: 'target-not-authorized',
        organizationVersion: 1,
        policyVersion: 2,
        disclosureVersion: 4,
        occurredAt: new Date('2026-09-18T12:01:00.000Z'),
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
    expect(denied).toEqual({
      subject_type: 'deployment',
      subject_id: '1',
      target_user_id: null,
      target_character_id: null,
      reason: 'target-not-authorized',
      outcome: 'denied',
      policy_version: '2',
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
    await connection`
      insert into organization_corporation_sources (
        deployment_id,
        organization_version,
        corporation_id,
        character_id,
        evidence_character_id,
        registered_by_user_id
      ) values (1, 1, 98000001, ${characterId}, ${characterId}, ${userId})
    `

    await expect(
      connection`
        insert into organization_corporation_sources (
          deployment_id,
          organization_version,
          corporation_id,
          character_id,
          evidence_character_id,
          registered_by_user_id
        ) values (1, 1, 98000001, ${characterId}, ${characterId}, ${userId})
      `,
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
    corporationId: 98_000_001,
    characterId,
  })
  const [identity] = await connection<
    { subject_lifecycle_id: string; authorization_generation: number }[]
  >`
    select lifecycle.subject_lifecycle_id, token.token_version as authorization_generation
    from platform_subject_lifecycles lifecycle
    join eve_tokens token on token.character_id = ${characterId}
    where lifecycle.corporation_source_id = ${registration.source.sourceId}
  `
  if (!identity) throw new Error('Corporation source lifecycle is missing')
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
    targetUserId: userId,
    role: 'director',
    reason: 'Independent reviewer grant.',
  })
  const reviewerBundle = await createOrganizationPermissionBundle({
    actorUserId: userId,
    name: 'Reviewer command permissions',
    reason: 'Create reviewer command permissions.',
    permissions: [
      memberAuditPermission('member-audit.groups.manage'),
      memberAuditPermission('member-audit.members.block'),
    ],
  })
  const reviewerGroup = await createOrganizationGroup({
    actorUserId: userId,
    name: 'Reviewer command grants',
    restricted: true,
    managementMode: 'manual',
    complianceSource: null,
    bundleIds: [reviewerBundle.bundleId],
  })
  const reviewerAssignment = await assignOrganizationGroup({
    actorUserId: userId,
    targetUserId: userId,
    groupId: reviewerGroup.groupId,
    reason: 'Grant reviewer command permissions.',
    expiresAt: null,
  })
  const ordinaryBundle = await createOrganizationPermissionBundle({
    actorUserId: userId,
    name: 'Reviewer command ordinary access',
    reason: 'Create reviewer command ordinary access.',
    permissions: [{ type: 'service', key: 'discord.reviewer-command' }],
  })
  const ordinaryGroup = await createOrganizationGroup({
    actorUserId: userId,
    name: 'Reviewer command ordinary group',
    restricted: false,
    managementMode: 'manual',
    complianceSource: null,
    bundleIds: [ordinaryBundle.bundleId],
  })
  const targetUserId = randomUUID()
  await establishCompliantAccount(targetUserId, 90_000_020)
  return {
    targetUserId,
    targetManagedMemberLifecycleId: await loadActiveManagedMemberLifecycleId(targetUserId),
    reviewerRoleGrantId: reviewerRoleGrant.grantId,
    reviewerBundleId: reviewerBundle.bundleId,
    reviewerGroupId: reviewerGroup.groupId,
    reviewerAssignmentId: reviewerAssignment.assignmentId,
    ordinaryBundleId: ordinaryBundle.bundleId,
    ordinaryGroupId: ordinaryGroup.groupId,
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
    organizationDeploymentId: 1 as const,
    publisherPackage: '@eve-space/member-audit-manifest',
    moduleId: 'member-audit',
    organizationVersion: 1,
    actorUserId: userId,
    targetUserId: fixture.targetUserId,
    managedMemberLifecycleId: fixture.targetManagedMemberLifecycleId,
    requiredPermission,
    reason: '',
  }
}

function organizationActivityPermission() {
  return {
    type: 'module' as const,
    publisherPackage: '@eve-space/organization-activity-manifest',
    moduleId: 'organization-activity',
    key: 'organization-activity.view',
  }
}

function memberAuditPermission(key: 'member-audit.groups.manage' | 'member-audit.members.block') {
  return {
    type: 'module' as const,
    publisherPackage: '@eve-space/member-audit-manifest',
    moduleId: 'member-audit',
    key,
  }
}

async function loadActiveManagedMemberLifecycleId(targetUserId: string) {
  const [lifecycle] = await connection<{ managed_member_lifecycle_id: string }[]>`
    select managed_member_lifecycle_id
    from organization_managed_member_lifecycles
    where deployment_id = 1 and organization_version = 1 and user_id = ${targetUserId}
      and ended_at is null
  `
  if (!lifecycle) throw new Error('Active managed-member lifecycle is missing')
  return lifecycle.managed_member_lifecycle_id
}

async function seedCharacter(seedUserId: string, seedCharacterId: number) {
  await connection`insert into users (id) values (${seedUserId})`
  await connection`
    insert into characters (
      character_id,
      user_id,
      name,
      corporation_id,
      affiliation_checked_at,
      next_affiliation_check,
      affiliation_resolution_state,
      is_main
    ) values (
      ${seedCharacterId},
      ${seedUserId},
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

function ownerClaimInput(
  override: Partial<Parameters<typeof claimOrganizationOwnership>[0]> & {
    affiliationCheckedAt: Date
  },
) {
  return {
    userId,
    characterId,
    subjectLifecycleId,
    organizationId: 98_000_001,
    organizationVersion: 1,
    authorityCorporationId: 98_000_001,
    observedCorporationId: 98_000_001,
    observedAllianceId: null,
    requiredScope: 'esi-characters.read_corporation_roles.v1',
    ...override,
  }
}

async function loadAffiliationCheckedAt(targetCharacterId = characterId) {
  const [character] = await connection<{ affiliation_checked_at: Date }[]>`
    select affiliation_checked_at from characters where character_id = ${targetCharacterId}
  `
  if (!character) throw new Error('Seeded character is missing')
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
