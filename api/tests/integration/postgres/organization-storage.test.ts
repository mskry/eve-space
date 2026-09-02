import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'

const ownerEvidenceMocks = vi.hoisted(() => ({
  getCharacterAffiliationObservation: vi.fn(),
  getCharacterCorporationRoles: vi.fn(),
  persistAffiliationObservations: vi.fn(),
}))

vi.mock('../../../src/characters/affiliation-sync.js', () => ({
  getCharacterAffiliationObservation: ownerEvidenceMocks.getCharacterAffiliationObservation,
  persistAffiliationObservations: ownerEvidenceMocks.persistAffiliationObservations,
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
let hasCurrentOrganizationManagerAuthority: typeof import('../../../src/organization/group-store.js').hasCurrentOrganizationManagerAuthority
let convergeRegistrationComplianceGroupAssignment: typeof import('../../../src/organization/group-store.js').convergeRegistrationComplianceGroupAssignment
let createOrganizationGroup: typeof import('../../../src/organization/group-store.js').createOrganizationGroup
let createOrganizationPermissionBundle: typeof import('../../../src/organization/group-store.js').createOrganizationPermissionBundle
let getOrganizationGroupPermissions: typeof import('../../../src/organization/group-store.js').getOrganizationGroupPermissions
let revokeOrganizationGroupAssignment: typeof import('../../../src/organization/group-store.js').revokeOrganizationGroupAssignment
let blockOrganizationMember: typeof import('../../../src/organization/block-store.js').blockOrganizationMember
let hasCurrentOrganizationMemberBlock: typeof import('../../../src/organization/block-store.js').hasCurrentOrganizationMemberBlock
let unblockOrganizationMember: typeof import('../../../src/organization/block-store.js').unblockOrganizationMember
let grantOrganizationRole: typeof import('../../../src/organization/role-store.js').grantOrganizationRole
let getOrganizationAccessContext: typeof import('../../../src/organization/role-store.js').getOrganizationAccessContext
let listCurrentOrganizationRoles: typeof import('../../../src/organization/role-store.js').listCurrentOrganizationRoles
let revokeOrganizationRole: typeof import('../../../src/organization/role-store.js').revokeOrganizationRole
let registerOrganizationCorporationSource: typeof import('../../../src/organization/corporation-sources.js').registerOrganizationCorporationSource
let deleteCharacter: typeof import('../../../src/auth/store.js').deleteCharacter
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
let dbClient: typeof import('../../../src/db/client.js')
const databasePassword = randomUUID()
const adminId = randomUUID()
const userId = randomUUID()
const characterId = 1_404_328_063

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
    convergeRegistrationComplianceGroupAssignment,
    createOrganizationGroup,
    createOrganizationPermissionBundle,
    getOrganizationGroupPermissions,
    hasCurrentOrganizationManagerAuthority,
    revokeOrganizationGroupAssignment,
  } = await import('../../../src/organization/group-store.js'))
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
  ;({ deleteCharacter } = await import('../../../src/auth/store.js'))
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
  dbClient = await import('../../../src/db/client.js')
})

beforeEach(async () => {
  await connection.unsafe(
    'truncate organization_epochs, deployment_admins, users, domain_events restart identity cascade',
  )
  await seedDeployment()
  ownerEvidenceMocks.getCharacterAffiliationObservation.mockResolvedValue({
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
  test('blocks active source deletion but detaches historical source evidence safely', async () => {
    const sourceId = randomUUID()
    await connection`
      insert into organization_corporation_sources (
        source_id, deployment_id, organization_version, corporation_id,
        character_id, evidence_character_id, registered_by_user_id
      ) values (${sourceId}, 1, 1, 98000001, ${characterId}, ${characterId}, ${userId})
    `
    const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
      insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
      values ('character', ${String(characterId)}, ${characterId})
      returning subject_lifecycle_id
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
    await seedCharacter(secondUserId, secondCharacterId)

    const results = await Promise.allSettled([
      claimOrganizationOwnership(
        ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
      ),
      claimOrganizationOwnership(
        ownerClaimInput({
          userId: secondUserId,
          characterId: secondCharacterId,
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
    ownerEvidenceMocks.getCharacterAffiliationObservation.mockResolvedValue({
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

    ownerEvidenceMocks.getCharacterAffiliationObservation.mockResolvedValue({
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

    ownerEvidenceMocks.getCharacterAffiliationObservation.mockResolvedValue({
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
    await seedCharacter(replacementUserId, replacementCharacterId)
    await expect(getOrganizationAccessContext(replacementUserId)).resolves.toMatchObject({
      claimAvailable: true,
    })

    const replacement = await claimOrganizationOwnership(
      ownerClaimInput({
        userId: replacementUserId,
        characterId: replacementCharacterId,
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
    await seedCharacter(claimantUserId, claimantCharacterId)

    await expect(getOrganizationAccessContext(claimantUserId)).resolves.toMatchObject({
      claimAvailable: false,
    })
    await expect(
      claimOrganizationOwnership(
        ownerClaimInput({
          userId: claimantUserId,
          characterId: claimantCharacterId,
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
    await seedCharacter(claimantUserId, claimantCharacterId)

    await expect(
      claimOrganizationOwnership(
        ownerClaimInput({
          userId: claimantUserId,
          characterId: claimantCharacterId,
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
    await seedCharacter(claimantUserId, claimantCharacterId)
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

  test('grants and revokes delegated roles with immutable current-version audit entries', async () => {
    await claimOrganizationOwnership(
      ownerClaimInput({ affiliationCheckedAt: await loadAffiliationCheckedAt() }),
    )
    const targetUserId = randomUUID()
    await connection`insert into users (id) values (${targetUserId})`

    const grant = await grantOrganizationRole({
      actorUserId: userId,
      targetUserId,
      role: 'director',
      reason: 'Delegated operational leadership.',
    })
    const context = await getOrganizationAccessContext(userId)
    const activeRoles = await listCurrentOrganizationRoles()
    const revoked = await revokeOrganizationRole({
      actorUserId: userId,
      grantId: grant.grantId,
      reason: 'Delegation ended.',
    })
    const audits = await connection<
      { event_type: string; actor_id: string; reason: string; outcome: string }[]
    >`
      select event_type, actor_id, reason, outcome
      from organization_audit_events
      where subject_id = ${grant.grantId}
      order by audit_sequence
    `

    expect(revoked).toMatchObject({
      grantId: grant.grantId,
      role: 'director',
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
        role: 'director',
        mainCharacterId: null,
        mainCharacterName: null,
      }),
    ])
    await expect(listCurrentOrganizationRoles()).resolves.toEqual({ grants: [] })
    expect(audits).toEqual([
      {
        event_type: 'role.granted',
        actor_id: userId,
        reason: 'Delegated operational leadership.',
        outcome: 'granted',
      },
      {
        event_type: 'role.revoked',
        actor_id: userId,
        reason: 'Delegation ended.',
        outcome: 'revoked',
      },
    ])
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
      permissions: [
        { type: 'module', key: 'organization-activity.manage' },
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
      modules: ['organization-activity.manage'],
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
      modules: ['organization-activity.manage'],
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
        permissions: [{ type: 'service', key: 'discord.leadership' }],
      }),
    ).rejects.toMatchObject({ code: 'owner-authority-required' })
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Restricted services',
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
      permissions: [
        { type: 'module', key: 'organization-activity.manage' },
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
      modules: ['organization-activity.manage'],
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
      modules: ['organization-activity.manage'],
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
    const userIds = [randomUUID(), randomUUID()].toSorted()
    const firstUserId = userIds[0]!
    const secondUserId = userIds[1]!
    await establishCompliantAccount(firstUserId, 90_000_001)
    await establishCompliantAccount(secondUserId, 90_000_002)
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: userId,
      name: 'Bulk lock order bundle',
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
      permissions: [{ type: 'module', key: 'organization-activity.member' }],
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

async function seedDeployment() {
  await connection`
    insert into deployment_admins (id, email, password_hash)
    values (${adminId}, 'owner@example.com', 'test-password-hash')
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
      owner_admin_id,
      organization_type,
      organization_id,
      organization_name,
      organization_ticker,
      organization_version
    ) values (1, ${adminId}, 'corporation', 98000001, 'First Corporation', 'ONE', 1)
  `
  await connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at
    ) values (1, 1, 98000001, now(), now())
  `
  await seedCharacter(userId, characterId)
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
}

function ownerClaimInput(
  override: Partial<Parameters<typeof claimOrganizationOwnership>[0]> & {
    affiliationCheckedAt: Date
  },
) {
  return {
    userId,
    characterId,
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
