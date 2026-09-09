import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { runStartupMigrations } from '../../../src/db/startup-migrations.js'

let container: StartedTestContainer
let connection: postgres.Sql
let databaseClient: typeof import('../../../src/db/client.js')
let seedLocalOrganizationFixture: typeof import('../../../src/commands/local-organization-fixture.js').seedLocalOrganizationFixture

beforeAll(async () => {
  const password = randomUUID()
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space_fixture',
      POSTGRES_USER: 'eve_space',
      POSTGRES_PASSWORD: password,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
  const databaseUrl = `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space_fixture`
  connection = postgres(databaseUrl, { onnotice: () => {} })
  Object.assign(process.env, {
    NODE_ENV: 'development',
    DATABASE_URL: databaseUrl,
    EVE_CLIENT_ID: 'fixture-client',
    EVE_CLIENT_SECRET: 'fixture-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })
  await runStartupMigrations(connection)
  ;({ seedLocalOrganizationFixture } =
    await import('../../../src/commands/local-organization-fixture.js'))
  databaseClient = await import('../../../src/db/client.js')
})

afterAll(async () => {
  await databaseClient?.sql.end()
  await connection?.end()
  await container?.stop()
})

test('seeds one guarded production-shaped organization fixture', async () => {
  let applicationSessionToken: string | undefined
  const summary = await seedLocalOrganizationFixture({
    deliverSession: async (sessionToken) => {
      applicationSessionToken = sessionToken
    },
  })

  expect(summary).toMatchObject({
    organizationVersion: 1,
    corporationId: 98_000_001,
    directorCharacterId: 90_000_001,
    unregisteredCharacterId: 90_000_002,
    userId: expect.any(String),
    seededResourceCount: 8,
  })
  expect(applicationSessionToken).toEqual(expect.any(String))
  await expect(
    seedLocalOrganizationFixture({ deliverSession: async () => undefined }),
  ).rejects.toThrow('empty disposable database')

  const { ssoRoutes } = await import('../../../src/auth/routes.js')
  const signIn = await ssoRoutes.request('/local-fixture-session', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sessionToken: applicationSessionToken! }),
  })
  expect(signIn.status).toBe(303)
  expect(signIn.headers.get('set-cookie')).toContain('eve_space_session=')
  expect(signIn.headers.get('set-cookie')).toContain('HttpOnly')

  const [advisoryLocks] = await connection<{ count: number }[]>`
    select count(*)::integer as count from pg_locks where locktype = 'advisory'
  `
  expect(advisoryLocks?.count).toBe(0)

  const [stored] = await connection<
    {
      organizationType: string
      organizationId: string
      characterCount: number
      encryptedTokens: string
      scopes: string[]
      ownerEvidence: string
      directorRolePresent: boolean
      roles: string[]
      complianceState: string
      authoritative: boolean
      assignmentSource: string
      modulePermission: string
      sourceCount: number
      rosterCount: number
      checkpointCount: number
      snapshotCount: number
    }[]
  >`
    select
      settings.organization_type as "organizationType",
      settings.organization_id as "organizationId",
      (select count(*)::integer from characters) as "characterCount",
      tokens.encrypted_tokens as "encryptedTokens",
      tokens.scopes,
      evidence.status as "ownerEvidence",
      evidence.director_role_present as "directorRolePresent",
      (select array_agg(role order by role) from organization_role_grants
        where revoked_at is null) as roles,
      compliance.state as "complianceState",
      compliance.authoritative,
      assignment.assignment_source as "assignmentSource",
      permission.permission_key as "modulePermission",
      (select count(*)::integer from organization_corporation_sources
        where revoked_at is null) as "sourceCount",
      (select count(*)::integer from organization_corporation_roster_observations) as "rosterCount",
      (select count(*)::integer from eve_module_organization_activity.collection_checkpoints)
        as "checkpointCount",
      (select count(*)::integer from eve_module_organization_activity.activity_snapshots)
        as "snapshotCount"
    from deployment_settings settings
    join characters character on character.character_id = 90000001
    join eve_tokens tokens on tokens.character_id = character.character_id
    join organization_role_grants owner on owner.user_id = character.user_id
      and owner.role = 'organization_owner' and owner.revoked_at is null
    join organization_authority_evidence evidence on evidence.grant_id = owner.grant_id
    join organization_account_compliance compliance on compliance.user_id = character.user_id
      and compliance.organization_version = settings.organization_version
    join organization_group_assignments assignment on assignment.user_id = character.user_id
      and assignment.revoked_at is null
    join organization_groups organization_group on organization_group.group_id = assignment.group_id
    join organization_group_permission_bundles group_bundle
      on group_bundle.group_id = organization_group.group_id
    join organization_permission_bundle_entries permission
      on permission.bundle_id = group_bundle.bundle_id
    where settings.id = 1
  `
  expect(stored).toMatchObject({
    organizationType: 'corporation',
    organizationId: '98000001',
    characterCount: 1,
    encryptedTokens: expect.stringMatching(/^[^.]+\.[^.]+\.[^.]+$/),
    scopes: expect.arrayContaining([
      'esi-characters.read_corporation_roles.v1',
      'esi-corporations.read_corporation_membership.v1',
      'esi-corporations.read_projects.v1',
    ]),
    ownerEvidence: 'fresh',
    directorRolePresent: true,
    roles: ['director', 'hr_auditor', 'organization_owner'],
    complianceState: 'compliant',
    authoritative: true,
    assignmentSource: 'compliance',
    modulePermission: 'organization-activity.view',
    sourceCount: 1,
    rosterCount: 2,
    checkpointCount: 7,
    snapshotCount: 8,
  })

  const { getOrganizationAccessContext } = await import('../../../src/organization/role-store.js')
  const { getOrganizationGroupPermissions } =
    await import('../../../src/organization/group-permissions.js')
  const { loadOrganizationSessionContext } =
    await import('../../../src/middleware/organization-session.js')
  const { authorizeOrganizationContribution } =
    await import('../../../src/organization/module-authorization.js')
  const { listOrganizationRosterCoverage } =
    await import('../../../src/organization/roster-coverage.js')
  const { aggregateOrganizationActivities } = await import('../../../src/organization/activity.js')

  const session = await loadOrganizationSessionContext(summary.userId)
  expect(session).toMatchObject({ state: 'compliant', blocked: false })
  await expect(getOrganizationGroupPermissions(summary.userId)).resolves.toMatchObject({
    modules: ['organization-activity.view'],
  })
  for (const audience of ['member', 'hr', 'director'] as const)
    await expect(
      authorizeOrganizationContribution(summary.userId, session, {
        audience,
        requiredPermission: 'organization-activity.view',
      }),
    ).resolves.toMatchObject({ authorized: true })
  await expect(listOrganizationRosterCoverage()).resolves.toMatchObject({
    corporations: [
      {
        corporationId: 98_000_001,
        status: 'current',
        unregisteredCharacters: [{ characterId: 90_000_002 }],
      },
    ],
  })
  await expect(aggregateOrganizationActivities(summary.userId, session)).resolves.toMatchObject({
    activities: expect.arrayContaining([
      expect.objectContaining({
        id: 'organization-activity:organization-activity:11111111-1111-4111-8111-111111111111',
      }),
      expect.objectContaining({
        id: 'organization-activity:organization-activity:22222222-2222-4222-8222-222222222222',
      }),
      expect.objectContaining({
        id: 'organization-activity:organization-activity:33333333-3333-4333-8333-333333333333',
      }),
    ]),
  })

  const [deploymentAdmin] = await connection<{ id: string }[]>`select id from deployment_admins`
  const [deploymentAdminRoles] = await connection<{ count: number }[]>`
    select count(*)::integer as count
    from organization_role_grants
    where user_id = ${deploymentAdmin!.id}
  `
  expect(deploymentAdminRoles?.count).toBe(0)
  await expect(getOrganizationAccessContext(deploymentAdmin!.id)).resolves.toMatchObject({
    isOrganizationOwner: false,
    capabilities: { reviewRegistration: false, viewRosterCoverage: false },
  })
})
