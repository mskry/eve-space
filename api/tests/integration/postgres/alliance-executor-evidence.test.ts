import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'
import { waitForDatabase } from './wait-for-database.js'

const allianceRead = vi.hoisted(() => vi.fn())
vi.mock('../../../src/alliances/public-data.js', () => ({ getAlliancePublicResult: allianceRead }))

let container: StartedTestContainer
let connection: postgres.Sql
let observeAllianceExecutor: typeof import('../../../src/organization/alliance-executor-evidence.js').observeAllianceExecutor
let loadCurrentAllianceExecutor: typeof import('../../../src/organization/alliance-executor-evidence.js').loadCurrentAllianceExecutor
let database: typeof import('../../../src/db/client.js').db
let evaluateOrganizationRuleAccount: typeof import('../../../src/organization/rule-evidence.js').evaluateOrganizationRuleAccount
let getOrganizationGroupPermissions: typeof import('../../../src/organization/group-permissions.js').getOrganizationGroupPermissions
let convergeRuleManagedGroupsForAccountInTransaction: typeof import('../../../src/organization/group-rule-convergence.js').convergeRuleManagedGroupsForAccountInTransaction
let loadCorporationRoleDemand: typeof import('../../../src/organization/corporation-role-demand.js').loadCorporationRoleDemand
let selectDueCorporationRoleDemand: typeof import('../../../src/organization/corporation-role-demand.js').selectDueCorporationRoleDemand
let createInMemoryQueueProducer: typeof import('../../../src/queue/producer.js').createInMemoryQueueProducer
let runAllianceExecutorPlanner: typeof import('../../../src/queue/alliance-executor-planner.js').runAllianceExecutorPlanner
let allianceExecutorRefreshDemanded: typeof import('../../../src/organization/alliance-executor-evidence.js').allianceExecutorRefreshDemanded
let runGroupRulePlanner: typeof import('../../../src/queue/group-rule-planner.js').runGroupRulePlanner
let runRuleGroupReconciliation: typeof import('../../../src/organization/group-rule-repair.js').runRuleGroupReconciliation
let repairAllianceExecutorRuleGroups: typeof import('../../../src/organization/alliance-executor-repair.js').repairAllianceExecutorRuleGroups
let invalidateCharacterAuthoritySourcesInTransaction: typeof import('../../../src/organization/authority-convergence.js').invalidateCharacterAuthoritySourcesInTransaction
let advanceCharacterAuthorityAuthorizationGenerationInTransaction: typeof import('../../../src/organization/authority-convergence.js').advanceCharacterAuthorityAuthorizationGenerationInTransaction
let convergeAllianceExecutorChangeInTransaction: typeof import('../../../src/organization/alliance-executor-convergence.js').convergeAllianceExecutorChangeInTransaction
const allianceId = 99_000_001
const checkedAt = new Date()

const response = (executorCorporationId: number | null, stale = false) => ({
  data: { executorCorporationId },
  stale,
  validatedAt: checkedAt.toISOString(),
  cachedUntil: new Date(checkedAt.getTime() + 60 * 60_000).toISOString(),
})

const requireRow = <T>(row: T | undefined | null): T => {
  if (!row) throw new Error('Expected an integration fixture row')
  return row
}

const planningContext = (producer: ReturnType<typeof createInMemoryQueueProducer>) => ({
  producer,
  outcomes: {
    async recordAffiliation() {},
    async recordOutbox() {},
  },
})

beforeAll(async () => {
  const password = randomUUID()
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_USER: 'eve_space',
      POSTGRES_PASSWORD: password,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .start()
  const url = `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  connection = postgres(url, { onnotice: () => {} })
  await waitForDatabase(connection)
  Object.assign(process.env, { DATABASE_URL: url })
  await runMigrations(connection)
  ;({ db: database } = await import('../../../src/db/client.js'))
  ;({ observeAllianceExecutor, loadCurrentAllianceExecutor, allianceExecutorRefreshDemanded } =
    await import('../../../src/organization/alliance-executor-evidence.js'))
  ;({ evaluateOrganizationRuleAccount } =
    await import('../../../src/organization/rule-evidence.js'))
  ;({ getOrganizationGroupPermissions } =
    await import('../../../src/organization/group-permissions.js'))
  ;({ convergeRuleManagedGroupsForAccountInTransaction } =
    await import('../../../src/organization/group-rule-convergence.js'))
  ;({ loadCorporationRoleDemand, selectDueCorporationRoleDemand } =
    await import('../../../src/organization/corporation-role-demand.js'))
  ;({ createInMemoryQueueProducer } = await import('../../../src/queue/producer.js'))
  ;({ runAllianceExecutorPlanner } =
    await import('../../../src/queue/alliance-executor-planner.js'))
  ;({ runGroupRulePlanner } = await import('../../../src/queue/group-rule-planner.js'))
  ;({ runRuleGroupReconciliation } = await import('../../../src/organization/group-rule-repair.js'))
  ;({ repairAllianceExecutorRuleGroups } =
    await import('../../../src/organization/alliance-executor-repair.js'))
  ;({
    invalidateCharacterAuthoritySourcesInTransaction,
    advanceCharacterAuthorityAuthorizationGenerationInTransaction,
  } = await import('../../../src/organization/authority-convergence.js'))
  ;({ convergeAllianceExecutorChangeInTransaction } =
    await import('../../../src/organization/alliance-executor-convergence.js'))
})

beforeEach(async () => {
  allianceRead.mockReset()
  await connection.unsafe(
    'truncate organization_epochs, deployment_admins, users, domain_events restart identity cascade',
  )
  await connection`
    insert into organization_epochs (
      deployment_id, organization_version, organization_type, organization_id,
      organization_name, organization_ticker
    ) values (1, 1, 'alliance', ${allianceId}, 'Test Alliance', 'TEST')
  `
  await connection`
    insert into deployment_settings (
      id, organization_type, organization_id, organization_name, organization_ticker,
      derived_director_authority_enabled
    ) values (1, 'alliance', ${allianceId}, 'Test Alliance', 'TEST', false)
  `
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('durable alliance executor observations', () => {
  test('retains revision across unchanged evidence and rotates it on a confirmed change', async () => {
    expect(await loadCurrentAllianceExecutor(database, 1, checkedAt)).toBeNull()
    allianceRead.mockResolvedValueOnce(response(98_000_001))
    expect((await observeAllianceExecutor(1)).outcome).toBe('accepted')
    const first = await loadCurrentAllianceExecutor(database, 1, checkedAt)
    expect(first).toMatchObject({ corporationId: 98_000_001 })

    allianceRead.mockResolvedValueOnce(response(98_000_001))
    expect((await observeAllianceExecutor(1)).outcome).toBe('accepted')
    const unchanged = await loadCurrentAllianceExecutor(database, 1, checkedAt)
    expect(unchanged?.revision).toBe(first?.revision)

    allianceRead.mockResolvedValueOnce(response(98_000_002))
    expect((await observeAllianceExecutor(1)).outcome).toBe('accepted')
    const replaced = await loadCurrentAllianceExecutor(database, 1, checkedAt)
    expect(replaced?.corporationId).toBe(98_000_002)
    expect(replaced?.revision).not.toBe(first?.revision)
    expect(
      await loadCurrentAllianceExecutor(database, 1, new Date(checkedAt.getTime() + 60 * 60_000)),
    ).toBeNull()
  })

  test('does not fabricate a new executor from stale, unavailable, or absent public data', async () => {
    allianceRead.mockResolvedValueOnce(response(98_000_001, true))
    expect((await observeAllianceExecutor(1)).outcome).toBe('unavailable')
    expect(await loadCurrentAllianceExecutor(database, 1, checkedAt)).toBeNull()
    allianceRead.mockRejectedValueOnce(new Error('ESI unavailable'))
    expect((await observeAllianceExecutor(1)).outcome).toBe('unavailable')
    expect(await loadCurrentAllianceExecutor(database, 1, checkedAt)).toBeNull()
    allianceRead.mockResolvedValueOnce(response(null))
    expect((await observeAllianceExecutor(1)).outcome).toBe('accepted')
    expect(await loadCurrentAllianceExecutor(database, 1, checkedAt)).toBeNull()
  })

  test('rejects an older observation after a newer executor has committed', async () => {
    let releaseOldResult: ((result: ReturnType<typeof response>) => void) | undefined
    const olderResult = new Promise<ReturnType<typeof response>>((resolve) => {
      releaseOldResult = resolve
    })
    allianceRead.mockReturnValueOnce(olderResult).mockResolvedValueOnce(response(98_000_002))
    const olderAttempt = observeAllianceExecutor(1)
    await vi.waitFor(() => expect(allianceRead).toHaveBeenCalledTimes(1))
    expect((await observeAllianceExecutor(1)).outcome).toBe('accepted')
    releaseOldResult?.(response(98_000_001))
    expect((await olderAttempt).outcome).toBe('superseded')
    expect(await loadCurrentAllianceExecutor(database, 1, checkedAt)).toMatchObject({
      corporationId: 98_000_002,
    })
  })

  test('reopens bounded reconciliation when the same executor receives a later deadline', async () => {
    const userId = randomUUID()
    const bundleId = randomUUID()
    const groupId = randomUUID()
    allianceRead.mockResolvedValueOnce(response(98_000_001))
    const first = await observeAllianceExecutor(1, convergeAllianceExecutorChangeInTransaction)
    expect(first.outcome).toBe('accepted')
    await connection`insert into users (id) values (${userId})`
    await connection.begin(async (transaction) => {
      await transaction`
        insert into organization_permission_bundles (
          bundle_id, deployment_id, organization_version, name, created_by_user_id
        ) values (${bundleId}, 1, 1, 'Executor refresh bundle', ${userId})
      `
      await transaction`
        insert into organization_groups (
          group_id, deployment_id, organization_version, name, management_mode,
          restricted, created_by_user_id
        ) values (${groupId}, 1, 1, 'Executor refresh group', 'rule', true, ${userId})
      `
      await transaction`
        insert into organization_group_rules (
          group_id, deployment_id, organization_version, revision,
          condition_kind, predicate_key, enabled, updated_by_user_id
        ) values (${groupId}, 1, 1, 1, 'corporation-role', 'accountant', true, ${userId})
      `
      await transaction`
        insert into organization_group_rule_revisions (
          group_id, deployment_id, organization_version, revision,
          condition_kind, predicate_key, enabled, bundle_ids, changed_by_user_id
        ) values (${groupId}, 1, 1, 1, 'corporation-role', 'accountant', true,
          ${[bundleId]}, ${userId})
      `
      await transaction`
        insert into organization_group_rule_reconciliation (
          group_id, deployment_id, organization_version, revision, completed_at
        ) values (${groupId}, 1, 1, 1, ${checkedAt})
      `
    })
    const extendedUntil = new Date(checkedAt.getTime() + 2 * 60 * 60_000)
    allianceRead.mockResolvedValueOnce({
      ...response(98_000_001),
      cachedUntil: extendedUntil.toISOString(),
    })
    const refreshed = await observeAllianceExecutor(1, convergeAllianceExecutorChangeInTransaction)
    expect(refreshed).toMatchObject({ outcome: 'accepted', changed: false })
    expect((await loadCurrentAllianceExecutor(database, 1, checkedAt))?.revision).toBe(
      first.outcome === 'accepted' ? first.observation.executorRevision : null,
    )
    const [reconciliation] = await connection<{ completed_at: Date | null }[]>`
      select completed_at from organization_group_rule_reconciliation where group_id = ${groupId}
    `
    expect(reconciliation?.completed_at).toBeNull()
    await repairAllianceExecutorRuleGroups({
      organizationVersion: 1,
      executorRevision: requireRow(await loadCurrentAllianceExecutor(database, 1, checkedAt))
        .revision,
    })
    const [completed] = await connection<{ completed_at: Date | null }[]>`
      select completed_at from organization_group_rule_reconciliation where group_id = ${groupId}
    `
    expect(completed?.completed_at).not.toBeNull()
  })

  test('forwards cancellation to a pending public read without persisting retry state', async () => {
    const controller = new AbortController()
    allianceRead.mockImplementationOnce(
      (_allianceId: number, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    const pending = observeAllianceExecutor(1, undefined, controller.signal)
    await vi.waitFor(() => expect(allianceRead).toHaveBeenCalledOnce())
    expect(allianceRead).toHaveBeenCalledWith(allianceId, controller.signal)
    controller.abort(new DOMException('Worker stopped', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const [observations] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_alliance_executor_observations
    `
    expect(observations?.count).toBe(0)
  })

  test('rolls back an accepted observation when cancellation arrives during convergence', async () => {
    const controller = new AbortController()
    allianceRead.mockResolvedValueOnce(response(98_000_001))
    await expect(
      observeAllianceExecutor(
        1,
        async () => controller.abort(new DOMException('Worker stopped', 'AbortError')),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await loadCurrentAllianceExecutor(database, 1, checkedAt)).toBeNull()
  })

  test('invalidates an account role condition when the executor changes', async () => {
    const userId = randomUUID()
    const lifecycleId = randomUUID()
    const roleRevision = randomUUID()
    const characterId = 90_000_001
    const corporationId = 98_000_001
    const freshUntil = new Date(checkedAt.getTime() + 60 * 60_000)
    const requiredScope = 'esi-characters.read_corporation_roles.v1'
    await connection`insert into users (id) values (${userId})`
    await connection`
      insert into characters (
        character_id, user_id, owner_hash, name, corporation_id, alliance_id,
        affiliation_checked_at, affiliation_resolution_state, next_affiliation_check, is_main
      ) values (
        ${characterId}, ${userId}, 'verified-owner', 'Audited Pilot', ${corporationId}, ${allianceId},
        ${checkedAt}, 'resolved', ${freshUntil}, true
      )
    `
    await connection`
      insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes, token_version)
      values (${characterId}, 'v1.test-token-envelope', ${freshUntil},
        ${connection.json([requiredScope])}, 1)
    `
    await connection`
      insert into platform_subject_lifecycles (
        subject_lifecycle_id, subject_kind, subject_id, character_id
      ) values (${lifecycleId}, 'character', ${String(characterId)}, ${characterId})
    `
    await connection`
      insert into organization_account_compliance (
        deployment_id, organization_version, user_id, state, evidence_freshness,
        evidence_at, access_valid_until, established_compliant_at
      ) values (1, 1, ${userId}, 'compliant', 'fresh', ${checkedAt}, ${freshUntil}, ${checkedAt})
    `
    const [character] = await connection<{ affiliation_period_revision: string }[]>`
      select affiliation_period_revision from characters where character_id = ${characterId}
    `
    const affiliationRevision = requireRow(character).affiliation_period_revision
    await connection.begin(async (transaction) => {
      const [observation] = await transaction<{ observation_id: string }[]>`
        insert into character_corporation_role_observations (
          deployment_id, organization_version, user_id, character_id,
          source_subject_lifecycle_id, affiliation_period_revision, authority_corporation_id,
          observed_alliance_id, authorization_generation, required_scope, role_revision,
          status, validated_at, esi_fresh_until, fresh_until, next_refresh_at,
          last_checked_at, last_applied_observation_sequence
        ) values (
          1, 1, ${userId}, ${characterId}, ${lifecycleId},
          ${affiliationRevision}, ${corporationId}, ${allianceId}, 1,
          ${requiredScope}, ${roleRevision}, 'fresh', ${checkedAt}, ${freshUntil},
          ${freshUntil}, ${freshUntil}, ${checkedAt}, 1
        ) returning observation_id
      `
      const observationId = requireRow(observation).observation_id
      await transaction`
        insert into character_corporation_role_contents (
          observation_id, roles, roles_at_base, roles_at_hq, roles_at_other
        ) values (${observationId}, ARRAY['Accountant']::text[],
          ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[])
      `
    })

    const input = {
      organizationVersion: 1,
      userId,
      condition: { kind: 'corporation-role' as const, predicate: 'accountant' },
      now: checkedAt,
    }
    expect((await evaluateOrganizationRuleAccount(database, input)).outcome).toBe('unavailable')
    allianceRead.mockResolvedValueOnce(response(corporationId))
    await observeAllianceExecutor(1)
    expect((await evaluateOrganizationRuleAccount(database, input)).outcome).toBe('eligible')
    expect(await loadCorporationRoleDemand(database, characterId)).toBeNull()
    const initialExecutor = requireRow(await loadCurrentAllianceExecutor(database, 1, checkedAt))
    let ruleGroupId = ''
    await connection.begin(async (transaction) => {
      const [bundle] = await transaction<{ bundle_id: string }[]>`
        insert into organization_permission_bundles (
          deployment_id, organization_version, name, created_by_user_id
        ) values (1, 1, 'Accountant bundle', ${userId}) returning bundle_id
      `
      const currentBundleId = requireRow(bundle).bundle_id
      await transaction`
        insert into organization_permission_bundle_entries (
          bundle_id, deployment_id, organization_version, permission_type, permission_key,
          review_allowed
        ) values (${currentBundleId}, 1, 1, 'service', 'accountant.read', true)
      `
      await transaction`
        insert into organization_permission_bundle_entries (
          bundle_id, deployment_id, organization_version, permission_type, permission_key
        ) select ${currentBundleId}, 1, 1, 'service',
          'bulk.permission-' || number::text from generate_series(1, 110) as number
      `
      const [group] = await transaction<{ group_id: string }[]>`
        insert into organization_groups (
          deployment_id, organization_version, name, management_mode,
          restricted, created_by_user_id
        ) values (1, 1, 'Automatic accountants', 'rule', true, ${userId}) returning group_id
      `
      const createdGroupId = requireRow(group).group_id
      ruleGroupId = createdGroupId
      await transaction`
        insert into organization_group_rules (
          group_id, deployment_id, organization_version, revision,
          condition_kind, predicate_key, enabled, updated_by_user_id
        ) values (${createdGroupId}, 1, 1, 1, 'corporation-role', 'accountant', true, ${userId})
      `
      await transaction`
        insert into organization_group_rule_revisions (
          group_id, deployment_id, organization_version, revision,
          condition_kind, predicate_key, enabled, bundle_ids, changed_by_user_id
        ) values (
          ${createdGroupId}, 1, 1, 1, 'corporation-role', 'accountant', true,
          ${[currentBundleId]}, ${userId}
        )
      `
      await transaction`
        insert into organization_group_permission_bundles (
          group_id, bundle_id, deployment_id, organization_version
        ) values (${createdGroupId}, ${currentBundleId}, 1, 1)
      `
      await transaction`
        insert into organization_group_rule_reconciliation (
          group_id, deployment_id, organization_version, revision
        ) values (${createdGroupId}, 1, 1, 1)
      `
    })
    expect((await loadCorporationRoleDemand(database, characterId))?.consumers).toContain(
      'rule-managed',
    )
    const firstProducer = createInMemoryQueueProducer()
    const dueAt = new Date(freshUntil.getTime() - 5 * 60_000)
    expect((await runAllianceExecutorPlanner(planningContext(firstProducer), dueAt)).planned).toBe(
      1,
    )
    expect(firstProducer.commands[0]).toMatchObject({
      name: 'alliance-executor-observation',
      source: 'planner',
      notBefore: freshUntil,
    })
    const firstCommand = firstProducer.commands[0]
    if (firstCommand?.name !== 'alliance-executor-observation') {
      throw new Error('Expected an executor observation command')
    }
    const expectedRevision = firstCommand.payload.expectedRevision
    expect(await allianceExecutorRefreshDemanded(1, expectedRevision, checkedAt)).toBe(false)
    expect(await allianceExecutorRefreshDemanded(1, expectedRevision, freshUntil)).toBe(true)
    expect(await allianceExecutorRefreshDemanded(1, randomUUID(), freshUntil)).toBe(false)
    const afterQueueLoss = createInMemoryQueueProducer()
    expect((await runAllianceExecutorPlanner(planningContext(afterQueueLoss), dueAt)).planned).toBe(
      1,
    )
    const firstRuleProducer = createInMemoryQueueProducer()
    expect((await runGroupRulePlanner(planningContext(firstRuleProducer))).planned).toBe(1)
    const afterRuleQueueLoss = createInMemoryQueueProducer()
    expect((await runGroupRulePlanner(planningContext(afterRuleQueueLoss))).planned).toBe(1)
    expect(
      await runRuleGroupReconciliation({
        groupId: ruleGroupId,
        organizationVersion: 1,
        revision: 1,
        now: checkedAt,
      }),
    ).toBe('complete')
    expect((await getOrganizationGroupPermissions(userId, checkedAt, 1)).services).toContain(
      'accountant.read',
    )
    const [auditPermissions] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_rule_audit_permissions permissions
      join organization_audit_events audit on audit.audit_id = permissions.audit_id
      where audit.target_user_id = ${userId} and audit.event_type = 'group.assigned'
    `
    expect(auditPermissions?.count).toBe(111)
    await database.transaction((transaction) =>
      convergeRuleManagedGroupsForAccountInTransaction(
        transaction,
        { organizationVersion: 1, policyVersion: 1 },
        userId,
        checkedAt,
      ),
    )
    const [stable] = await connection<{ assignments: number; audits: number }[]>`
      select
        (select count(*)::integer from organization_group_assignments
          where user_id = ${userId} and assignment_source = 'rule') as assignments,
        (select count(*)::integer from organization_audit_events
          where target_user_id = ${userId} and assignment_source = 'rule') as audits
    `
    expect(stable).toStrictEqual({ assignments: 1, audits: 1 })
    await connection`
      update organization_account_compliance
      set state = 'review_required', review_deadline = ${freshUntil}
      where user_id = ${userId}
    `
    expect((await evaluateOrganizationRuleAccount(database, input)).outcome).toBe('eligible')
    expect((await getOrganizationGroupPermissions(userId, checkedAt, 1)).services).toContain(
      'accountant.read',
    )
    expect((await loadCorporationRoleDemand(database, characterId))?.consumers).toContain(
      'rule-managed',
    )
    expect(
      await selectDueCorporationRoleDemand({ database, dueBefore: freshUntil, limit: 10 }),
    ).toContainEqual(expect.objectContaining({ characterId }))
    await connection`
      update organization_account_compliance
      set state = 'compliant', review_deadline = null
      where user_id = ${userId}
    `
    let unlockRule!: () => void
    let ruleLocked!: () => void
    const ruleReleased = new Promise<void>((resolve) => {
      unlockRule = resolve
    })
    const ruleAcquired = new Promise<void>((resolve) => {
      ruleLocked = resolve
    })
    const blocker = connection.begin(async (transaction) => {
      await transaction`select group_id from organization_group_rules where group_id = ${ruleGroupId} for update`
      ruleLocked()
      await ruleReleased
    })
    await ruleAcquired
    const convergence = database.transaction((transaction) =>
      convergeRuleManagedGroupsForAccountInTransaction(
        transaction,
        { organizationVersion: 1, policyVersion: 1 },
        userId,
        checkedAt,
      ),
    )
    try {
      await vi.waitFor(async () => {
        await expect(
          connection.begin(
            (transaction) => transaction`
            select id from users where id = ${userId} for update nowait
          `,
          ),
        ).rejects.toMatchObject({ code: '55P03' })
      })
    } finally {
      unlockRule()
      await Promise.all([blocker, convergence])
    }
    await connection`update eve_tokens set token_version = 2 where character_id = ${characterId}`
    await database.transaction((transaction) =>
      advanceCharacterAuthorityAuthorizationGenerationInTransaction(transaction, {
        authorizationGeneration: 2,
        characterId,
        now: checkedAt,
      }),
    )
    const [renewedBinding] = await connection<{ authorization_generation: number }[]>`
      select authorization_generation from organization_group_rule_attestations
      where source_kind = 'corporation-role'
    `
    expect(renewedBinding?.authorization_generation).toBe(2)
    expect((await getOrganizationGroupPermissions(userId, checkedAt, 1)).services).toContain(
      'accountant.read',
    )
    const staleAt = new Date(checkedAt.getTime() + 2)
    await connection`
      update character_corporation_role_observations
      set status = 'degraded', fresh_until = ${new Date(checkedAt.getTime() + 1)},
        degraded_until = ${freshUntil}, failure_class = 'transient:esi-unavailable',
        last_checked_at = ${staleAt}, next_refresh_at = ${new Date(staleAt.getTime() + 5 * 60_000)}
      where character_id = ${characterId}
    `
    expect((await getOrganizationGroupPermissions(userId, staleAt, 1)).services).not.toContain(
      'accountant.read',
    )
    expect(
      (await evaluateOrganizationRuleAccount(database, { ...input, now: staleAt })).outcome,
    ).toBe('unavailable')
    await connection`
      update character_corporation_role_observations
      set status = 'fresh', fresh_until = ${freshUntil}, degraded_until = null,
        failure_class = null, validated_at = ${staleAt}, last_checked_at = ${staleAt},
        next_refresh_at = ${freshUntil}
      where character_id = ${characterId}
    `
    await database.transaction((transaction) =>
      convergeRuleManagedGroupsForAccountInTransaction(
        transaction,
        { organizationVersion: 1, policyVersion: 1 },
        userId,
        staleAt,
      ),
    )
    expect((await getOrganizationGroupPermissions(userId, staleAt, 1)).services).toContain(
      'accountant.read',
    )
    const [afterRevalidation] = await connection<{ audits: number }[]>`
      select count(*)::integer as audits from organization_audit_events
      where target_user_id = ${userId} and assignment_source = 'rule'
    `
    expect(afterRevalidation?.audits).toBe(1)
    allianceRead.mockResolvedValueOnce(response(98_000_002))
    await observeAllianceExecutor(1)
    expect((await evaluateOrganizationRuleAccount(database, input)).outcome).toBe('ineligible')
    expect((await getOrganizationGroupPermissions(userId, checkedAt, 1)).services).not.toContain(
      'accountant.read',
    )
    await repairAllianceExecutorRuleGroups({
      organizationVersion: 1,
      executorRevision: initialExecutor.revision,
    })
    expect((await getOrganizationGroupPermissions(userId, checkedAt, 1)).services).not.toContain(
      'accountant.read',
    )
    await database.transaction((transaction) =>
      convergeRuleManagedGroupsForAccountInTransaction(
        transaction,
        { organizationVersion: 1, policyVersion: 1 },
        userId,
        checkedAt,
      ),
    )
    const [revoked] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_group_assignments
      where user_id = ${userId} and assignment_source = 'rule' and revoked_at is not null
    `
    expect(revoked?.count).toBe(1)
    allianceRead.mockResolvedValueOnce(response(corporationId))
    await observeAllianceExecutor(1)
    expect((await loadCorporationRoleDemand(database, characterId))?.consumers).toContain(
      'rule-managed',
    )
    await database.transaction((transaction) =>
      convergeRuleManagedGroupsForAccountInTransaction(
        transaction,
        { organizationVersion: 1, policyVersion: 1 },
        userId,
        checkedAt,
      ),
    )
    expect((await getOrganizationGroupPermissions(userId, checkedAt, 1)).services).toContain(
      'accountant.read',
    )
    await database.transaction((transaction) =>
      invalidateCharacterAuthoritySourcesInTransaction(transaction, {
        characterId,
        outcome: 'authorization-revoked',
        now: checkedAt,
      }),
    )
    expect((await getOrganizationGroupPermissions(userId, checkedAt, 1)).services).not.toContain(
      'accountant.read',
    )
    const [loss] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_audit_events
      where target_user_id = ${userId} and event_type = 'group.revoked'
    `
    expect(loss?.count).toBe(2)
    await connection.begin(async (transaction) => {
      const [rule] = await transaction<{ group_id: string; revision: string }[]>`
        select group_id, revision from organization_group_rules
        where condition_kind = 'corporation-role'
      `
      const currentRuleGroupId = requireRow(rule).group_id
      await transaction`
        update organization_group_rules set revision = 2, enabled = false
        where group_id = ${currentRuleGroupId}
      `
      const [bundle] = await transaction<{ bundle_id: string }[]>`
        select bundle_id from organization_group_permission_bundles
        where group_id = ${currentRuleGroupId}
      `
      const currentBundleId = requireRow(bundle).bundle_id
      await transaction`
        insert into organization_group_rule_revisions (
          group_id, deployment_id, organization_version, revision,
          condition_kind, predicate_key, enabled, bundle_ids, changed_by_user_id
        ) values (${currentRuleGroupId}, 1, 1, 2, 'corporation-role', 'accountant', false,
          ${[currentBundleId]}, ${userId})
      `
      await transaction`
        update organization_group_rule_reconciliation
        set revision = 2, cursor_user_id = null, completed_at = null
        where group_id = ${currentRuleGroupId}
      `
    })
    expect(await loadCorporationRoleDemand(database, characterId)).toBeNull()
    expect(
      (await runAllianceExecutorPlanner(planningContext(createInMemoryQueueProducer()), dueAt))
        .planned,
    ).toBe(0)
    expect(
      await runRuleGroupReconciliation({
        groupId: ruleGroupId,
        organizationVersion: 1,
        revision: 1,
        now: checkedAt,
      }),
    ).toBe('obsolete')
  })
})
