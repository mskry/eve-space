import { randomUUID } from 'node:crypto'
import { EsiHttpError } from '@evespace/esi-client'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'

const mocks = vi.hoisted(() => ({
  observeAndPersistCharacterAffiliation: vi.fn(),
  readCharacterCorporationRoles: vi.fn(),
}))

vi.mock('../../../src/characters/affiliation-sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/characters/affiliation-sync.js')>()),
  observeAndPersistCharacterAffiliation: mocks.observeAndPersistCharacterAffiliation,
}))
vi.mock('../../../src/characters/corporation-roles.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/characters/corporation-roles.js')>()),
  readCharacterCorporationRoles: mocks.readCharacterCorporationRoles,
}))

type Modules = {
  readonly canonical: typeof import('../../../src/characters/corporation-role-canonical.js')
  readonly evidence: typeof import('../../../src/characters/corporation-role-evidence.js')
  readonly invalidation: typeof import('../../../src/characters/corporation-role-invalidation.js')
  readonly observation: typeof import('../../../src/characters/corporation-role-observation.js')
  readonly convergence: typeof import('../../../src/organization/corporation-role-convergence.js')
  readonly authorityConvergence: typeof import('../../../src/organization/authority-convergence.js')
  readonly demand: typeof import('../../../src/organization/corporation-role-demand.js')
  readonly refresh: typeof import('../../../src/organization/corporation-role-refresh.js')
  readonly diagnostics: typeof import('../../../src/organization/corporation-role-diagnostics.js')
  readonly effectiveAuthority: typeof import('../../../src/organization/effective-authority.js')
  readonly ownerClaim: typeof import('../../../src/organization/owner-claim.js')
  readonly sources: typeof import('../../../src/organization/corporation-sources.js')
  readonly roleStore: typeof import('../../../src/organization/role-store.js')
  readonly blocks: typeof import('../../../src/organization/block-store.js')
  readonly admin: typeof import('../../../src/admin/store.js')
  readonly handlers: typeof import('../../../src/domain-events/handlers.js')
  readonly domainEvents: typeof import('../../../src/domain-events/store.js')
  readonly outbox: typeof import('../../../src/queue/outbox-relay.js')
  readonly planner: typeof import('../../../src/queue/corporation-role-planner.js')
  readonly jobs: typeof import('../../../src/queue/job-handlers.js')
  readonly producer: typeof import('../../../src/queue/producer.js')
  readonly db: typeof import('../../../src/db/client.js')
}

let container: StartedTestContainer
let connection: postgres.Sql
let databaseUrl: string
let modules: Modules
const databasePassword = randomUUID()
const adminId = randomUUID()
const userId = randomUUID()
const characterId = 1_404_328_063
const secondCharacterId = 1_404_328_064
const corporationId = 98_000_001
const rolesScope = 'esi-characters.read_corporation_roles.v1'
const membershipScope = 'esi-corporations.read_corporation_membership.v1'
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
  databaseUrl = `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  connection = postgres(databaseUrl, { onnotice: () => {} })
  await waitForDatabase()
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })
  await runMigrations(connection)
  modules = {
    admin: await import('../../../src/admin/store.js'),
    authorityConvergence: await import('../../../src/organization/authority-convergence.js'),
    blocks: await import('../../../src/organization/block-store.js'),
    canonical: await import('../../../src/characters/corporation-role-canonical.js'),
    convergence: await import('../../../src/organization/corporation-role-convergence.js'),
    db: await import('../../../src/db/client.js'),
    demand: await import('../../../src/organization/corporation-role-demand.js'),
    diagnostics: await import('../../../src/organization/corporation-role-diagnostics.js'),
    domainEvents: await import('../../../src/domain-events/store.js'),
    effectiveAuthority: await import('../../../src/organization/effective-authority.js'),
    evidence: await import('../../../src/characters/corporation-role-evidence.js'),
    handlers: await import('../../../src/domain-events/handlers.js'),
    invalidation: await import('../../../src/characters/corporation-role-invalidation.js'),
    jobs: await import('../../../src/queue/job-handlers.js'),
    observation: await import('../../../src/characters/corporation-role-observation.js'),
    outbox: await import('../../../src/queue/outbox-relay.js'),
    ownerClaim: await import('../../../src/organization/owner-claim.js'),
    planner: await import('../../../src/queue/corporation-role-planner.js'),
    producer: await import('../../../src/queue/producer.js'),
    refresh: await import('../../../src/organization/corporation-role-refresh.js'),
    roleStore: await import('../../../src/organization/role-store.js'),
    sources: await import('../../../src/organization/corporation-sources.js'),
  }
})

beforeEach(async () => {
  await connection.unsafe(
    'truncate organization_epochs, deployment_admins, users, domain_events restart identity cascade',
  )
  await seedDeployment()
  subjectLifecycleId = await seedCharacter(userId, characterId, true)
  mocks.observeAndPersistCharacterAffiliation.mockReset()
  mocks.readCharacterCorporationRoles.mockReset()
  mocks.observeAndPersistCharacterAffiliation.mockImplementation(async (targetCharacterId) => ({
    affiliationCheckedAt: new Date(),
    affiliationFreshUntil: new Date(Date.now() + 60 * 60 * 1000),
    allianceId: null,
    characterId: targetCharacterId,
    corporationId: await currentCorporation(targetCharacterId),
    stale: false,
  }))
  mocks.readCharacterCorporationRoles.mockImplementation(async ({ characterId: target }) =>
    roleRead(['Director'], { authorizationGeneration: await currentGeneration(target) }),
  )
})

afterAll(async () => {
  await modules?.db.sql.end()
  await connection?.end()
  await container?.stop()
})

describe('corporation-role evidence schema', () => {
  test('rotates the affiliation period only for corporation or alliance changes', async () => {
    const before = await currentPeriod(characterId)
    await connection`
      update characters set affiliation_checked_at = now(), name = 'Renamed Pilot'
      where character_id = ${characterId}
    `
    expect(await currentPeriod(characterId)).toBe(before)

    await observeThroughDemand()
    await connection`update characters set alliance_id = 99000001 where character_id = ${characterId}`
    const rotated = await currentPeriod(characterId)
    expect(rotated).not.toBe(before)
    await expect(loadObservationRows()).resolves.toStrictEqual([
      expect.objectContaining({
        affiliation_period_revision: before,
        content_rows: 0,
        invalidation_outcome: 'affiliation-changed',
        status: 'invalid',
      }),
    ])

    await connection`
      update characters set affiliation_period_revision = gen_random_uuid()
      where character_id = ${characterId}
    `
    expect(await currentPeriod(characterId)).toBe(rotated)
  })

  test('keeps one current observation per character and organization version', async () => {
    await observeThroughDemand()
    await expect(
      connection.begin(async (transaction) => {
        await transaction`
          insert into character_corporation_role_observations (
            organization_version, user_id, character_id, source_subject_lifecycle_id,
            affiliation_period_revision, authority_corporation_id, authorization_generation,
            required_scope, status, next_refresh_at, failure_class, last_checked_at,
            last_applied_observation_sequence
          ) values (
            1, ${userId}, ${characterId}, ${subjectLifecycleId}, gen_random_uuid(),
            ${corporationId}, 0, ${rolesScope}, 'pending', now(), 'transient:esi-unavailable',
            now(), 99
          )
        `
      }),
    ).rejects.toMatchObject({ code: '23505' })
  })

  test('allocates a database-monotonic sequence independently from role revisions', async () => {
    const first = await modules.invalidation.allocateCorporationRoleObservationSequence()
    const second = await modules.invalidation.allocateCorporationRoleObservationSequence()
    expect(second).toBeGreaterThan(first)
    await observeThroughDemand()
    const [row] = await loadObservationRows()
    expect(BigInt(row!.last_applied_observation_sequence)).toBeGreaterThan(second)
  })

  test.each([
    ['fresh evidence without a revision', `'fresh', null, now(), now() + interval '1 hour'`],
    [
      'degraded evidence without a degraded deadline',
      `'degraded', gen_random_uuid(), now(), now() + interval '1 hour'`,
    ],
    [
      'invalid evidence with a refresh time',
      `'invalid', gen_random_uuid(), now(), now() + interval '1 hour'`,
    ],
  ])('rejects incoherent observation state: %s', async (_name, values) => {
    await expect(
      connection.unsafe(`
        insert into character_corporation_role_observations (
          organization_version, user_id, character_id, source_subject_lifecycle_id,
          affiliation_period_revision, authority_corporation_id, authorization_generation,
          required_scope, status, role_revision, validated_at, next_refresh_at,
          esi_fresh_until, fresh_until, last_checked_at, last_applied_observation_sequence
        ) values (
          1, '${userId}', ${characterId}, '${subjectLifecycleId}', gen_random_uuid(),
          ${corporationId}, 0, '${rolesScope}', ${values}, now() + interval '1 hour',
          now() + interval '1 hour', now(), 1
        )
      `),
    ).rejects.toMatchObject({ code: '23514' })
  })

  test('requires canonical private content exactly for current observations', async () => {
    await observeThroughDemand()
    const [row] = await loadObservationRows()
    await expect(
      connection`
        update character_corporation_role_contents
        set roles = '{Director,Accountant}'
        where observation_id = ${row!.observation_id}
      `,
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      connection`
        update character_corporation_role_observations
        set status = 'invalid', failure_class = 'strict:detached', invalidated_at = now(),
          invalidation_outcome = 'detached', next_refresh_at = null
        where observation_id = ${row!.observation_id}
      `,
    ).rejects.toMatchObject({ code: '23514' })

    await modules.db.db.transaction((transaction) =>
      modules.invalidation.invalidateCharacterCorporationRoleObservationsInTransaction(
        transaction,
        {
          characterId,
          outcome: 'detached',
        },
      ),
    )
    await expect(loadObservationRows()).resolves.toStrictEqual([
      expect.objectContaining({
        content_rows: 0,
        invalidation_outcome: 'detached',
        status: 'invalid',
      }),
    ])
  })

  test('binds observations to the character account and current lifecycle', async () => {
    await expect(
      connection`
        insert into character_corporation_role_observations (
          organization_version, user_id, character_id, source_subject_lifecycle_id,
          affiliation_period_revision, authority_corporation_id, authorization_generation,
          required_scope, status, next_refresh_at, failure_class, last_checked_at,
          last_applied_observation_sequence
        ) values (
          1, ${userId}, ${characterId}, ${randomUUID()}, gen_random_uuid(), ${corporationId}, 0,
          ${rolesScope}, 'pending', now(), 'transient:esi-unavailable', now(), 1
        )
      `,
    ).rejects.toMatchObject({ code: '23514' })
  })

  test('orders due demand with missing evidence first and then by persisted due time', async () => {
    await seedCharacter(userId, secondCharacterId, false)
    await observeThroughDemand(characterId)
    await connection`
      update character_corporation_role_observations
      set next_refresh_at = now() - interval '1 minute'
      where character_id = ${characterId}
    `
    const due = await modules.demand.selectDueCorporationRoleDemand({
      dueBefore: new Date(),
      limit: 10,
    })
    expect(due.map(({ characterId: dueCharacterId }) => dueCharacterId)).toStrictEqual([
      secondCharacterId,
      characterId,
    ])
    await expect(
      modules.demand.selectDueCorporationRoleDemand({ dueBefore: new Date(), limit: 1 }),
    ).resolves.toHaveLength(1)
  })

  test('forbids creating, extending, or copying legacy continuity and clears it on binding change', async () => {
    const grantId = await claimOwner()
    await expect(
      connection`
        update organization_authority_evidence
        set legacy_role_continuity_until = now() + interval '1 hour'
        where grant_id = ${grantId}
      `,
    ).rejects.toMatchObject({ code: '23514' })

    await seedLegacyContinuity(grantId, "now() + interval '30 minutes'")
    await expect(
      connection`
        update organization_authority_evidence
        set legacy_role_continuity_until = legacy_role_continuity_until + interval '1 minute'
        where grant_id = ${grantId}
      `,
    ).rejects.toMatchObject({ code: '23514' })
    await connection`
      update organization_authority_evidence
      set authorization_generation = authorization_generation + 1
      where grant_id = ${grantId}
    `
    const [cleared] = await connection<{ legacy_role_continuity_until: Date | null }[]>`
      select legacy_role_continuity_until from organization_authority_evidence
      where grant_id = ${grantId}
    `
    expect(cleared?.legacy_role_continuity_until).toBeNull()
  })
})

describe('corporation-role observation persistence', () => {
  test('revalidates unchanged roles without rotating the revision or emitting events', async () => {
    await observeThroughDemand()
    const [first] = await loadObservationRows()
    mocks.readCharacterCorporationRoles.mockResolvedValueOnce(
      roleRead(['Director'], { validatedAt: new Date(Date.now() + 1000) }),
    )

    await observeThroughDemand()
    const [second] = await loadObservationRows()
    expect(second?.role_revision).toBe(first?.role_revision)
    expect(second?.validated_at.getTime()).toBeGreaterThan(first!.validated_at.getTime())
    await expect(loadRoleEvents()).resolves.toStrictEqual([])
  })

  test('treats reordered memberships as the same semantic revision', async () => {
    mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead(['Director', 'Accountant']))
    await observeThroughDemand()
    const [first] = await loadObservationRows()
    mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead(['Accountant', 'Director']))

    await observeThroughDemand()
    const [second] = await loadObservationRows()
    expect(second?.role_revision).toBe(first?.role_revision)
  })

  test.each([
    ['gains', ['Director'], ['Director', 'Accountant'], 'character.corporation-roles-changed'],
    [
      'partial losses',
      ['Director', 'Accountant'],
      ['Director'],
      'character.corporation-role-loss-confirmed',
    ],
    [
      'complete losses',
      ['Director', 'Accountant'],
      [],
      'character.corporation-role-loss-confirmed',
    ],
  ] as const)(
    'records %s atomically with an opaque revision change',
    async (_name, before, after, eventType) => {
      mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead(before))
      await observeThroughDemand()
      const [previous] = await loadObservationRows()
      mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead(after))

      await observeThroughDemand()
      const [current] = await loadObservationRows()
      expect(current?.role_revision).not.toBe(previous?.role_revision)
      const events = await loadRoleEvents()
      expect(events).toStrictEqual([
        {
          event_type: eventType,
          payload: {
            affiliationPeriodRevision: await currentPeriod(characterId),
            authorityCorporationId: corporationId,
            authorizationGeneration: 0,
            characterId,
            currentRoleRevision: current?.role_revision,
            organizationVersion: 1,
            previousRoleRevision: previous?.role_revision,
            subjectLifecycleId,
            userId,
          },
        },
      ])
      expect(JSON.stringify(events.map(({ payload }) => payload))).not.toMatch(
        /Director|Accountant|roles/,
      )
    },
  )

  test('treats a successful empty role set as confirmed loss of every prior role', async () => {
    const grantId = await claimOwner()
    await expect(ownerAuthority()).resolves.toBe(true)
    mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead([]))

    await observeThroughDemand()
    await expect(ownerAuthority()).resolves.toBe(false)
    await expect(loadRoleEvents()).resolves.toStrictEqual([
      expect.objectContaining({ event_type: 'character.corporation-role-loss-confirmed' }),
    ])
    const [owner] = await connection<{ invalidation_outcome: string }[]>`
      select invalidation_outcome from organization_authority_evidence where grant_id = ${grantId}
    `
    expect(owner?.invalidation_outcome).toBe('not-director')
  })

  test('treats stale responses as unavailable evidence without inferring loss', async () => {
    await claimOwner()
    const [before] = await loadObservationRows()
    mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead([], { stale: true }))

    await observeThroughDemand()
    const [after] = await loadObservationRows()
    expect(after).toMatchObject({
      failure_class: 'transient:stale-role-evidence',
      role_revision: before?.role_revision,
      status: 'fresh',
    })
    expect(after!.next_refresh_at.getTime()).toBeGreaterThanOrEqual(Date.now() + 4.9 * 60 * 1000)
    await expect(ownerAuthority()).resolves.toBe(true)
    await expect(loadRoleEvents()).resolves.toStrictEqual([])
  })

  test('respects provider cooldowns later than the minimum transient retry', async () => {
    await observeThroughDemand()
    const retryAt = new Date(Date.now() + 30 * 60 * 1000)
    mocks.readCharacterCorporationRoles.mockRejectedValueOnce(
      new (await import('../../../src/esi-gateway/failures.js')).EsiQuotaError(1800, 0, retryAt),
    )

    await observeThroughDemand()
    const [row] = await loadObservationRows()
    expect(row?.next_refresh_at).toStrictEqual(retryAt)
  })

  test('cannot rebind a warm response from a replaced corporation period', async () => {
    await observeThroughDemand()
    const binding = await currentBinding()
    const sequence = await modules.invalidation.allocateCorporationRoleObservationSequence()
    await connection`
      update characters set corporation_id = 98000002 where character_id = ${characterId}
    `

    await expect(
      persist({
        affiliationFreshUntil: inOneHour(),
        binding,
        outcome: { kind: 'observed', read: roleRead(['Director']) },
        sequence,
      }),
    ).resolves.toStrictEqual({ status: 'superseded' })
    await expect(loadObservationRows()).resolves.toStrictEqual([
      expect.objectContaining({ invalidation_outcome: 'affiliation-changed', status: 'invalid' }),
    ])
  })

  test('rejects an older changed response after a newer unchanged validation', async () => {
    await observeThroughDemand()
    const binding = await currentBinding()
    const older = await modules.invalidation.allocateCorporationRoleObservationSequence()
    const newer = await modules.invalidation.allocateCorporationRoleObservationSequence()
    const [before] = await loadObservationRows()

    await expect(
      persist({
        ...attempt(binding, newer),
        outcome: { kind: 'observed', read: roleRead(['Director']) },
      }),
    ).resolves.toMatchObject({ status: 'accepted' })
    await expect(
      persist({ ...attempt(binding, older), outcome: { kind: 'observed', read: roleRead([]) } }),
    ).resolves.toStrictEqual({ status: 'superseded' })
    const [after] = await loadObservationRows()
    expect(after?.role_revision).toBe(before?.role_revision)
    await expect(loadRoleEvents()).resolves.toStrictEqual([])
  })

  test('rejects an older transient failure after a newer success', async () => {
    await observeThroughDemand()
    const binding = await currentBinding()
    const older = await modules.invalidation.allocateCorporationRoleObservationSequence()
    const newer = await modules.invalidation.allocateCorporationRoleObservationSequence()
    await persist({
      ...attempt(binding, newer),
      outcome: { kind: 'observed', read: roleRead(['Director']) },
    })
    const [before] = await loadObservationRows()

    await expect(
      persist({
        ...attempt(binding, older),
        outcome: {
          failure: { failureClass: 'esi-unavailable', kind: 'transient', retryAt: null },
          kind: 'failed',
        },
      }),
    ).resolves.toStrictEqual({ status: 'superseded' })
    await expect(loadObservationRows()).resolves.toStrictEqual([before])
  })

  test('rejects an older success after a newer strict invalidation', async () => {
    await claimOwner()
    const binding = await currentBinding()
    const older = await modules.invalidation.allocateCorporationRoleObservationSequence()
    const newer = await modules.invalidation.allocateCorporationRoleObservationSequence()

    await expect(
      persist({
        ...attempt(binding, newer),
        outcome: {
          failure: { failureClass: 'authorization-rejected', kind: 'strict' },
          kind: 'failed',
        },
      }),
    ).resolves.toMatchObject({ status: 'accepted' })
    await expect(
      persist({
        ...attempt(binding, older),
        outcome: { kind: 'observed', read: roleRead(['Director']) },
      }),
    ).resolves.toStrictEqual({ status: 'superseded' })
    await expect(loadObservationRows()).resolves.toStrictEqual([
      expect.objectContaining({
        content_rows: 0,
        invalidation_outcome: 'authorization-rejected',
        status: 'invalid',
      }),
    ])
    await expect(ownerAuthority()).resolves.toBe(false)
  })

  test('rolls back persistence when the attempt is cancelled before commit', async () => {
    const binding = await currentBinding()
    const controller = new AbortController()
    controller.abort()
    const sequence = await modules.invalidation.allocateCorporationRoleObservationSequence()

    await expect(
      modules.db.db.transaction((transaction) =>
        modules.observation.persistCorporationRoleAttemptInTransaction(
          transaction,
          {
            ...attempt(binding, sequence),
            outcome: { kind: 'observed', read: roleRead(['Director']) },
          },
          { authority: demandAuthority(null), signal: controller.signal },
        ),
      ),
    ).rejects.toBe(controller.signal.reason)
    await expect(loadObservationRows()).resolves.toStrictEqual([])
  })

  test('degrades after the fresh deadline to a fixed deadline and then expires by clock', async () => {
    await connection`update deployment_settings set stale_evidence_grace_duration_seconds = 3600`
    await claimOwner()
    await expireObservation()
    mocks.observeAndPersistCharacterAffiliation.mockResolvedValue(null)

    await expect(refreshCurrentDemand()).resolves.toBe('degraded')
    const [first] = await loadObservationRows()
    expect(first).toMatchObject({
      failure_class: 'transient:affiliation-unavailable',
      status: 'degraded',
    })
    await makeDue()
    await expect(refreshCurrentDemand()).resolves.toBe('degraded')
    const [second] = await loadObservationRows()
    expect(second?.degraded_until).toStrictEqual(first?.degraded_until)
    await expect(ownerAuthority('read-continuity')).resolves.toBe(true)
    await expect(ownerAuthority('mutate')).resolves.toBe(false)

    await connection`
      update character_corporation_role_observations
      set degraded_until = now() - interval '1 second', fresh_until = now() - interval '2 seconds'
      where character_id = ${characterId}
    `
    await connection`
      update organization_authority_evidence
      set grace_until = now() - interval '1 second', fresh_until = now() - interval '2 seconds',
        observed_at = now() - interval '3 hours', last_checked_at = now() - interval '3 hours'
      where character_id = ${characterId}
    `
    await expect(ownerAuthority('read-continuity')).resolves.toBe(false)
    await makeDue()
    await expect(refreshCurrentDemand()).resolves.toBe('invalidated')
    await expect(loadObservationRows()).resolves.toStrictEqual([
      expect.objectContaining({ content_rows: 0, invalidation_outcome: 'expired' }),
    ])
  })

  test('does not extend an earlier authority deadline when role evidence degrades', async () => {
    await connection`update deployment_settings set stale_evidence_grace_duration_seconds = 3600`
    await connection`
      update eve_tokens set scopes = ${connection.json([rolesScope, membershipScope])}
      where character_id = ${characterId}
    `
    await claimOwner()
    await modules.sources.registerOrganizationCorporationSource({
      actorUserId: userId,
      characterId,
      corporationId,
    })
    await expireObservation()
    await connection`
      update organization_authority_evidence
      set fresh_until = now() - interval '2 hours'
      where character_id = ${characterId}
    `
    await connection`
      update organization_derived_authority_sources
      set fresh_until = now() - interval '30 minutes'
      where character_id = ${characterId}
    `
    await connection`
      update organization_corporation_sources
      set observed_at = now() - interval '3 hours', fresh_until = now() - interval '2 hours'
      where evidence_character_id = ${characterId}
    `
    mocks.observeAndPersistCharacterAffiliation.mockResolvedValue(null)

    await expect(refreshCurrentDemand()).resolves.toBe('degraded')
    const [owner] = await connection<{ status: string; grace_until: Date | null }[]>`
      select status, grace_until from organization_authority_evidence
      where character_id = ${characterId}
    `
    const [derived] = await connection<{ status: string; fresh_until: Date; grace_until: Date }[]>`
      select status, fresh_until, grace_until from organization_derived_authority_sources
      where character_id = ${characterId} and invalidated_at is null
    `
    const [corporation] = await connection<{ status: string; grace_until: Date | null }[]>`
      select status, grace_until from organization_corporation_sources
      where evidence_character_id = ${characterId} and revoked_at is null
    `
    const [observation] = await loadObservationRows()
    expect(owner).toStrictEqual({ grace_until: null, status: 'fresh' })
    expect(corporation).toStrictEqual({ grace_until: null, status: 'fresh' })
    expect(derived?.status).toBe('degraded')
    expect(derived?.grace_until).toStrictEqual(
      new Date(derived!.fresh_until.getTime() + 60 * 60_000),
    )
    expect(derived!.grace_until.getTime()).toBeLessThan(observation!.degraded_until!.getTime())
    await makeDue()
    await expect(refreshCurrentDemand()).resolves.toBe('degraded')
    const [rechecked] = await connection<{ grace_until: Date }[]>`
      select grace_until from organization_derived_authority_sources
      where character_id = ${characterId} and invalidated_at is null
    `
    expect(rechecked?.grace_until).toStrictEqual(derived?.grace_until)
    await expect(effectiveAuthority('read-continuity')).resolves.toMatchObject({
      derivedDirector: true,
      organizationOwner: false,
    })
    await expect(effectiveAuthority('mutate')).resolves.toMatchObject({
      derivedDirector: false,
      organizationOwner: false,
    })
  })

  test('batches exact-source operation predicates and locks the same evidence during a transaction', async () => {
    const jobsScope = 'esi-corporations.read_freelance_jobs.v1'
    await connection`
      update eve_tokens set scopes = ${connection.json([rolesScope, membershipScope, jobsScope])}
      where character_id = ${characterId}
    `
    mocks.readCharacterCorporationRoles.mockResolvedValue(roleRead(['Director', 'Project_Manager']))
    await claimOwner()
    const registration = await modules.sources.registerOrganizationCorporationSource({
      actorUserId: userId,
      characterId,
      corporationId,
    })
    const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
      select subject_lifecycle_id from platform_subject_lifecycles
      where corporation_source_id = ${registration.source.sourceId}
    `
    const request = {
      binding: await currentBinding(),
      corporationLifecycleId: lifecycle!.subject_lifecycle_id,
      predicates: ['project-manager' as const],
      requiredScopes: [jobsScope],
      sourceId: registration.source.sourceId,
    }
    const [current] = await modules.evidence.evaluateCorporationResourceRoles(modules.db.db, [
      request,
    ])
    expect(current).toMatchObject({
      outcome: 'satisfied',
      predicateOutcomes: { 'project-manager': true },
      sourceId: registration.source.sourceId,
    })
    expect(current?.revision).toBeTruthy()
    const [locked] = await modules.db.db.transaction((transaction) =>
      modules.evidence.lockCorporationResourceRolesInTransaction(transaction, [request]),
    )
    expect(locked).toEqual(current)
    const [sqlLocked] = await connection.begin((transaction) =>
      modules.evidence.lockCorporationResourceRolesInSqlTransaction(transaction, [request]),
    )
    expect(sqlLocked).toEqual(current)

    const candidate = {
      corporationLifecycleId: request.corporationLifecycleId,
      corporationId,
      organizationVersion: request.binding.organizationVersion,
      characterId,
      characterLifecycleId: request.binding.subjectLifecycleId,
      authorizationGeneration: request.binding.authorizationGeneration,
      requiredScopes: [jobsScope],
      predicates: ['project-manager' as const],
    }
    const [admitted] = await modules.evidence.evaluateCorporationResourceAuthority(connection, [
      candidate,
    ])
    expect(admitted).toMatchObject({ outcome: 'satisfied', roleRevision: current?.revision })
    const [admittedLocked] = await connection.begin((transaction) =>
      modules.evidence.lockCorporationResourceAuthorityInTransaction(transaction, [candidate]),
    )
    expect(admittedLocked).toEqual(admitted)
    const combined = await modules.evidence.evaluateCorporationResourceAuthority(connection, [
      candidate,
      { ...candidate, predicates: [] },
      { ...candidate, predicates: ['station-manager'] },
    ])
    expect(combined.map(({ outcome }) => outcome)).toEqual([
      'satisfied',
      'satisfied',
      'role-unsatisfied',
    ])

    const secondCorporationId = 98_000_002
    const secondUserId = randomUUID()
    const secondSourceId = randomUUID()
    const secondCorporationLifecycleId = randomUUID()
    await connection`
      insert into organization_managed_corporations (
        deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at
      ) values (1, 1, ${secondCorporationId}, now(), now())
    `
    const secondLifecycleId = await seedCharacter(
      secondUserId,
      secondCharacterId,
      false,
      [rolesScope, membershipScope, jobsScope],
      secondCorporationId,
    )
    const secondObservation = await connection.begin(async (transaction) => {
      const [observed] = await transaction<{ observation_id: string; role_revision: string }[]>`
        insert into character_corporation_role_observations (
          organization_version, user_id, character_id, source_subject_lifecycle_id,
          affiliation_period_revision, authority_corporation_id, authorization_generation,
          required_scope, role_revision, status, validated_at, esi_fresh_until, fresh_until,
          next_refresh_at, last_checked_at, last_applied_observation_sequence
        ) select 1, ${secondUserId}, ${secondCharacterId}, ${secondLifecycleId},
          affiliation_period_revision, ${secondCorporationId}, 0, ${rolesScope},
          gen_random_uuid(), 'fresh', now(), now() + interval '1 hour',
          now() + interval '1 hour', now() + interval '1 hour', now(),
          nextval('character_corporation_role_observation_sequence')
        from characters where character_id = ${secondCharacterId}
        returning observation_id, role_revision
      `
      await transaction`
        insert into character_corporation_role_contents (
          observation_id, roles, roles_at_base, roles_at_hq, roles_at_other
        ) values (${observed!.observation_id}, '{Director,Project_Manager}', '{}', '{}', '{}')
      `
      return observed!
    })
    await connection`
      insert into organization_corporation_sources (
        source_id, deployment_id, organization_version, corporation_id,
        character_id, evidence_character_id, source_user_id, source_subject_lifecycle_id,
        authorization_generation, role_evidence_revision, affiliation_period_revision,
        observed_corporation_id, required_scope, director_role_present, observed_at,
        fresh_until, status, registered_by_user_id
      ) select ${secondSourceId}, 1, 1, ${secondCorporationId}, ${secondCharacterId},
        ${secondCharacterId}, ${secondUserId}, ${secondLifecycleId}, 0,
        ${secondObservation.role_revision}, affiliation_period_revision,
        ${secondCorporationId}, ${membershipScope}, true, now(),
        now() + interval '1 hour', 'fresh', ${secondUserId}
      from characters where character_id = ${secondCharacterId}
    `
    await connection`
      insert into platform_subject_lifecycles (
        subject_lifecycle_id, subject_kind, subject_id, corporation_source_id
      ) values (${secondCorporationLifecycleId}, 'corporation', ${String(secondCorporationId)}, ${secondSourceId})
    `
    const secondCandidate = {
      ...candidate,
      corporationLifecycleId: secondCorporationLifecycleId,
      corporationId: secondCorporationId,
      characterId: secondCharacterId,
      characterLifecycleId: secondLifecycleId,
      authorizationGeneration: 0,
    }

    const upstream = vi.spyOn(connection, 'unsafe')
    const batch = Array.from({ length: 64 }, (_, index) => ({
      ...(index % 2 === 0 ? candidate : secondCandidate),
      predicates: index % 2 === 0 ? ['project-manager' as const] : ['station-manager' as const],
    }))
    const started = performance.now()
    const benchmark = await modules.evidence.evaluateCorporationResourceAuthority(connection, batch)
    const durationMilliseconds = performance.now() - started
    expect(benchmark.map(({ outcome }) => outcome)).toEqual(
      batch.map((_, index) => (index % 2 === 0 ? 'satisfied' : 'role-unsatisfied')),
    )
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(durationMilliseconds).toBeLessThan(30_000)
    upstream.mockRestore()

    const verdict = async (
      input: Parameters<
        typeof modules.evidence.evaluateCorporationResourceAuthority
      >[1][number] = candidate,
    ) => (await modules.evidence.evaluateCorporationResourceAuthority(connection, [input]))[0]
    const setRoles = (roles: readonly string[]) =>
      connection.begin(async (transaction) => {
        const [observation] = await transaction<{ role_revision: string }[]>`
        update character_corporation_role_observations
        set role_revision = gen_random_uuid()
        where character_id = ${characterId}
        returning role_revision
      `
        await transaction`
        update character_corporation_role_contents
        set roles = string_to_array(${roles.toSorted((left, right) => left.localeCompare(right)).join(',')}, ',')
        where observation_id in (
          select observation_id from character_corporation_role_observations
          where character_id = ${characterId}
        )
      `
        await transaction`
        update organization_corporation_sources
        set role_evidence_revision = ${observation!.role_revision}
        where source_id = ${registration.source.sourceId}
      `
      })
    await setRoles(['Director'])
    expect((await verdict())?.outcome).toBe('role-unsatisfied')
    await setRoles(['Director', 'Project_Manager'])
    expect((await verdict())?.outcome).toBe('satisfied')

    await connection`
      update character_corporation_role_observations
      set status = 'degraded', degraded_until = now() + interval '1 hour',
        failure_class = 'transient:esi-unavailable'
      where character_id = ${characterId}
    `
    expect((await verdict())?.outcome).toBe('role-unavailable')
    expect((await verdict({ ...candidate, predicates: [] }))?.outcome).toBe('satisfied')
    await connection`
      update character_corporation_role_observations
      set status = 'fresh', degraded_until = null, failure_class = null
      where character_id = ${characterId}
    `
    expect(
      (
        await modules.evidence.evaluateCorporationResourceAuthority(
          connection,
          [candidate],
          new Date(Date.now() + 2 * 60 * 60_000),
        )
      )[0]?.outcome,
    ).toBe('role-unavailable')

    await connection`update eve_tokens set token_version = 8 where character_id = ${characterId}`
    expect((await verdict())?.outcome).toBe('source-invalid')
    expect((await verdict({ ...candidate, predicates: [] }))?.outcome).toBe('source-invalid')
    await connection`update eve_tokens set token_version = 0 where character_id = ${characterId}`
    await connection`
      update organization_corporation_sources
      set revoked_at = now(), revoked_by_user_id = ${userId}, revocation_reason = 'Replacement'
      where source_id = ${registration.source.sourceId}
    `
    expect((await verdict())?.outcome).toBe('source-invalid')
    await connection`
      update organization_corporation_sources
      set revoked_at = null, revoked_by_user_id = null, revocation_reason = null
      where source_id = ${registration.source.sourceId}
    `
    const mixed = {
      ...candidate,
      requiredScopes: [jobsScope, 'esi-corporations.read_projects.v1'],
      predicates: ['project-manager' as const, 'accountant' as const],
    }
    expect((await verdict(mixed))?.missingScope).toBe('esi-corporations.read_projects.v1')
    await connection`
      update eve_tokens set scopes = ${connection.json([rolesScope, membershipScope, jobsScope, 'esi-corporations.read_projects.v1'])}
      where character_id = ${characterId}
    `
    expect((await verdict(mixed))?.outcome).toBe('role-unsatisfied')
    await setRoles(['Director', 'Project_Manager', 'Accountant'])
    expect((await verdict(mixed))?.outcome).toBe('satisfied')

    await connection`
      update eve_tokens set scopes = ${connection.json([rolesScope, membershipScope])}
      where character_id = ${characterId}
    `
    const [scopeMissing] = await modules.evidence.evaluateCorporationResourceRoles(modules.db.db, [
      request,
    ])
    expect(scopeMissing?.outcome).toBe('unavailable')
    const [missing] = await modules.evidence.evaluateCorporationResourceAuthority(connection, [
      candidate,
    ])
    expect(missing?.outcome).toBe('scope-missing')
    await connection`
      update eve_tokens set scopes = ${connection.json([rolesScope, membershipScope, jobsScope])}
      where character_id = ${characterId}
    `
    await connection`
      update characters set corporation_id = 98000002
      where character_id = ${characterId}
    `
    expect((await verdict())?.outcome).toBe('source-invalid')
  })
})

describe('corporation-role outage recovery', () => {
  test('persists a classified affiliation outage and defers another refresh', async () => {
    await claimOwner()
    await expireObservation()
    mocks.observeAndPersistCharacterAffiliation.mockRejectedValueOnce(
      new EsiHttpError({ operationId: 'PostCharactersAffiliation', status: 503 }),
    )
    mocks.readCharacterCorporationRoles.mockClear()

    await expect(refreshCurrentDemand()).resolves.toBe('degraded')
    const [observation] = await loadObservationRows()
    expect(observation).toMatchObject({
      failure_class: 'transient:esi-unavailable',
      status: 'degraded',
    })
    expect(observation!.next_refresh_at.getTime()).toBeGreaterThanOrEqual(Date.now() + 4 * 60_000)
    await expect(refreshCurrentDemand()).resolves.toBe('not-due')
    expect(mocks.readCharacterCorporationRoles).not.toHaveBeenCalled()
    await expect(ownerAuthority('read-continuity')).resolves.toBe(true)
    await expect(ownerAuthority('mutate')).resolves.toBe(false)
  })

  test('does not persist an affiliation failure after cancellation', async () => {
    await observeThroughDemand()
    await makeDue()
    const demand = await modules.demand.loadCorporationRoleDemand(modules.db.db, characterId)
    const [before] = await loadObservationRows()
    const controller = new AbortController()
    mocks.observeAndPersistCharacterAffiliation.mockImplementationOnce(async () => {
      controller.abort()
      throw new EsiHttpError({ operationId: 'PostCharactersAffiliation', status: 503 })
    })

    await expect(
      modules.refresh.refreshCorporationRoleEvidence(demand!, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    const [after] = await loadObservationRows()
    expect(after?.last_applied_observation_sequence).toBe(before?.last_applied_observation_sequence)
  })

  test('keeps expired derived demand retryable without granting stale authority', async () => {
    await observeThroughDemand()
    await expireObservation()
    mocks.observeAndPersistCharacterAffiliation.mockResolvedValue(null)
    await expect(refreshCurrentDemand()).resolves.toBe('degraded')
    await connection`
      update character_corporation_role_observations
      set degraded_until = now() - interval '1 second', fresh_until = now() - interval '2 seconds'
      where character_id = ${characterId}
    `
    await makeDue()
    await expect(refreshCurrentDemand()).resolves.toBe('invalidated')
    expect(await loadObservationRows()).toStrictEqual([
      expect.objectContaining({ content_rows: 0, invalidation_outcome: 'expired' }),
    ])
    await expect(effectiveAuthority()).resolves.toMatchObject({ director: false })

    await connection`
      update character_corporation_role_observations
      set last_checked_at = now() - interval '6 minutes'
      where character_id = ${characterId}
    `
    const [retry] = await modules.demand.selectDueCorporationRoleDemand({
      dueBefore: new Date(),
      limit: 10,
    })
    expect(retry).toMatchObject({
      characterId,
      consumers: ['derived-director'],
      expectedRoleRevision: expect.any(String),
    })
    await expect(modules.refresh.refreshCorporationRoleEvidence(retry!)).resolves.toBe(
      'invalidated',
    )
    await expect(refreshCurrentDemand()).resolves.toBe('not-due')

    await connection`
      update character_corporation_role_observations
      set last_checked_at = now() - interval '6 minutes'
      where character_id = ${characterId}
    `
    mocks.observeAndPersistCharacterAffiliation.mockResolvedValue({
      affiliationCheckedAt: new Date(),
      affiliationFreshUntil: inOneHour(),
      allianceId: null,
      characterId,
      corporationId,
      stale: false,
    })
    await expect(refreshCurrentDemand()).resolves.toBe('observed')
    expect(await loadObservationRows()).toStrictEqual([
      expect.objectContaining({ content_rows: 1, status: 'fresh' }),
    ])
  })
})

describe('organization authority convergence', () => {
  test('bootstraps an owner claim without prior scheduled demand', async () => {
    await connection`update deployment_settings set derived_director_authority_enabled = false`
    await expect(
      modules.demand.selectDueCorporationRoleDemand({ dueBefore: new Date(), limit: 10 }),
    ).resolves.toStrictEqual([])

    const grantId = await claimOwner()
    const [owner] = await connection<{ role_evidence_revision: string }[]>`
      select role_evidence_revision from organization_authority_evidence where grant_id = ${grantId}
    `
    const [row] = await loadObservationRows()
    expect(owner?.role_evidence_revision).toBe(row?.role_revision)
    await expect(ownerAuthority()).resolves.toBe(true)
    await expect(
      connection<{ count: number }[]>`
        select count(*)::integer as count from organization_derived_authority_sources
      `.then((rows) => [...rows]),
    ).resolves.toStrictEqual([{ count: 0 }])
  })

  test('bootstraps the first corporation source only with its registration', async () => {
    await connection`update deployment_settings set derived_director_authority_enabled = false`
    await claimOwner()
    await seedCharacter(userId, secondCharacterId, false, [rolesScope, membershipScope])

    await expect(
      modules.sources.registerOrganizationCorporationSource({
        actorUserId: userId,
        characterId: secondCharacterId,
        corporationId,
      }),
    ).resolves.toMatchObject({ replaced: false })
    const [source] = await connection<{ role_evidence_revision: string }[]>`
      select role_evidence_revision from organization_corporation_sources where revoked_at is null
    `
    const [row] = await loadObservationRows(secondCharacterId)
    expect(source?.role_evidence_revision).toBe(row?.role_revision)
  })

  test('rolls back bootstrap evidence together with a rejected mutation', async () => {
    const blockedUserId = randomUUID()
    const blockedLifecycleId = await seedCharacter(blockedUserId, secondCharacterId, false)
    await claimOwner()
    await modules.blocks.blockOrganizationMember({
      actorUserId: userId,
      reason: 'Claim remains under review.',
      targetUserId: blockedUserId,
    })
    await connection`
      update organization_authority_evidence
      set status = 'invalid', failure_class = 'strict:not-director', grace_until = null,
        invalidated_at = now(), invalidation_outcome = 'not-director'
    `

    await expect(
      modules.ownerClaim.claimOrganizationOwnership(
        ownerClaimInput({
          characterId: secondCharacterId,
          subjectLifecycleId: blockedLifecycleId,
          userId: blockedUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'member-blocked' })
    await expect(loadObservationRows(secondCharacterId)).resolves.toStrictEqual([])

    await expect(
      modules.ownerClaim.claimOrganizationOwnership(ownerClaimInput({ userId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'character-not-owned' })
  })

  test('fails closed on a stale projection before asynchronous repair', async () => {
    const grantId = await claimOwner()
    await connection`
      update organization_authority_evidence
      set role_evidence_revision = ${randomUUID()}
      where grant_id = ${grantId}
    `
    await expect(ownerAuthority()).resolves.toBe(false)
  })

  test('keeps Director authority through another independent source after one loses Director', async () => {
    await seedCharacter(userId, secondCharacterId, false)
    await observeThroughDemand(characterId)
    await observeThroughDemand(secondCharacterId)
    await expect(effectiveAuthority('mutate')).resolves.toMatchObject({ derivedDirector: true })

    mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead([]))
    await observeThroughDemand(characterId)
    const authority = await effectiveAuthority('mutate')
    expect(authority.derivedDirector).toBe(true)
    expect(authority.derivedSources.filter(({ state }) => state === 'fresh')).toStrictEqual([
      expect.objectContaining({ characterId: secondCharacterId }),
    ])
  })

  test('removes only EVE-backed authority when an explicit grant remains current', async () => {
    const grantId = await claimOwner()
    await modules.roleStore.grantOrganizationRole({
      actorUserId: userId,
      reason: 'Explicit director assignment.',
      role: 'director',
      targetUserId: userId,
    })
    await expect(effectiveAuthority('mutate')).resolves.toMatchObject({
      derivedDirector: true,
      explicitDirector: true,
    })
    mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead([]))

    await observeThroughDemand()
    await expect(effectiveAuthority('mutate')).resolves.toMatchObject({
      derivedDirector: false,
      director: true,
      explicitDirector: true,
      organizationOwner: false,
    })
    const [grant] = await connection<{ revoked_at: Date | null }[]>`
      select revoked_at from organization_role_grants where grant_id = ${grantId}
    `
    expect(grant?.revoked_at).toBeNull()
  })

  test('never silently replaces an owner source that lost Director', async () => {
    await seedCharacter(userId, secondCharacterId, false)
    await claimOwner()
    await observeThroughDemand(secondCharacterId)
    mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead([]))

    await observeThroughDemand(characterId)
    await expect(effectiveAuthority('mutate')).resolves.toMatchObject({
      derivedDirector: true,
      organizationOwner: false,
    })
    const owners = await connection<{ character_id: string; status: string }[]>`
      select character_id, status from organization_authority_evidence
    `
    expect([...owners]).toStrictEqual([{ character_id: String(characterId), status: 'invalid' }])
  })

  test('invalidates evidence and authority when the affiliation period changes', async () => {
    await claimOwner()
    await connection`update characters set alliance_id = 99000001 where character_id = ${characterId}`
    await modules.db.db.transaction((transaction) =>
      modules.authorityConvergence.convergeObservedAffiliationInTransaction(
        transaction,
        [userId],
        new Date(),
      ),
    )
    await expect(ownerAuthority('read-continuity')).resolves.toBe(false)
    const [owner] = await connection<{ invalidation_outcome: string }[]>`
      select invalidation_outcome from organization_authority_evidence
    `
    expect(owner?.invalidation_outcome).toBe('affiliation-changed')
  })

  test('carries evidence across token refresh but not across authorization changes', async () => {
    await claimOwner()
    await connection`update eve_tokens set token_version = 1 where character_id = ${characterId}`
    await modules.db.db.transaction((transaction) =>
      modules.authorityConvergence.advanceCharacterAuthorityAuthorizationGenerationInTransaction(
        transaction,
        { authorizationGeneration: 1, characterId },
      ),
    )
    await expect(ownerAuthority()).resolves.toBe(true)

    await connection`update eve_tokens set token_version = 2 where character_id = ${characterId}`
    await modules.db.db.transaction((transaction) =>
      modules.authorityConvergence.invalidateCharacterAuthoritySourcesInTransaction(transaction, {
        characterId,
        outcome: 'authorization-generation-changed',
      }),
    )
    await expect(ownerAuthority('read-continuity')).resolves.toBe(false)
    await expect(loadObservationRows()).resolves.toStrictEqual([
      expect.objectContaining({
        content_rows: 0,
        invalidation_outcome: 'authorization-generation-changed',
      }),
    ])
  })

  test('tombstones prior-version evidence when the organization changes', async () => {
    await claimOwner()
    await modules.admin.updateDeploymentOrganization(
      { id: 98_000_002, name: 'Second Corporation', ticker: 'TWO', type: 'corporation' },
      adminId,
    )
    await expect(loadObservationRows()).resolves.toStrictEqual([
      expect.objectContaining({
        content_rows: 0,
        invalidation_outcome: 'organization-replaced',
        status: 'invalid',
      }),
    ])
  })
})

describe('corporation-role domain events', () => {
  test('rolls back the event with a failed convergence transaction', async () => {
    await observeThroughDemand()
    const [before] = await loadObservationRows()
    const binding = await currentBinding()
    const sequence = await modules.invalidation.allocateCorporationRoleObservationSequence()

    await expect(
      modules.db.db.transaction((transaction) =>
        modules.observation.persistCorporationRoleAttemptInTransaction(
          transaction,
          { ...attempt(binding, sequence), outcome: { kind: 'observed', read: roleRead([]) } },
          {
            afterPersist: async () => {
              throw new Error('convergence failed')
            },
            authority: demandAuthority(before!.role_revision),
          },
        ),
      ),
    ).rejects.toThrow('convergence failed')
    await expect(loadObservationRows()).resolves.toStrictEqual([before])
    await expect(loadRoleEvents()).resolves.toStrictEqual([])
  })

  test('relays only the stable event identity and converges repeated delivery', async () => {
    await claimOwner()
    mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead([]))
    await observeThroughDemand()
    await connection`
      update organization_authority_evidence
      set status = 'fresh', failure_class = null, invalidated_at = null,
        invalidation_outcome = null, director_role_present = true
    `
    const producer = modules.producer.createInMemoryQueueProducer()
    const outcomes = {
      recordAffiliation: vi.fn(),
      recordOutbox: vi.fn().mockResolvedValue(undefined),
    }

    await modules.outbox.runOutboxRelayBatch(
      producer,
      outcomes as never,
      modules.outbox.outboxRelayStore,
    )
    const relayed = producer.commands.filter(({ name }) => name === 'domain-event')
    const roleEvents = await loadRoleEvents(true)
    expect(relayed).toContainEqual(
      expect.objectContaining({ payload: { eventId: roleEvents[0]!.event_id } }),
    )
    expect(JSON.stringify(relayed)).not.toMatch(/Director|revision|roles/)

    await modules.handlers.dispatchDomainEvent(roleEvents[0]!.event_id)
    await modules.handlers.dispatchDomainEvent(roleEvents[0]!.event_id)
    const owners = await connection<{ status: string; invalidation_outcome: string }[]>`
      select status, invalidation_outcome from organization_authority_evidence
    `
    expect([...owners]).toStrictEqual([{ invalidation_outcome: 'not-director', status: 'invalid' }])
  })

  test('ignores a delayed event after a newer generation became current', async () => {
    await claimOwner()
    mocks.readCharacterCorporationRoles.mockResolvedValueOnce(roleRead(['Accountant', 'Director']))
    await observeThroughDemand()
    const [event] = await loadRoleEvents(true)
    await connection`update eve_tokens set token_version = 5 where character_id = ${characterId}`
    await modules.db.db.transaction((transaction) =>
      modules.authorityConvergence.advanceCharacterAuthorityAuthorizationGenerationInTransaction(
        transaction,
        { authorizationGeneration: 5, characterId },
      ),
    )

    await modules.handlers.dispatchDomainEvent(event!.event_id)
    await expect(ownerAuthority()).resolves.toBe(true)
  })

  test('reports safe aggregate diagnostics without identifiers', async () => {
    await claimOwner()
    await seedCharacter(userId, secondCharacterId, false)
    await expect(modules.diagnostics.probeCorporationRoleEvidenceStatus()).resolves.toStrictEqual({
      degraded: 0,
      fresh: 1,
      invalid: 0,
      legacy: 0,
      overdue: 0,
      pending: 0,
      status: 'operational',
    })
  })
})

describe('bounded legacy rollout', () => {
  test('honors only the captured pre-migration deadline until new evidence exists', async () => {
    const grantId = await claimOwner()
    await dropObservations()
    await seedLegacyContinuity(grantId, "now() + interval '30 minutes'")
    await expect(ownerAuthority()).resolves.toBe(true)
    await expect(modules.diagnostics.probeCorporationRoleEvidenceStatus()).resolves.toMatchObject({
      legacy: 1,
    })

    await connection`
      update organization_authority_evidence
      set legacy_role_continuity_until = now() - interval '1 second'
      where grant_id = ${grantId}
    `
    await expect(ownerAuthority('read-continuity')).resolves.toBe(false)
  })

  test('ends continuity at the first accepted observation and never recreates it', async () => {
    const grantId = await claimOwner()
    await dropObservations()
    await seedLegacyContinuity(grantId, "now() + interval '30 minutes'")
    const due = await modules.demand.selectDueCorporationRoleDemand({
      dueBefore: new Date(),
      limit: 10,
    })
    expect(due).toStrictEqual([expect.objectContaining({ characterId, nextRefreshAt: null })])

    await expect(refreshCurrentDemand()).resolves.toBe('observed')
    const [owner] = await connection<{ legacy_role_continuity_until: Date | null }[]>`
      select legacy_role_continuity_until from organization_authority_evidence
      where grant_id = ${grantId}
    `
    expect(owner?.legacy_role_continuity_until).toBeNull()
    await expect(ownerAuthority()).resolves.toBe(true)
  })

  test('ends continuity immediately after a strict failure without a fresh observation', async () => {
    const grantId = await claimOwner()
    await dropObservations()
    await seedLegacyContinuity(grantId, "now() + interval '30 minutes'")
    mocks.readCharacterCorporationRoles.mockRejectedValueOnce(
      new (
        await import('../../../src/auth/character-token-store.js')
      ).CharacterTokenNotFoundError(),
    )

    await expect(refreshCurrentDemand()).resolves.toBe('invalidated')
    await expect(ownerAuthority('read-continuity')).resolves.toBe(false)
  })

  test('keeps continuity through a transient first attempt and records retry state', async () => {
    const grantId = await claimOwner()
    await dropObservations()
    await seedLegacyContinuity(grantId, "now() + interval '30 minutes'")
    mocks.observeAndPersistCharacterAffiliation.mockResolvedValueOnce(null)

    await expect(refreshCurrentDemand()).resolves.toBe('retry-scheduled')
    await expect(loadObservationRows()).resolves.toStrictEqual([
      expect.objectContaining({ role_revision: null, status: 'pending' }),
    ])
    await expect(ownerAuthority()).resolves.toBe(true)
  })

  test('seeds continuity only for fresh sources during the migration upgrade', async () => {
    const upgradeDatabase = `upgrade_${randomUUID().replaceAll('-', '')}`
    await connection.unsafe(`create database ${upgradeDatabase}`)
    const upgrade = postgres(databaseUrl.replace(/\/eve_space$/, `/${upgradeDatabase}`), {
      onnotice: () => {},
    })
    try {
      const { loadMigrations } = await import('../../../src/db/migration-runner.js')
      const migrations = await loadMigrations()
      const upgradeIndex = migrations.findIndex(
        ({ name }) => name === '009_corporation_role_observations.sql',
      )
      await runMigrations(upgrade, migrations.slice(0, upgradeIndex))
      const legacy = await seedPreMigrationSources(upgrade)

      await runMigrations(upgrade, migrations.slice(upgradeIndex))
      const rows = await upgrade<
        {
          grant_id: string
          legacy_role_continuity_until: Date | null
          fresh_until: Date
          affiliation_period_revision: string | null
          period: string
        }[]
      >`
        select evidence.grant_id, evidence.legacy_role_continuity_until, evidence.fresh_until,
          evidence.affiliation_period_revision, character.affiliation_period_revision as period
        from organization_authority_evidence evidence
        join characters character on character.character_id = evidence.character_id
        order by evidence.fresh_until
      `
      expect([...rows]).toStrictEqual([
        expect.objectContaining({
          grant_id: legacy.invalidGrantId,
          legacy_role_continuity_until: null,
        }),
        expect.objectContaining({ grant_id: legacy.freshGrantId }),
      ])
      expect(rows[1]!.legacy_role_continuity_until).toStrictEqual(rows[1]!.fresh_until)
      expect(rows[1]!.affiliation_period_revision).toBe(rows[1]!.period)
    } finally {
      await upgrade.end()
      await connection.unsafe(`drop database ${upgradeDatabase}`)
    }
  })
})

describe('corporation-role worker execution', () => {
  test('pages due demand across null and equal refresh deadlines', async () => {
    await seedCharacter(userId, secondCharacterId, false)
    const dueBefore = new Date()
    const [first] = await modules.demand.selectDueCorporationRoleDemand({ dueBefore, limit: 1 })
    const [second] = await modules.demand.selectDueCorporationRoleDemand({
      after: first,
      dueBefore,
      limit: 1,
    })
    expect([first?.characterId, second?.characterId]).toStrictEqual([
      characterId,
      secondCharacterId,
    ])

    await observeThroughDemand(characterId)
    await observeThroughDemand(secondCharacterId)
    const dueAt = new Date(Date.now() - 1000)
    await connection`
      update character_corporation_role_observations
      set next_refresh_at = ${dueAt}
    `
    const [firstTimed] = await modules.demand.selectDueCorporationRoleDemand({
      dueBefore: new Date(),
      limit: 1,
    })
    const [secondTimed] = await modules.demand.selectDueCorporationRoleDemand({
      after: firstTimed,
      dueBefore: new Date(),
      limit: 1,
    })
    expect([firstTimed?.characterId, secondTimed?.characterId]).toStrictEqual([
      characterId,
      secondCharacterId,
    ])
  })

  test('plans initial demand once and executes it through the worker handler', async () => {
    const producer = modules.producer.createInMemoryQueueProducer()
    const context = { outcomes: {} as never, producer, signal: new AbortController().signal }

    await expect(modules.planner.runCorporationRolePlanner(context)).resolves.toStrictEqual({
      planned: 1,
      reason: 'scheduled',
    })
    await expect(modules.planner.runCorporationRolePlanner(context)).resolves.toMatchObject({
      planned: 0,
    })
    const [command] = producer.commands
    await expect(
      modules.jobs.executeJobHandler(
        'corporation-role-observation',
        command!.payload as never,
        context,
      ),
    ).resolves.toStrictEqual({ type: 'completed' })
    expect(mocks.readCharacterCorporationRoles).toHaveBeenCalledOnce()
    await expect(loadObservationRows()).resolves.toStrictEqual([
      expect.objectContaining({ status: 'fresh' }),
    ])
  })

  test('coalesces owner, source, and derived demand into one upstream refresh', async () => {
    await connection`
      update eve_tokens set scopes = ${connection.json([rolesScope, membershipScope])}
      where character_id = ${characterId}
    `
    await claimOwner()
    await modules.sources.registerOrganizationCorporationSource({
      actorUserId: userId,
      characterId,
      corporationId,
    })
    await makeDue()
    mocks.readCharacterCorporationRoles.mockClear()
    const producer = modules.producer.createInMemoryQueueProducer()
    const context = { outcomes: {} as never, producer, signal: new AbortController().signal }

    await expect(
      modules.demand.selectDueCorporationRoleDemand({ dueBefore: new Date(), limit: 10 }),
    ).resolves.toStrictEqual([
      expect.objectContaining({
        characterId,
        consumers: ['corporation-source', 'derived-director', 'organization-owner'],
      }),
    ])
    await expect(modules.planner.runCorporationRolePlanner(context)).resolves.toMatchObject({
      planned: 1,
    })
    await modules.jobs.executeJobHandler(
      'corporation-role-observation',
      producer.commands[0]!.payload as never,
      context,
    )
    expect(mocks.readCharacterCorporationRoles).toHaveBeenCalledOnce()
    const sources = await connection<{ role_evidence_revision: string }[]>`
      select role_evidence_revision from organization_authority_evidence
      union all
      select role_evidence_revision from organization_derived_authority_sources
        where invalidated_at is null
      union all
      select role_evidence_revision from organization_corporation_sources where revoked_at is null
    `
    const [observation] = await loadObservationRows()
    expect(
      new Set(sources.map(({ role_evidence_revision }) => role_evidence_revision)),
    ).toStrictEqual(new Set([observation!.role_revision]))
  })

  test('schedules revalidation at the persisted due time without early upstream reads', async () => {
    await observeThroughDemand()
    await connection`
      update character_corporation_role_observations
      set next_refresh_at = now() + interval '10 minutes'
    `
    const producer = modules.producer.createInMemoryQueueProducer()
    const context = { outcomes: {} as never, producer, signal: new AbortController().signal }
    mocks.readCharacterCorporationRoles.mockClear()

    await expect(modules.planner.runCorporationRolePlanner(context)).resolves.toMatchObject({
      planned: 1,
    })
    const [command] = producer.commands
    expect((command as { notBefore: Date }).notBefore.getTime()).toBeGreaterThan(Date.now())
    await modules.jobs.executeJobHandler(
      'corporation-role-observation',
      command!.payload as never,
      context,
    )
    expect(mocks.readCharacterCorporationRoles).not.toHaveBeenCalled()
  })

  test('recovers after an outage without rotating unchanged evidence', async () => {
    await claimOwner()
    const [before] = await loadObservationRows()
    await expireObservation()
    mocks.readCharacterCorporationRoles.mockRejectedValueOnce(
      new (await import('../../../src/auth/token-errors.js')).TokenRefreshUnavailableError(),
    )
    await expect(refreshCurrentDemand()).resolves.toBe('degraded')

    await makeDue()
    await expect(refreshCurrentDemand()).resolves.toBe('observed')
    const [after] = await loadObservationRows()
    expect(after).toMatchObject({ role_revision: before?.role_revision, status: 'fresh' })
    await expect(ownerAuthority()).resolves.toBe(true)
  })

  test('reconstructs planned work after queue loss', async () => {
    const context = {
      outcomes: {} as never,
      producer: modules.producer.createInMemoryQueueProducer(),
    }
    await modules.planner.runCorporationRolePlanner(context)
    const recovered = modules.producer.createInMemoryQueueProducer()
    await expect(
      modules.planner.runCorporationRolePlanner({ ...context, producer: recovered }),
    ).resolves.toMatchObject({ planned: 1 })
  })

  test('supersedes work whose affiliation period changes during collection', async () => {
    await observeThroughDemand()
    await makeDue()
    const demand = await modules.demand.loadCorporationRoleDemand(modules.db.db, characterId)
    mocks.observeAndPersistCharacterAffiliation.mockImplementationOnce(async () => {
      await connection`update characters set corporation_id = 98000002 where character_id = ${characterId}`
      return null
    })

    await expect(modules.refresh.refreshCorporationRoleEvidence(demand!)).resolves.toBe(
      'superseded',
    )
    expect(mocks.readCharacterCorporationRoles).toHaveBeenCalledTimes(1)
  })
})

function roleRead(
  roles: readonly string[],
  overrides: Partial<{
    readonly authorizationGeneration: number
    readonly validatedAt: Date
    readonly stale: boolean
  }> = {},
) {
  const validatedAt = overrides.validatedAt ?? new Date()
  return {
    authorizationGeneration: overrides.authorizationGeneration ?? 0,
    cachedUntil: new Date(validatedAt.getTime() + 60 * 60 * 1000),
    retryAt: null,
    roles: modules.canonical.canonicalizeCorporationRoleSets({
      roles,
      rolesAtBase: [],
      rolesAtHeadquarters: [],
      rolesAtOther: [],
    }),
    stale: overrides.stale ?? false,
    validatedAt,
  }
}

function inOneHour() {
  return new Date(Date.now() + 60 * 60 * 1000)
}

function attempt(
  binding: Awaited<ReturnType<typeof currentBinding>>,
  sequence: bigint,
): Omit<
  import('../../../src/characters/corporation-role-observation.js').CorporationRoleAttempt,
  'outcome'
> {
  return { affiliationFreshUntil: inOneHour(), binding, sequence }
}

function demandAuthority(expectedRoleRevision: string | null) {
  return {
    expectedRoleRevision,
    isDemanded: modules.demand.isCorporationRoleBindingDemanded,
    kind: 'demand' as const,
  }
}

async function persist(
  value: import('../../../src/characters/corporation-role-observation.js').CorporationRoleAttempt,
) {
  const [current] = await loadObservationRows(value.binding.characterId)
  const expected = current?.status === 'invalid' ? null : (current?.role_revision ?? null)
  return modules.db.db.transaction((transaction) =>
    modules.observation.persistCorporationRoleAttemptInTransaction(transaction, value, {
      afterPersist: modules.convergence.createCorporationRoleConvergenceHook({
        authorityCorporation: { corporationId, freshUntil: null },
      }),
      authority: demandAuthority(expected),
    }),
  )
}

async function currentBinding(targetCharacterId = characterId) {
  const [character] = await connection<{ user_id: string }[]>`
    select user_id from characters where character_id = ${targetCharacterId}
  `
  const binding = await modules.evidence.loadCurrentCorporationRoleBinding(modules.db.db, {
    characterId: targetCharacterId,
    userId: character!.user_id,
  })
  if (!binding) {
    throw new Error('Current role binding is missing')
  }
  return binding
}

async function observeThroughDemand(targetCharacterId = characterId) {
  await makeDue(targetCharacterId)
  const demand = await modules.demand.loadCorporationRoleDemand(modules.db.db, targetCharacterId)
  if (!demand) {
    throw new Error('Role demand is missing')
  }
  return modules.refresh.refreshCorporationRoleEvidence(demand)
}

async function refreshCurrentDemand(targetCharacterId = characterId) {
  const demand = await modules.demand.loadCorporationRoleDemand(modules.db.db, targetCharacterId)
  if (!demand) {
    throw new Error('Role demand is missing')
  }
  return modules.refresh.refreshCorporationRoleEvidence(demand)
}

async function makeDue(targetCharacterId = characterId) {
  await connection`
    update character_corporation_role_observations
    set next_refresh_at = now() - interval '1 second'
    where character_id = ${targetCharacterId} and status <> 'invalid'
  `
}

async function expireObservation(targetCharacterId = characterId) {
  await connection`
    update character_corporation_role_observations
    set validated_at = now() - interval '2 hours', esi_fresh_until = now() - interval '1 second',
      fresh_until = now() - interval '1 second', next_refresh_at = now() - interval '1 second'
    where character_id = ${targetCharacterId} and status = 'fresh'
  `
  await connection`
    update organization_authority_evidence
    set observed_at = now() - interval '2 hours', fresh_until = now() - interval '1 second',
      last_checked_at = now() - interval '2 hours'
    where character_id = ${targetCharacterId} and invalidated_at is null
  `
  await connection`
    update organization_derived_authority_sources
    set observed_at = now() - interval '2 hours', fresh_until = now() - interval '1 second'
    where character_id = ${targetCharacterId} and invalidated_at is null
  `
}

async function dropObservations() {
  await connection`delete from character_corporation_role_observations`
}

async function seedLegacyContinuity(grantId: string, deadline: string) {
  await connection.begin(async (transaction) => {
    await transaction.unsafe(
      'alter table organization_authority_evidence disable trigger organization_authority_evidence_legacy_role_continuity_trigger',
    )
    await transaction.unsafe(
      `update organization_authority_evidence set legacy_role_continuity_until = ${deadline},
        fresh_until = greatest(fresh_until, ${deadline}) where grant_id = '${grantId}'`,
    )
    await transaction.unsafe(
      'alter table organization_authority_evidence enable trigger organization_authority_evidence_legacy_role_continuity_trigger',
    )
  })
}

async function loadObservationRows(targetCharacterId = characterId) {
  return [
    ...(await connection<
      {
        observation_id: string
        status: string
        role_revision: string | null
        affiliation_period_revision: string
        validated_at: Date
        degraded_until: Date | null
        next_refresh_at: Date
        failure_class: string | null
        invalidation_outcome: string | null
        last_applied_observation_sequence: string
        content_rows: number
      }[]
    >`
      select observation.observation_id, observation.status, observation.role_revision,
        observation.affiliation_period_revision, observation.validated_at,
        observation.degraded_until, observation.next_refresh_at, observation.failure_class,
        observation.invalidation_outcome,
        observation.last_applied_observation_sequence::text as last_applied_observation_sequence,
        (select count(*)::integer from character_corporation_role_contents content
          where content.observation_id = observation.observation_id) as content_rows
      from character_corporation_role_observations observation
      where observation.character_id = ${targetCharacterId}
      order by observation.created_at
    `),
  ]
}

async function loadRoleEvents(withIdentity = false) {
  const rows = await connection<{ event_id: string; event_type: string; payload: unknown }[]>`
    select event_id, event_type, payload
    from domain_events
    where event_type like 'character.corporation-role%'
    order by event_sequence
  `
  return rows.map((row) =>
    withIdentity ? row : { event_type: row.event_type, payload: row.payload },
  ) as { event_id: string; event_type: string; payload: unknown }[]
}

async function currentPeriod(targetCharacterId: number) {
  const [row] = await connection<{ affiliation_period_revision: string }[]>`
    select affiliation_period_revision from characters where character_id = ${targetCharacterId}
  `
  return row!.affiliation_period_revision
}

async function currentCorporation(targetCharacterId: number) {
  const [row] = await connection<{ corporation_id: string }[]>`
    select corporation_id from characters where character_id = ${targetCharacterId}
  `
  return Number(row?.corporation_id ?? corporationId)
}

async function currentGeneration(targetCharacterId: number) {
  const [row] = await connection<{ token_version: number }[]>`
    select token_version from eve_tokens where character_id = ${targetCharacterId}
  `
  return row?.token_version ?? 0
}

function ownerClaimInput(
  override: Partial<Parameters<Modules['ownerClaim']['claimOrganizationOwnership']>[0]> = {},
) {
  return {
    authorityCorporation: { corporationId, freshUntil: null },
    characterId,
    organizationId: corporationId,
    organizationVersion: 1,
    requiredScope: rolesScope,
    subjectLifecycleId,
    userId,
    ...override,
  }
}

async function claimOwner() {
  const grant = await modules.ownerClaim.claimOrganizationOwnership(ownerClaimInput())
  return grant.grantId
}

async function effectiveAuthority(
  operation: 'read-continuity' | 'mutate' | 'remediate' = 'mutate',
) {
  return modules.effectiveAuthority.loadEffectiveOrganizationAuthority(
    modules.db.db,
    1,
    userId,
    operation,
    new Date(),
    { requireComplianceAccess: false },
  )
}

async function ownerAuthority(operation: 'read-continuity' | 'mutate' = 'mutate') {
  return (await effectiveAuthority(operation)).organizationOwner
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
      deployment_id, organization_version, organization_type, organization_id,
      organization_name, organization_ticker
    ) values (1, 1, 'corporation', ${corporationId}, 'First Corporation', 'ONE')
  `
  await connection`
    insert into deployment_settings (
      id, organization_type, organization_id, organization_name, organization_ticker,
      organization_version
    ) values (1, 'corporation', ${corporationId}, 'First Corporation', 'ONE', 1)
  `
  await connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at
    ) values (1, 1, ${corporationId}, now(), now())
  `
}

async function seedCharacter(
  seedUserId: string,
  seedCharacterId: number,
  isMain: boolean,
  scopes: readonly string[] = [rolesScope],
  seedCorporationId = corporationId,
) {
  await connection`insert into users (id) values (${seedUserId}) on conflict do nothing`
  await connection`
    insert into characters (
      character_id, user_id, owner_hash, name, corporation_id, affiliation_checked_at,
      next_affiliation_check, affiliation_resolution_state, is_main
    ) values (
      ${seedCharacterId}, ${seedUserId}, ${`owner-${seedCharacterId}`}, 'Role Pilot',
      ${seedCorporationId}, now(), now() + interval '1 hour', 'resolved', ${isMain}
    )
  `
  await connection`
    insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes)
    values (
      ${seedCharacterId}, 'encrypted-test-token', now() + interval '1 hour',
      ${connection.json([...scopes])}
    )
  `
  const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
    insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
    values ('character', ${String(seedCharacterId)}, ${seedCharacterId})
    returning subject_lifecycle_id
  `
  return lifecycle!.subject_lifecycle_id
}

async function seedPreMigrationSources(database: postgres.Sql) {
  const legacyUserId = randomUUID()
  const freshGrantId = randomUUID()
  const invalidGrantId = randomUUID()
  await database`
    insert into organization_epochs (
      deployment_id, organization_version, organization_type, organization_id,
      organization_name, organization_ticker
    ) values (1, 1, 'corporation', ${corporationId}, 'Legacy Corporation', 'OLD')
  `
  await database`insert into users (id) values (${legacyUserId})`
  for (const [offset, grantId, status] of [
    [0, freshGrantId, 'fresh'],
    [1, invalidGrantId, 'invalid'],
  ] as const) {
    const legacyCharacterId = characterId + offset
    await database`
      insert into characters (
        character_id, user_id, owner_hash, name, corporation_id, affiliation_checked_at,
        affiliation_resolution_state, is_main
      ) values (
        ${legacyCharacterId}, ${legacyUserId}, ${`legacy-${offset}`}, 'Legacy Pilot',
        ${corporationId}, now(), 'resolved', ${offset === 0}
      )
    `
    const [lifecycle] = await database<{ subject_lifecycle_id: string }[]>`
      insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
      values ('character', ${String(legacyCharacterId)}, ${legacyCharacterId})
      returning subject_lifecycle_id
    `
    await database`
      insert into organization_role_grants (
        grant_id, deployment_id, organization_version, user_id, role, granted_by_user_id, reason,
        revoked_at, revoked_by_user_id, revocation_reason
      ) values (
        ${grantId}, 1, 1, ${legacyUserId}, 'organization_owner', ${legacyUserId}, 'Legacy grant',
        case when ${status} = 'fresh' then null else now() end,
        case when ${status} = 'fresh' then null else ${legacyUserId}::uuid end,
        case when ${status} = 'fresh' then null else 'Legacy revoked grant' end
      )
    `
    await database`
      insert into organization_authority_evidence (
        grant_id, deployment_id, organization_version, user_id, character_id,
        source_subject_lifecycle_id, authority_corporation_id, observed_corporation_id,
        authorization_generation, required_scope, role_evidence_revision,
        director_role_present, observed_at, fresh_until, status, failure_class,
        invalidated_at, invalidation_outcome, last_checked_at
      ) values (
        ${grantId}, 1, 1, ${legacyUserId}, ${legacyCharacterId},
        ${lifecycle!.subject_lifecycle_id}, ${corporationId}, ${corporationId}, 0, ${rolesScope},
        '2026-09-25T11:00:00.000Z', true, now() - interval '5 minutes',
        ${new Date(Date.now() + (offset === 0 ? 31 : 30) * 60 * 1000)}, ${status},
        ${status === 'fresh' ? null : 'strict:not-director'},
        ${status === 'fresh' ? null : new Date()},
        ${status === 'fresh' ? null : 'not-director'}, now()
      )
    `
  }
  return { freshGrantId, invalidGrantId }
}

async function waitForDatabase() {
  for (let retry = 0; retry < 30; retry += 1) {
    try {
      await connection`select 1`
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error('PostgreSQL test container did not become ready')
}
