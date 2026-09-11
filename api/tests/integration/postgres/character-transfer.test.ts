import { randomUUID } from 'node:crypto'
import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'

const ssoMocks = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  verifyAccessToken: vi.fn(),
}))

vi.mock('../../../src/auth/sso.js', () => ({
  EveSsoTokenRefreshError: class EveSsoTokenRefreshError extends Error {},
  refreshAccessToken: ssoMocks.refreshAccessToken,
  verifyAccessToken: ssoMocks.verifyAccessToken,
}))

let container: StartedTestContainer
let databaseUrl: string
let connection: postgres.Sql
let dbClient: typeof import('../../../src/db/client.js')
let dbLocks: typeof import('../../../src/db/locks.js')
let characterLifecycle: typeof import('../../../src/auth/character-lifecycle.js')
let transferApprovals: typeof import('../../../src/auth/character-transfer-approvals.js')
let characterTransfer: typeof import('../../../src/auth/character-transfer.js')
let characterTokenStore: typeof import('../../../src/auth/character-token-store.js')
let tokenService: typeof import('../../../src/auth/tokens.js')
let ownerClaim: typeof import('../../../src/organization/owner-claim.js')
let corporationSources: typeof import('../../../src/organization/corporation-sources.js')
let organizationCompliance: typeof import('../../../src/organization/compliance.js')
let groupPermissions: typeof import('../../../src/organization/group-permissions.js')
let blockStore: typeof import('../../../src/organization/block-store.js')
let adminStore: typeof import('../../../src/admin/store.js')
let collectionStateRepair: typeof import('../../../src/platform/collection-state-repair.js')
let resourceRefresh: typeof import('../../../src/platform/resource-refresh.js')
let resourceEligibility: typeof import('../../../src/platform/resource-eligibility.js')
let domainEventHandlers: typeof import('../../../src/domain-events/handlers.js')
let domainEventStore: typeof import('../../../src/domain-events/store.js')
let oauthStateStore: typeof import('../../../src/auth/oauth-state-store.js')
let security: typeof import('../../../src/auth/security.js')
const databasePassword = randomUUID()
const sourceCharacterId = 1_404_328_063
const destinationCharacterId = 2_112_625_428
const sourceAlternateCharacterId = 90_000_002
const thirdCharacterId = 90_000_003
const secondAlternateCharacterId = 90_000_004

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
  dbClient = await import('../../../src/db/client.js')
  dbLocks = await import('../../../src/db/locks.js')
  characterLifecycle = await import('../../../src/auth/character-lifecycle.js')
  transferApprovals = await import('../../../src/auth/character-transfer-approvals.js')
  characterTransfer = await import('../../../src/auth/character-transfer.js')
  characterTokenStore = await import('../../../src/auth/character-token-store.js')
  tokenService = await import('../../../src/auth/tokens.js')
  ownerClaim = await import('../../../src/organization/owner-claim.js')
  corporationSources = await import('../../../src/organization/corporation-sources.js')
  organizationCompliance = await import('../../../src/organization/compliance.js')
  groupPermissions = await import('../../../src/organization/group-permissions.js')
  blockStore = await import('../../../src/organization/block-store.js')
  adminStore = await import('../../../src/admin/store.js')
  collectionStateRepair = await import('../../../src/platform/collection-state-repair.js')
  resourceRefresh = await import('../../../src/platform/resource-refresh.js')
  resourceEligibility = await import('../../../src/platform/resource-eligibility.js')
  domainEventHandlers = await import('../../../src/domain-events/handlers.js')
  domainEventStore = await import('../../../src/domain-events/store.js')
  oauthStateStore = await import('../../../src/auth/oauth-state-store.js')
  security = await import('../../../src/auth/security.js')
})

beforeEach(async () => {
  vi.clearAllMocks()
  await connection`
    truncate character_transfer_audit, character_transfer_approvals, character_transfer_previews,
      organization_audit_events, domain_events, oauth_states, sessions, eve_tokens,
      organization_account_compliance, platform_subject_lifecycles, characters, users,
      deployment_settings, organization_epochs, admin_sessions, deployment_admins
    restart identity cascade
  `
})

afterAll(async () => {
  await dbClient?.sql.end()
  await connection?.end()
  await container?.stop()
})

describe('approved character transfer', () => {
  test('atomically transfers a sole character with fresh authorization and deletes its source', async () => {
    const administratorId = await insertDeployment()
    const sourceSession = 'source-session-token'
    const destinationSession = 'destination-session-token'
    await saveLogin(sourceCharacterId, sourceSession, 'Source Pilot')
    await saveLogin(destinationCharacterId, destinationSession, 'Destination Pilot')
    const sourceUserId = await characterUserId(sourceCharacterId)
    const destinationUserId = await characterUserId(destinationCharacterId)
    const sourceLifecycle = await characterLifecycle.findOwnedCharacter(
      sourceUserId,
      sourceCharacterId,
    )
    await characterLifecycle.attachCharacter({
      ...authorization(sourceCharacterId, 'Source Pilot', [], 'rotated-source'),
      userId: sourceUserId,
      sessionToken: sourceSession,
    })
    const [sourceTokenBefore] = await connection<
      { encrypted_tokens: string; token_version: number; scopes: string[] }[]
    >`
      select encrypted_tokens, token_version, scopes from eve_tokens
      where character_id = ${sourceCharacterId}
    `
    await insertCollectionState(
      sourceCharacterId,
      sourceLifecycle!.subjectLifecycleId,
      sourceTokenBefore!.token_version,
    )
    const { approval, secret } = await createApproval(
      administratorId,
      sourceCharacterId,
      destinationCharacterId,
    )
    await addSession(sourceUserId, 'source-secondary-session-token')
    await storeSourceOAuthStates(sourceUserId, sourceCharacterId)
    const retainedAuditId = randomUUID()
    await connection`
      insert into organization_audit_events (
        audit_id, deployment_id, organization_version, policy_version, event_type,
        actor_type, actor_id, subject_type, subject_id, reason, outcome
      ) values (
        ${retainedAuditId}, 1, 1, 1, 'role.granted', 'user', ${sourceUserId},
        'user', ${sourceUserId}, 'Retained source attribution', 'granted'
      )
    `
    await connection`delete from domain_events`

    const startBinding = await transferApprovals.loadTransferApprovalForStart({
      approvalId: approval.approvalId,
      secret,
      destinationUserId,
    })
    expect(startBinding).toEqual({
      approvalId: approval.approvalId,
      sourceUserId,
      sourceSubjectLifecycleId: sourceLifecycle!.subjectLifecycleId,
      userId: destinationUserId,
      characterId: sourceCharacterId,
    })

    const result = await characterTransfer.transferCharacter({
      approvalId: approval.approvalId,
      sourceUserId,
      sourceSubjectLifecycleId: sourceLifecycle!.subjectLifecycleId,
      destinationUserId,
      characterId: sourceCharacterId,
      destinationSessionToken: destinationSession,
      authorization: authorization(sourceCharacterId, 'Transferred Pilot', ['scope.new']),
    })

    expect(result.subjectLifecycleId).not.toBe(sourceLifecycle!.subjectLifecycleId)
    const characters = await connection<
      { character_id: string; user_id: string; is_main: boolean }[]
    >`
      select character_id, user_id, is_main from characters order by character_id
    `
    expect(characters).toEqual([
      { character_id: String(sourceCharacterId), user_id: destinationUserId, is_main: false },
      { character_id: String(destinationCharacterId), user_id: destinationUserId, is_main: true },
    ])
    const [token] = await connection<
      { encrypted_tokens: string; token_version: number; scopes: string[] }[]
    >`
      select encrypted_tokens, token_version, scopes from eve_tokens
      where character_id = ${sourceCharacterId}
    `
    expect(token?.token_version).toBe(sourceTokenBefore!.token_version + 1)
    expect(token?.scopes).toEqual(['scope.new'])
    expect(token?.encrypted_tokens).not.toBe(sourceTokenBefore?.encrypted_tokens)
    expect(security.decryptTokens(token!.encrypted_tokens)).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    })
    expect(security.decryptTokens(sourceTokenBefore!.encrypted_tokens)).toEqual({
      accessToken: 'rotated-source-access-token',
      refreshToken: 'rotated-source-refresh-token',
    })
    await expect(
      characterLifecycle.findOwnedCharacter(sourceUserId, sourceCharacterId),
    ).resolves.toBeNull()
    await expect(
      characterLifecycle.findOwnedCharacter(destinationUserId, sourceCharacterId),
    ).resolves.toMatchObject({
      subjectLifecycleId: result.subjectLifecycleId,
      isMain: false,
    })

    const [sourceUser] = await connection<{ id: string }[]>`
      select id from users where id = ${sourceUserId}
    `
    expect(sourceUser).toBeUndefined()
    await expect(findSession(sourceSession)).resolves.toBeNull()
    await expect(findSession('source-secondary-session-token')).resolves.toBeNull()
    await expect(findSession(destinationSession)).resolves.toBe(destinationUserId)
    const [pendingSourceState] = await connection<{ count: number }[]>`
      select count(*)::integer as count from oauth_states
      where user_id = ${sourceUserId} or transfer_source_user_id = ${sourceUserId}
    `
    expect(pendingSourceState?.count).toBe(0)
    const [retainedAudit] = await connection<{ actor_id: string; subject_id: string }[]>`
      select actor_id, subject_id from organization_audit_events where audit_id = ${retainedAuditId}
    `
    expect(retainedAudit).toEqual({ actor_id: sourceUserId, subject_id: sourceUserId })

    const characterEvents = await connection<
      {
        event_id: string
        event_sequence: string
        event_type: string
        payload_version: number
        aggregate_type: string
        aggregate_id: string
        payload: unknown
        occurred_at: Date
        published_at: Date | null
      }[]
    >`
      select event_id, event_sequence, event_type, payload_version, aggregate_type,
        aggregate_id, payload, occurred_at, published_at
      from domain_events
      where event_type in ('character.detached', 'character.attached')
      order by event_sequence
    `
    expect(characterEvents).toHaveLength(2)
    expect(characterEvents[0]).toMatchObject({
      event_type: 'character.detached',
      payload_version: 1,
      aggregate_type: 'character',
      aggregate_id: String(sourceCharacterId),
      payload: {
        userId: sourceUserId,
        characterId: sourceCharacterId,
        characterName: 'Source Pilot',
        corporationId: 1_000_166,
        allianceId: null,
        isMain: true,
        scopes: [],
      },
      published_at: null,
    })
    expect(characterEvents[1]).toMatchObject({
      event_type: 'character.attached',
      payload_version: 1,
      aggregate_type: 'character',
      aggregate_id: String(sourceCharacterId),
      payload: {
        userId: destinationUserId,
        characterId: sourceCharacterId,
        characterName: 'Transferred Pilot',
        corporationId: 1_000_166,
        allianceId: null,
        isMain: false,
        scopes: ['scope.new'],
      },
      published_at: null,
    })
    expect(BigInt(characterEvents[0]!.event_sequence)).toBeLessThan(
      BigInt(characterEvents[1]!.event_sequence),
    )
    expect(characterEvents[0]!.occurred_at.getTime()).toBe(
      characterEvents[1]!.occurred_at.getTime(),
    )
    await expect(
      domainEventStore.loadDomainEvent(characterEvents[0]!.event_id),
    ).resolves.toMatchObject({
      eventType: 'character.detached',
      payload: { userId: sourceUserId, characterId: sourceCharacterId },
    })
    const [consumed] = await connection<
      { consumed_by_user_id: string; new_subject_lifecycle_id: string }[]
    >`
      select consumed_by_user_id, new_subject_lifecycle_id
      from character_transfer_approvals where approval_id = ${approval.approvalId}
    `
    expect(consumed).toEqual({
      consumed_by_user_id: destinationUserId,
      new_subject_lifecycle_id: result.subjectLifecycleId,
    })
    const audit = await connection<
      { action: string; source_event_id: string | null; destination_event_id: string | null }[]
    >`
      select action, source_event_id, destination_event_id from character_transfer_audit
      where approval_id = ${approval.approvalId}
      order by occurred_at, audit_id
    `
    expect(audit.map(({ action }) => action).toSorted()).toEqual(['consumed', 'created'])
    expect(audit.find(({ action }) => action === 'consumed')).toMatchObject({
      source_event_id: characterEvents[0]!.event_id,
      destination_event_id: characterEvents[1]!.event_id,
    })

    const claims = await domainEventStore.claimPendingDomainEvents({
      limit: 100,
      claimTtlMs: 30_000,
    })
    const transferClaims = claims.filter(({ event }) =>
      characterEvents.some(({ event_id }) => event_id === event.eventId),
    )
    expect(transferClaims).toHaveLength(2)
    for (const claim of transferClaims) {
      await domainEventStore.recordDomainEventPublishFailure({
        eventId: claim.event.eventId,
        claimToken: claim.claimToken,
        category: 'queue-unavailable',
        retryDelayMs: 1_000,
      })
    }
    const failedPublications = await connection<
      { event_id: string; last_failure_category: string; published_at: Date | null }[]
    >`
      select event_id, last_failure_category, published_at from domain_events
      where event_id in (${characterEvents[0]!.event_id}, ${characterEvents[1]!.event_id})
      order by event_sequence
    `
    expect(failedPublications).toEqual([
      {
        event_id: characterEvents[0]!.event_id,
        last_failure_category: 'queue-unavailable',
        published_at: null,
      },
      {
        event_id: characterEvents[1]!.event_id,
        last_failure_category: 'queue-unavailable',
        published_at: null,
      },
    ])

    const [eventCountBeforeReplay] = await connection<{ count: number }[]>`
      select count(*)::integer as count from domain_events
    `
    for (const event of [
      characterEvents[1]!,
      characterEvents[0]!,
      characterEvents[1]!,
      characterEvents[0]!,
    ]) {
      await domainEventHandlers.dispatchDomainEvent(event.event_id)
    }
    await expect(characterUserId(sourceCharacterId)).resolves.toBe(destinationUserId)
    await expect(
      characterLifecycle.findOwnedCharacter(sourceUserId, sourceCharacterId),
    ).resolves.toBeNull()
    await expect(
      characterLifecycle.findOwnedCharacter(destinationUserId, sourceCharacterId),
    ).resolves.toMatchObject({ subjectLifecycleId: result.subjectLifecycleId, isMain: false })
    const [oldLifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
      select subject_lifecycle_id from platform_subject_lifecycles
      where subject_lifecycle_id = ${sourceLifecycle!.subjectLifecycleId}
    `
    expect(oldLifecycle).toBeUndefined()
    const [oldCollectionState] = await connection<{ count: number }[]>`
      select count(*)::integer as count from platform_collection_state
      where subject_lifecycle_id = ${sourceLifecycle!.subjectLifecycleId}
    `
    expect(oldCollectionState?.count).toBe(0)
    const [eventCountAfterReplay] = await connection<{ count: number }[]>`
      select count(*)::integer as count from domain_events
    `
    expect(eventCountAfterReplay).toEqual(eventCountBeforeReplay)

    const publicationTime = new Date(Date.now() + 60_000)
    const retentionClaims = await domainEventStore.claimPendingDomainEvents({
      limit: 100,
      claimTtlMs: 30_000,
      now: publicationTime,
    })
    const retainedTransferClaims = retentionClaims.filter(({ event }) =>
      characterEvents.some(({ event_id }) => event_id === event.eventId),
    )
    expect(retainedTransferClaims).toHaveLength(2)
    for (const claim of retainedTransferClaims) {
      await domainEventStore.markDomainEventPublished(
        claim.event.eventId,
        claim.claimToken,
        publicationTime,
      )
    }
    await expect(
      domainEventStore.deletePublishedDomainEvents({
        retentionMs: 1,
        now: new Date(publicationTime.getTime() + 2),
      }),
    ).resolves.toBe(2)
    for (const event of characterEvents)
      await expect(domainEventStore.loadDomainEvent(event.event_id)).resolves.toBeNull()
    await expect(transferAuditActions(approval.approvalId)).resolves.toEqual([
      ['created', 'created'],
      ['consumed', 'consumed'],
    ])
  })

  test('ordinary attachment cannot use a matching pending approval to transfer ownership', async () => {
    const administratorId = await insertDeployment()
    await saveLogin(sourceCharacterId, 'source-session-token', 'Source Pilot')
    await saveLogin(destinationCharacterId, 'destination-session-token', 'Destination Pilot')
    const sourceUserId = await characterUserId(sourceCharacterId)
    const destinationUserId = await characterUserId(destinationCharacterId)
    await createApproval(administratorId, sourceCharacterId, destinationCharacterId)

    await expect(
      characterLifecycle.attachCharacter({
        ...authorization(sourceCharacterId, 'Source Pilot', []),
        userId: destinationUserId,
        sessionToken: 'destination-session-token',
      }),
    ).rejects.toBeInstanceOf(characterLifecycle.CharacterTransferApprovalRequiredError)
    await expect(characterUserId(sourceCharacterId)).resolves.toBe(sourceUserId)
    const [approval] = await connection<{ consumed_at: Date | null }[]>`
      select consumed_at from character_transfer_approvals
    `
    expect(approval?.consumed_at).toBeNull()
  })

  test('transfers only a non-main character while preserving both account mains and sessions', async () => {
    const transfer = await prepareNonMainTransfer()
    await connection`delete from domain_events`

    const result = await redeemPreparedTransfer(transfer)

    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(
      transfer.destinationUserId,
    )
    await expect(
      characterLifecycle.findOwnedCharacter(transfer.sourceUserId, sourceCharacterId),
    ).resolves.toMatchObject({ isMain: true })
    await expect(
      characterLifecycle.findOwnedCharacter(transfer.destinationUserId, destinationCharacterId),
    ).resolves.toMatchObject({ isMain: true })
    await expect(
      characterLifecycle.findOwnedCharacter(transfer.sourceUserId, sourceAlternateCharacterId),
    ).resolves.toBeNull()
    await expect(findSession(transfer.sourceSession)).resolves.toBe(transfer.sourceUserId)
    await expect(findSession(transfer.destinationSession)).resolves.toBe(transfer.destinationUserId)
    expect(result.subjectLifecycleId).not.toBe(transfer.sourceSubjectLifecycleId)
    const events = await transferCharacterEvents()
    expect(events).toEqual([
      { event_type: 'character.detached', user_id: transfer.sourceUserId, is_main: false },
      { event_type: 'character.attached', user_id: transfer.destinationUserId, is_main: false },
    ])
  })

  test.each([
    ['main-character', 'main'],
    ['authority-evidence', 'authority'],
    ['corporation-source', 'source'],
  ] as const)('rechecks the %s blocker before consuming approval', async (code, blocker) => {
    const transfer = await prepareNonMainTransfer()
    if (blocker === 'main') {
      await characterLifecycle.setMainCharacter(transfer.sourceUserId, sourceAlternateCharacterId)
    } else if (blocker === 'authority') {
      await insertOwnerEvidence(transfer.sourceUserId, sourceAlternateCharacterId)
    } else {
      await insertCorporationSource(transfer.sourceUserId, sourceAlternateCharacterId)
    }
    await connection`delete from domain_events`

    await expect(redeemPreparedTransfer(transfer)).rejects.toMatchObject({ code })

    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(transfer.sourceUserId)
    await expect(
      characterLifecycle.findOwnedCharacter(transfer.sourceUserId, sourceAlternateCharacterId),
    ).resolves.toMatchObject({ subjectLifecycleId: transfer.sourceSubjectLifecycleId })
    const [approval] = await connection<{ consumed_at: Date | null }[]>`
      select consumed_at from character_transfer_approvals
      where approval_id = ${transfer.approvalId}
    `
    expect(approval?.consumed_at).toBeNull()
    const [events] = await connection<{ count: number }[]>`
      select count(*)::integer as count from domain_events
    `
    expect(events?.count).toBe(0)
  })

  test('allows revoked authority and corporation-source evidence without moving their attribution', async () => {
    const transfer = await prepareNonMainTransfer()
    const grantId = await insertOwnerEvidence(transfer.sourceUserId, sourceAlternateCharacterId)
    const sourceId = await insertCorporationSource(
      transfer.sourceUserId,
      sourceAlternateCharacterId,
    )
    await connection`
      update organization_role_grants
      set revoked_at = now(), revoked_by_user_id = ${transfer.sourceUserId},
        revocation_reason = 'Historical evidence only'
      where grant_id = ${grantId}
    `
    await connection`
      update organization_corporation_sources
      set revoked_at = now(), revoked_by_user_id = ${transfer.sourceUserId},
        revocation_reason = 'Historical source only'
      where source_id = ${sourceId}
    `

    await expect(redeemPreparedTransfer(transfer)).resolves.toMatchObject({
      subjectLifecycleId: expect.not.stringMatching(transfer.sourceSubjectLifecycleId),
    })

    const [grant] = await connection<{ user_id: string; revoked_at: Date | null }[]>`
      select user_id, revoked_at from organization_role_grants where grant_id = ${grantId}
    `
    expect(grant?.user_id).toBe(transfer.sourceUserId)
    expect(grant?.revoked_at).toBeInstanceOf(Date)
    const [historicalSource] = await connection<
      {
        character_id: string | null
        evidence_character_id: string
        registered_by_user_id: string
      }[]
    >`
      select character_id, evidence_character_id, registered_by_user_id
      from organization_corporation_sources where source_id = ${sourceId}
    `
    expect(historicalSource).toEqual({
      character_id: null,
      evidence_character_id: String(sourceAlternateCharacterId),
      registered_by_user_id: transfer.sourceUserId,
    })
    const [destinationGrant] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_role_grants
      where user_id = ${transfer.destinationUserId}
    `
    expect(destinationGrant?.count).toBe(0)
  })

  test('refreshes same-owner authorization without rotating lifecycle or emitting transfer events', async () => {
    await insertDeployment()
    await saveLogin(sourceCharacterId, 'source-session-token', 'Source Pilot')
    const sourceUserId = await characterUserId(sourceCharacterId)
    const lifecycleBefore = await characterLifecycle.findOwnedCharacter(
      sourceUserId,
      sourceCharacterId,
    )
    await connection`delete from domain_events`

    await characterLifecycle.attachCharacter({
      ...authorization(sourceCharacterId, 'Source Pilot', []),
      userId: sourceUserId,
      sessionToken: 'source-session-token',
    })

    await expect(
      characterLifecycle.findOwnedCharacter(sourceUserId, sourceCharacterId),
    ).resolves.toMatchObject({
      subjectLifecycleId: lifecycleBefore!.subjectLifecycleId,
      isMain: true,
    })
    const [events] = await connection<{ count: number }[]>`
      select count(*)::integer as count from domain_events
      where event_type in ('character.detached', 'character.attached')
    `
    expect(events?.count).toBe(0)
  })

  test.each([
    ['expired', 'preview-unavailable'],
    ['stale source lifecycle', 'preview-unavailable'],
    ['stale destination main', 'preview-stale'],
  ] as const)('refuses a transfer preview that is %s', async (scenario, code) => {
    const transfer = await prepareNonMainTransfer()
    const preview = await transferApprovals.previewCharacterTransfer({
      administratorId: transfer.administratorId,
      characterId: sourceAlternateCharacterId,
      destinationMainCharacterId: destinationCharacterId,
      reason: 'Preview binding test',
    })
    if (!preview.eligible) throw new Error(`Expected eligible preview, got ${preview.blocker}`)

    if (scenario === 'expired') {
      await connection`
        update character_transfer_previews preview
        set created_at = expired.now - interval '6 minutes',
          expires_at = expired.now - interval '1 minute'
        from (select clock_timestamp() as now) expired
        where preview_id = ${preview.previewId}
      `
    } else if (scenario === 'stale source lifecycle') {
      await characterLifecycle.deleteCharacter(
        transfer.sourceUserId,
        sourceAlternateCharacterId,
        transfer.sourceSubjectLifecycleId,
      )
      await characterLifecycle.attachCharacter({
        ...authorization(sourceAlternateCharacterId, 'Reattached Source Alt', ['scope.old']),
        userId: transfer.sourceUserId,
        sessionToken: transfer.sourceSession,
      })
    } else {
      await characterLifecycle.attachCharacter({
        ...authorization(secondAlternateCharacterId, 'Replacement Destination Main', []),
        userId: transfer.destinationUserId,
        sessionToken: transfer.destinationSession,
      })
      await characterLifecycle.setMainCharacter(
        transfer.destinationUserId,
        secondAlternateCharacterId,
      )
    }

    await expect(
      transferApprovals.createCharacterTransferApproval({
        administratorId: transfer.administratorId,
        previewId: preview.previewId,
      }),
    ).rejects.toMatchObject({ code })
  })

  test('stores only the approval secret hash and keeps reason, identity, and expiry immutable', async () => {
    const transfer = await prepareNonMainTransfer()
    const [stored] = await connection<
      {
        link_secret_hash: string
        character_id: string
        source_user_id: string
        source_subject_lifecycle_id: string
        destination_user_id: string
        approved_by_administrator_id: string
        reason: string
        created_at: Date
        expires_at: Date
      }[]
    >`
      select link_secret_hash, character_id, source_user_id, source_subject_lifecycle_id,
        destination_user_id, approved_by_administrator_id, reason, created_at, expires_at
      from character_transfer_approvals where approval_id = ${transfer.approvalId}
    `

    expect(stored).toMatchObject({
      link_secret_hash: security.hashToken(transfer.approvalSecret),
      character_id: String(sourceAlternateCharacterId),
      source_user_id: transfer.sourceUserId,
      source_subject_lifecycle_id: transfer.sourceSubjectLifecycleId,
      destination_user_id: transfer.destinationUserId,
      approved_by_administrator_id: transfer.administratorId,
      reason: 'Repair split account',
    })
    expect(stored?.link_secret_hash).not.toBe(transfer.approvalSecret)
    expect(stored!.expires_at.getTime() - stored!.created_at.getTime()).toBe(15 * 60 * 1_000)

    await expect(
      connection`
        update character_transfer_approvals set reason = 'Changed reason'
        where approval_id = ${transfer.approvalId}
      `,
    ).rejects.toThrow('character transfer approval bindings are immutable')
    await expect(
      connection`
        update character_transfer_approvals set source_user_id = ${randomUUID()}
        where approval_id = ${transfer.approvalId}
      `,
    ).rejects.toThrow('character transfer approval bindings are immutable')
    await expect(
      connection`
        update character_transfer_approvals set expires_at = expires_at + interval '1 minute'
        where approval_id = ${transfer.approvalId}
      `,
    ).rejects.toThrow('character transfer approval bindings are immutable')

    const [unchanged] = await connection`
      select link_secret_hash, character_id, source_user_id, source_subject_lifecycle_id,
        destination_user_id, approved_by_administrator_id, reason, created_at, expires_at
      from character_transfer_approvals where approval_id = ${transfer.approvalId}
    `
    expect(unchanged).toEqual(stored)
  })

  test('keeps an approval bound to its destination user after that account changes main', async () => {
    const transfer = await prepareNonMainTransfer()
    await characterLifecycle.attachCharacter({
      ...authorization(secondAlternateCharacterId, 'Replacement Destination Main', []),
      userId: transfer.destinationUserId,
      sessionToken: transfer.destinationSession,
    })
    await characterLifecycle.setMainCharacter(
      transfer.destinationUserId,
      secondAlternateCharacterId,
    )

    await expect(redeemPreparedTransfer(transfer)).resolves.toMatchObject({
      subjectLifecycleId: expect.any(String),
    })

    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(
      transfer.destinationUserId,
    )
    await expect(
      characterLifecycle.findOwnedCharacter(transfer.destinationUserId, secondAlternateCharacterId),
    ).resolves.toMatchObject({ isMain: true })
    await expect(
      characterLifecycle.findOwnedCharacter(transfer.destinationUserId, destinationCharacterId),
    ).resolves.toMatchObject({ isMain: false })
  })

  test('rolls back approval creation and revocation when their audit insert fails', async () => {
    const transfer = await prepareNonMainTransfer()
    const preview = await transferApprovals.previewCharacterTransfer({
      administratorId: transfer.administratorId,
      characterId: sourceAlternateCharacterId,
      destinationMainCharacterId: destinationCharacterId,
      reason: 'Atomic approval creation',
    })
    if (!preview.eligible) throw new Error(`Expected eligible preview, got ${preview.blocker}`)
    const [baseline] = await connection<{ approvals: number; audit: number }[]>`
      select
        (select count(*)::integer from character_transfer_approvals) as approvals,
        (select count(*)::integer from character_transfer_audit) as audit
    `

    await connection`
      alter table character_transfer_audit add constraint reject_transfer_creation_audit
      check (action <> 'created') not valid
    `
    try {
      await expect(
        transferApprovals.createCharacterTransferApproval({
          administratorId: transfer.administratorId,
          previewId: preview.previewId,
        }),
      ).rejects.toMatchObject({
        cause: { constraint_name: 'reject_transfer_creation_audit' },
      })
    } finally {
      await connection`
        alter table character_transfer_audit drop constraint reject_transfer_creation_audit
      `
    }
    const [afterCreationFailure] = await connection<
      { approvals: number; audit: number; preview: number }[]
    >`
      select
        (select count(*)::integer from character_transfer_approvals) as approvals,
        (select count(*)::integer from character_transfer_audit) as audit,
        (select count(*)::integer from character_transfer_previews
          where preview_id = ${preview.previewId}) as preview
    `
    expect(afterCreationFailure).toEqual({ ...baseline!, preview: 1 })

    await connection`
      alter table character_transfer_audit add constraint reject_transfer_revocation_audit
      check (action <> 'revoked') not valid
    `
    try {
      await expect(
        transferApprovals.revokeCharacterTransferApproval({
          administratorId: transfer.administratorId,
          approvalId: transfer.approvalId,
          reason: 'Atomic approval revocation',
        }),
      ).rejects.toMatchObject({
        cause: { constraint_name: 'reject_transfer_revocation_audit' },
      })
    } finally {
      await connection`
        alter table character_transfer_audit drop constraint reject_transfer_revocation_audit
      `
    }
    const [approval] = await connection<{ revoked_at: Date | null }[]>`
      select revoked_at from character_transfer_approvals where approval_id = ${transfer.approvalId}
    `
    expect(approval?.revoked_at).toBeNull()
    await expect(transferAuditActions(transfer.approvalId)).resolves.toEqual([
      ['created', 'created'],
    ])
  })

  test('records secret-free append-only management audit without character events', async () => {
    const transfer = await prepareNonMainTransfer()
    await connection`delete from domain_events`

    await transferApprovals.revokeCharacterTransferApproval({
      administratorId: transfer.administratorId,
      approvalId: transfer.approvalId,
      reason: 'Approval no longer needed',
    })

    await expect(transferAuditActions(transfer.approvalId)).resolves.toEqual([
      ['created', 'created'],
      ['revoked', 'revoked'],
    ])
    const auditColumns = await connection<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = current_schema() and table_name = 'character_transfer_audit'
        and column_name ~ '(secret|token|scope|oauth|session)'
    `
    expect(auditColumns).toEqual([])
    const auditRows = await connection<{ record: unknown }[]>`
      select row_to_json(audit)::jsonb as record
      from character_transfer_audit audit where approval_id = ${transfer.approvalId}
    `
    expect(JSON.stringify(auditRows)).not.toContain(transfer.approvalSecret)
    const [events] = await connection<{ count: number }[]>`
      select count(*)::integer as count from domain_events
      where event_type in ('character.detached', 'character.attached')
    `
    expect(events?.count).toBe(0)
    const [audit] = await connection<{ audit_id: string }[]>`
      select audit_id from character_transfer_audit
      where approval_id = ${transfer.approvalId} and action = 'revoked'
    `
    await expect(
      connection`
        update character_transfer_audit set reason = 'Changed'
        where audit_id = ${audit!.audit_id}
      `,
    ).rejects.toThrow('character transfer audit is append-only')
    await expect(
      connection`delete from character_transfer_audit where audit_id = ${audit!.audit_id}`,
    ).rejects.toThrow('character transfer audit is append-only')
  })

  test('retains an attributed empty source without sessions or transferred authority', async () => {
    const administratorId = await insertDeployment()
    const sourceSession = 'source-session-token'
    const destinationSession = 'destination-session-token'
    await saveLogin(sourceCharacterId, sourceSession, 'Source Pilot')
    await saveLogin(destinationCharacterId, destinationSession, 'Destination Pilot')
    const sourceUserId = await characterUserId(sourceCharacterId)
    const destinationUserId = await characterUserId(destinationCharacterId)
    const sourceLifecycle = await characterLifecycle.findOwnedCharacter(
      sourceUserId,
      sourceCharacterId,
    )
    const { approval } = await createApproval(
      administratorId,
      sourceCharacterId,
      destinationCharacterId,
    )
    await addSession(sourceUserId, 'source-secondary-session-token')
    await storeSourceOAuthStates(sourceUserId, sourceCharacterId)
    const sourceGrantId = await insertRoleGrant(sourceUserId, sourceUserId, 'hr_auditor')
    const destinationGrantId = await insertRoleGrant(
      destinationUserId,
      destinationUserId,
      'director',
    )

    await characterTransfer.transferCharacter({
      approvalId: approval.approvalId,
      sourceUserId,
      sourceSubjectLifecycleId: sourceLifecycle!.subjectLifecycleId,
      destinationUserId,
      characterId: sourceCharacterId,
      destinationSessionToken: destinationSession,
      authorization: authorization(sourceCharacterId, 'Transferred Pilot', ['scope.new']),
    })

    const [retainedSource] = await connection<{ id: string }[]>`
      select id from users where id = ${sourceUserId}
    `
    expect(retainedSource?.id).toBe(sourceUserId)
    await expect(findSession(sourceSession)).resolves.toBeNull()
    await expect(findSession('source-secondary-session-token')).resolves.toBeNull()
    await expect(findSession(destinationSession)).resolves.toBe(destinationUserId)
    const pendingStates = await connection<{ intent: string }[]>`
      select intent from oauth_states where user_id = ${sourceUserId} order by intent
    `
    expect(pendingStates).toEqual([{ intent: 'attach' }])
    const grants = await connection<
      { grant_id: string; user_id: string; granted_by_user_id: string; role: string }[]
    >`
      select grant_id, user_id, granted_by_user_id, role
      from organization_role_grants order by grant_id
    `
    expect(grants).toEqual(
      expect.arrayContaining([
        {
          grant_id: sourceGrantId,
          user_id: sourceUserId,
          granted_by_user_id: sourceUserId,
          role: 'hr_auditor',
        },
        {
          grant_id: destinationGrantId,
          user_id: destinationUserId,
          granted_by_user_id: destinationUserId,
          role: 'director',
        },
      ]),
    )
    expect(grants.filter(({ user_id }) => user_id === destinationUserId)).toHaveLength(1)
    await expect(characterUserId(sourceCharacterId)).resolves.toBe(destinationUserId)
  })

  test('rotates lifecycle and generation on transfer away and back to a prior owner', async () => {
    const transfer = await prepareNonMainTransfer()
    await characterLifecycle.attachCharacter({
      ...authorization(sourceAlternateCharacterId, 'Source Alt', ['scope.old'], 'source-rotated'),
      userId: transfer.sourceUserId,
      sessionToken: transfer.sourceSession,
    })
    const originalToken = await characterTokenStore.findCharacterTokenForLifecycle(
      sourceAlternateCharacterId,
      transfer.sourceSubjectLifecycleId,
    )
    await insertCollectionState(
      sourceAlternateCharacterId,
      transfer.sourceSubjectLifecycleId,
      originalToken!.tokenVersion,
    )
    const { approval: staleApproval } = await createApproval(
      transfer.administratorId,
      sourceAlternateCharacterId,
      destinationCharacterId,
    )

    const first = await redeemPreparedTransfer(transfer)
    const firstToken = await characterTokenStore.findCharacterTokenForLifecycle(
      sourceAlternateCharacterId,
      first.subjectLifecycleId,
    )
    const { approval: returnApproval } = await createApproval(
      transfer.administratorId,
      sourceAlternateCharacterId,
      sourceCharacterId,
    )

    const returned = await characterTransfer.transferCharacter({
      approvalId: returnApproval.approvalId,
      sourceUserId: transfer.destinationUserId,
      sourceSubjectLifecycleId: first.subjectLifecycleId,
      destinationUserId: transfer.sourceUserId,
      characterId: sourceAlternateCharacterId,
      destinationSessionToken: transfer.sourceSession,
      authorization: authorization(
        sourceAlternateCharacterId,
        'Returned Alt',
        ['scope.returned'],
        'return-callback',
      ),
    })
    const returnedToken = await characterTokenStore.findCharacterTokenForLifecycle(
      sourceAlternateCharacterId,
      returned.subjectLifecycleId,
    )

    expect(
      new Set([
        transfer.sourceSubjectLifecycleId,
        first.subjectLifecycleId,
        returned.subjectLifecycleId,
      ]),
    ).toHaveLength(3)
    expect(firstToken?.tokenVersion).toBe(originalToken!.tokenVersion + 1)
    expect(returnedToken?.tokenVersion).toBe(firstToken!.tokenVersion + 1)
    expect(security.decryptTokens(returnedToken!.encryptedTokens)).toEqual({
      accessToken: 'return-callback-access-token',
      refreshToken: 'return-callback-refresh-token',
    })
    await expect(
      characterTokenStore.findCharacterTokenForLifecycle(
        sourceAlternateCharacterId,
        transfer.sourceSubjectLifecycleId,
      ),
    ).resolves.toBeNull()
    await expect(
      characterTokenStore.findCharacterTokenForLifecycle(
        sourceAlternateCharacterId,
        first.subjectLifecycleId,
      ),
    ).resolves.toBeNull()
    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(transfer.sourceUserId)
    const [oldCollectionState] = await connection<{ count: number }[]>`
      select count(*)::integer as count from platform_collection_state
      where subject_lifecycle_id = ${transfer.sourceSubjectLifecycleId}
    `
    expect(oldCollectionState?.count).toBe(0)
    await expect(
      characterTransfer.transferCharacter({
        approvalId: staleApproval.approvalId,
        sourceUserId: transfer.sourceUserId,
        sourceSubjectLifecycleId: transfer.sourceSubjectLifecycleId,
        destinationUserId: transfer.destinationUserId,
        characterId: sourceAlternateCharacterId,
        destinationSessionToken: transfer.destinationSession,
        authorization: authorization(sourceAlternateCharacterId, 'Stale Return Proof', [
          'scope.new',
        ]),
      }),
    ).rejects.toMatchObject({ code: 'approval-unusable' })
    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(transfer.sourceUserId)
    const [stale] = await connection<{ consumed_at: Date | null }[]>`
      select consumed_at from character_transfer_approvals
      where approval_id = ${staleApproval.approvalId}
    `
    expect(stale?.consumed_at).toBeNull()
  })

  test('creates fresh lifecycle-qualified authorization when the former token is missing', async () => {
    const transfer = await prepareNonMainTransfer()
    await insertCollectionState(sourceAlternateCharacterId, transfer.sourceSubjectLifecycleId, 0)
    await connection`delete from eve_tokens where character_id = ${sourceAlternateCharacterId}`

    const result = await redeemPreparedTransfer(transfer)

    const currentToken = await characterTokenStore.findCharacterTokenForLifecycle(
      sourceAlternateCharacterId,
      result.subjectLifecycleId,
    )
    expect(result.subjectLifecycleId).not.toBe(transfer.sourceSubjectLifecycleId)
    expect(currentToken?.tokenVersion).toBe(0)
    expect(security.decryptTokens(currentToken!.encryptedTokens)).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    })
    await expect(
      characterTokenStore.findCharacterTokenForLifecycle(
        sourceAlternateCharacterId,
        transfer.sourceSubjectLifecycleId,
      ),
    ).resolves.toBeNull()
    const [oldCollectionState] = await connection<{ count: number }[]>`
      select count(*)::integer as count from platform_collection_state
      where subject_lifecycle_id = ${transfer.sourceSubjectLifecycleId}
    `
    expect(oldCollectionState?.count).toBe(0)
  })

  test('discovers the transferred lifecycle as due without transfer-event delivery', async () => {
    const transfer = await prepareNonMainTransfer()
    const requiredScope = 'esi-characters.read_freelance_jobs.v1'
    const resource = characterResourceDescriptor()
    await connection`
      insert into deployment_modules (module_id, enabled) values (${resource.moduleId}, true)
      on conflict (module_id) do update set enabled = true
    `
    await connection`delete from domain_events`

    const result = await characterTransfer.transferCharacter({
      approvalId: transfer.approvalId,
      sourceUserId: transfer.sourceUserId,
      sourceSubjectLifecycleId: transfer.sourceSubjectLifecycleId,
      destinationUserId: transfer.destinationUserId,
      characterId: sourceAlternateCharacterId,
      destinationSessionToken: transfer.destinationSession,
      authorization: authorization(sourceAlternateCharacterId, 'Transferred Alt', [requiredScope]),
    })
    await connection`delete from domain_events`

    await expect(
      collectionStateRepair.repairPlatformCollectionState({
        connection,
        resources: [resource],
        characterId: sourceAlternateCharacterId,
      }),
    ).resolves.toEqual({ repairedResources: 1 })
    await expect(
      resourceEligibility.selectDueInstalledResources({
        connection,
        resources: [resource],
        limit: 10,
      }),
    ).resolves.toEqual([
      {
        identity: {
          moduleId: resource.moduleId,
          resourceId: resource.resourceId,
          subjectKind: 'character',
          subjectLifecycleId: result.subjectLifecycleId,
          subjectId: String(sourceAlternateCharacterId),
        },
        operationId: resource.operationId,
      },
    ])
  })

  test('serializes competing destinations so exactly one approval transfers ownership', async () => {
    const transfer = await prepareNonMainTransfer()
    const thirdSession = 'third-destination-session-token'
    await saveLogin(thirdCharacterId, thirdSession, 'Third Destination')
    const thirdUserId = await characterUserId(thirdCharacterId)
    const { approval: thirdApproval } = await createApproval(
      transfer.administratorId,
      sourceAlternateCharacterId,
      thirdCharacterId,
    )
    await connection`delete from domain_events`

    const outcomes = await raceBehindCharacterLock(sourceAlternateCharacterId, [
      () => redeemPreparedTransfer(transfer),
      () =>
        characterTransfer.transferCharacter({
          approvalId: thirdApproval.approvalId,
          sourceUserId: transfer.sourceUserId,
          sourceSubjectLifecycleId: transfer.sourceSubjectLifecycleId,
          destinationUserId: thirdUserId,
          characterId: sourceAlternateCharacterId,
          destinationSessionToken: thirdSession,
          authorization: authorization(sourceAlternateCharacterId, 'Transferred Alt', [
            'scope.new',
          ]),
        }),
    ])

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({ reason: { code: 'approval-unusable' } })
    const owner = await characterUserId(sourceAlternateCharacterId)
    expect([transfer.destinationUserId, thirdUserId]).toContain(owner)
    const approvals = await connection<{ approval_id: string; consumed_at: Date | null }[]>`
      select approval_id, consumed_at from character_transfer_approvals
      where approval_id in (${transfer.approvalId}, ${thirdApproval.approvalId})
    `
    expect(approvals.filter(({ consumed_at }) => consumed_at !== null)).toHaveLength(1)
    const losingApproval = approvals.find(({ consumed_at }) => consumed_at === null)
    const losingDestinationIsThird = losingApproval?.approval_id === thirdApproval.approvalId
    await expect(
      characterTransfer.transferCharacter({
        approvalId: losingApproval!.approval_id,
        sourceUserId: transfer.sourceUserId,
        sourceSubjectLifecycleId: transfer.sourceSubjectLifecycleId,
        destinationUserId: losingDestinationIsThird ? thirdUserId : transfer.destinationUserId,
        characterId: sourceAlternateCharacterId,
        destinationSessionToken: losingDestinationIsThird
          ? thirdSession
          : transfer.destinationSession,
        authorization: authorization(sourceAlternateCharacterId, 'Losing Approval Proof', [
          'scope.new',
        ]),
      }),
    ).rejects.toMatchObject({ code: 'approval-unusable' })
    const [stillPending] = await connection<{ consumed_at: Date | null }[]>`
      select consumed_at from character_transfer_approvals
      where approval_id = ${losingApproval!.approval_id}
    `
    expect(stillPending?.consumed_at).toBeNull()
    await assertCharacterAccountInvariants()
  })

  test('allows exactly one of two valid callbacks to consume one approval', async () => {
    const transfer = await prepareNonMainTransfer()
    await connection`delete from domain_events`

    const outcomes = await raceBehindCharacterLock(sourceAlternateCharacterId, [
      () => redeemPreparedTransfer(transfer),
      () => redeemPreparedTransfer(transfer),
    ])

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'approval-unusable' }) }),
    ])
    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(
      transfer.destinationUserId,
    )
    const [terminal] = await connection<
      { consumed: number; consumed_audit: number; events: number }[]
    >`
      select
        (select count(*)::integer from character_transfer_approvals
          where approval_id = ${transfer.approvalId} and consumed_at is not null) as consumed,
        (select count(*)::integer from character_transfer_audit
          where approval_id = ${transfer.approvalId} and action = 'consumed') as consumed_audit,
        (select count(*)::integer from domain_events
          where event_type in ('character.detached', 'character.attached')) as events
    `
    expect(terminal).toEqual({ consumed: 1, consumed_audit: 1, events: 2 })
    await assertCharacterAccountInvariants()
  })

  test('serializes approval revocation with redemption in deterministic lock order', async () => {
    const transfer = await prepareNonMainTransfer()
    const characterHolder = postgres(databaseUrl, { max: 1 })
    let characterLockHeld = false
    let firstRedemption: Promise<unknown> | undefined
    try {
      await characterHolder`
        select pg_advisory_lock(
          ${dbLocks.characterLockNamespace},
          ${dbLocks.characterLockKey(sourceAlternateCharacterId)}
        )
      `
      characterLockHeld = true
      firstRedemption = redeemPreparedTransfer(transfer)
      await waitForBlockedDatabaseOperations(1)

      await expect(
        transferApprovals.revokeCharacterTransferApproval({
          administratorId: transfer.administratorId,
          approvalId: transfer.approvalId,
          reason: 'Revocation won the lock order',
        }),
      ).resolves.toMatchObject({ status: 'revoked' })
      await characterHolder`
        select pg_advisory_unlock(
          ${dbLocks.characterLockNamespace},
          ${dbLocks.characterLockKey(sourceAlternateCharacterId)}
        )
      `
      characterLockHeld = false
      await expect(firstRedemption).rejects.toMatchObject({ code: 'approval-unusable' })
    } finally {
      if (characterLockHeld)
        await characterHolder`
          select pg_advisory_unlock(
            ${dbLocks.characterLockNamespace},
            ${dbLocks.characterLockKey(sourceAlternateCharacterId)}
          )
        `
      await Promise.allSettled(firstRedemption ? [firstRedemption] : [])
      await characterHolder.end()
    }

    const { approval: replacement } = await createApproval(
      transfer.administratorId,
      sourceAlternateCharacterId,
      destinationCharacterId,
    )
    const authorityHolder = postgres(databaseUrl, { max: 1 })
    let authorityTransactionOpen = false
    let secondRedemption: Promise<unknown> | undefined
    let revocation: Promise<unknown> | undefined
    try {
      await authorityHolder`begin`
      authorityTransactionOpen = true
      await authorityHolder`
        select id from deployment_installation_settings where id = 1 for update
      `
      secondRedemption = redeemPreparedTransfer({ ...transfer, approvalId: replacement.approvalId })
      await waitForBlockedDatabaseOperations(1)
      revocation = transferApprovals.revokeCharacterTransferApproval({
        administratorId: transfer.administratorId,
        approvalId: replacement.approvalId,
        reason: 'Redemption already owns approval lock',
      })
      await waitForBlockedDatabaseOperations(2)
      await authorityHolder`commit`
      authorityTransactionOpen = false

      await expect(secondRedemption).resolves.toMatchObject({
        subjectLifecycleId: expect.any(String),
      })
      await expect(revocation).rejects.toMatchObject({ code: 'approval-consumed' })
    } finally {
      if (authorityTransactionOpen) await authorityHolder`rollback`
      await Promise.allSettled([
        ...(secondRedemption ? [secondRedemption] : []),
        ...(revocation ? [revocation] : []),
      ])
      await authorityHolder.end()
    }

    await expect(transferAuditActions(transfer.approvalId)).resolves.toEqual([
      ['created', 'created'],
      ['revoked', 'revoked'],
    ])
    await expect(transferAuditActions(replacement.approvalId)).resolves.toEqual([
      ['created', 'created'],
      ['consumed', 'consumed'],
    ])
  })

  test('rejects an approval that expires by database time while redemption waits on a lock', async () => {
    const transfer = await prepareNonMainTransfer()
    const holder = postgres(databaseUrl, { max: 1 })
    const expirationWriter = postgres(databaseUrl, { max: 1 })
    let lockHeld = false
    let redemption: Promise<unknown> | undefined
    try {
      const [holderBackend] = await holder<{ pid: number }[]>`
        select pg_backend_pid()::integer as pid
      `
      await holder`
        select pg_advisory_lock(
          ${dbLocks.characterLockNamespace},
          ${dbLocks.characterLockKey(sourceAlternateCharacterId)}
        )
      `
      lockHeld = true
      redemption = redeemPreparedTransfer(transfer)
      const blocked = await waitForBlockedDatabaseOperation(holderBackend!.pid)

      // Move only the fixture's immutable clock boundary to just after the waiting transaction began.
      await expirationWriter`set session_replication_role = replica`
      try {
        await expirationWriter`
          update character_transfer_approvals approval
          set created_at = activity.xact_start - interval '15 minutes' + interval '1 microsecond',
            expires_at = activity.xact_start + interval '1 microsecond'
          from pg_stat_activity activity
          where approval.approval_id = ${transfer.approvalId} and activity.pid = ${blocked.pid}
        `
      } finally {
        await expirationWriter`set session_replication_role = origin`
      }
      const [clockBoundary] = await connection<
        { transaction_started_before_expiry: boolean; database_clock_expired: boolean }[]
      >`
        select activity.xact_start < approval.expires_at as transaction_started_before_expiry,
          clock_timestamp() >= approval.expires_at as database_clock_expired
        from character_transfer_approvals approval
        join pg_stat_activity activity on activity.pid = ${blocked.pid}
        where approval.approval_id = ${transfer.approvalId}
      `
      expect(clockBoundary).toEqual({
        transaction_started_before_expiry: true,
        database_clock_expired: true,
      })

      await holder`
        select pg_advisory_unlock(
          ${dbLocks.characterLockNamespace},
          ${dbLocks.characterLockKey(sourceAlternateCharacterId)}
        )
      `
      lockHeld = false
      await expect(redemption).rejects.toMatchObject({ code: 'approval-unusable' })
    } finally {
      if (lockHeld)
        await holder`
          select pg_advisory_unlock(
            ${dbLocks.characterLockNamespace},
            ${dbLocks.characterLockKey(sourceAlternateCharacterId)}
          )
        `
      await Promise.allSettled(redemption ? [redemption] : [])
      await expirationWriter.end()
      await holder.end()
    }

    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(transfer.sourceUserId)
    await expect(transferAuditActions(transfer.approvalId)).resolves.toEqual([
      ['created', 'created'],
    ])
  })

  test('rejects redemption when installation administrator authority is removed in flight', async () => {
    const transfer = await prepareNonMainTransfer()
    const holder = postgres(databaseUrl, { max: 1 })
    const authorityWriter = postgres(databaseUrl, { max: 1 })
    let lockHeld = false
    let redemption: Promise<unknown> | undefined
    try {
      await holder`
        select pg_advisory_lock(
          ${dbLocks.characterLockNamespace},
          ${dbLocks.characterLockKey(sourceAlternateCharacterId)}
        )
      `
      lockHeld = true
      redemption = redeemPreparedTransfer(transfer)
      await waitForBlockedDatabaseOperations(1)

      await authorityWriter`
        update deployment_installation_settings set owner_admin_id = null where id = 1
      `
      await authorityWriter`delete from deployment_admins where id = ${transfer.administratorId}`
      await holder`
        select pg_advisory_unlock(
          ${dbLocks.characterLockNamespace},
          ${dbLocks.characterLockKey(sourceAlternateCharacterId)}
        )
      `
      lockHeld = false
      await expect(redemption).rejects.toMatchObject({ code: 'approval-unusable' })
    } finally {
      if (lockHeld)
        await holder`
          select pg_advisory_unlock(
            ${dbLocks.characterLockNamespace},
            ${dbLocks.characterLockKey(sourceAlternateCharacterId)}
          )
        `
      await Promise.allSettled(redemption ? [redemption] : [])
      await authorityWriter.end()
      await holder.end()
    }

    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(transfer.sourceUserId)
    const [approval] = await connection<{ consumed_at: Date | null }[]>`
      select consumed_at from character_transfer_approvals where approval_id = ${transfer.approvalId}
    `
    expect(approval?.consumed_at).toBeNull()
  })

  test('serializes opposite-direction transfers in stable account-lock order', async () => {
    const transfer = await prepareNonMainTransfer()
    await characterLifecycle.attachCharacter({
      ...authorization(secondAlternateCharacterId, 'Destination Alt', ['scope.old']),
      userId: transfer.destinationUserId,
      sessionToken: transfer.destinationSession,
    })
    const oppositeSource = await characterLifecycle.findOwnedCharacter(
      transfer.destinationUserId,
      secondAlternateCharacterId,
    )
    const { approval: oppositeApproval } = await createApproval(
      transfer.administratorId,
      secondAlternateCharacterId,
      sourceCharacterId,
    )
    await connection`delete from domain_events`

    const outcomes = await raceBehindUserTableLock([
      () => redeemPreparedTransfer(transfer),
      () =>
        characterTransfer.transferCharacter({
          approvalId: oppositeApproval.approvalId,
          sourceUserId: transfer.destinationUserId,
          sourceSubjectLifecycleId: oppositeSource!.subjectLifecycleId,
          destinationUserId: transfer.sourceUserId,
          characterId: secondAlternateCharacterId,
          destinationSessionToken: transfer.sourceSession,
          authorization: authorization(secondAlternateCharacterId, 'Returned Destination Alt', [
            'scope.new',
          ]),
        }),
    ])

    expect(outcomes.every(({ status }) => status === 'fulfilled')).toBe(true)
    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(
      transfer.destinationUserId,
    )
    await expect(characterUserId(secondAlternateCharacterId)).resolves.toBe(transfer.sourceUserId)
    const [events] = await connection<{ count: number }[]>`
      select count(*)::integer as count from domain_events
      where event_type in ('character.detached', 'character.attached')
    `
    expect(events?.count).toBe(4)
    await assertCharacterAccountInvariants()
  })

  test('serializes transfer against source main selection', async () => {
    const transfer = await prepareNonMainTransfer()
    await connection`delete from domain_events`

    const [transferOutcome, mainOutcome] = await raceBehindUserTableLock([
      () => redeemPreparedTransfer(transfer),
      () => characterLifecycle.setMainCharacter(transfer.sourceUserId, sourceAlternateCharacterId),
    ])

    const transferSucceeded = transferOutcome!.status === 'fulfilled'
    const characterOwner = await characterUserId(sourceAlternateCharacterId)
    expect(transferOutcome).toMatchObject(
      transferSucceeded
        ? { status: 'fulfilled' }
        : { status: 'rejected', reason: { code: 'main-character' } },
    )
    expect(mainOutcome).toMatchObject(
      transferSucceeded
        ? { status: 'fulfilled', value: null }
        : {
            status: 'fulfilled',
            value: { characterId: sourceAlternateCharacterId, isMain: true },
          },
    )
    expect(characterOwner).toBe(
      transferSucceeded ? transfer.destinationUserId : transfer.sourceUserId,
    )
    await assertCharacterAccountInvariants()
  })

  test('serializes transfer against deletion of the approved lifecycle', async () => {
    const transfer = await prepareNonMainTransfer()
    await connection`delete from domain_events`

    const [transferOutcome, deletionOutcome] = await raceBehindCharacterLock(
      sourceAlternateCharacterId,
      [
        () => redeemPreparedTransfer(transfer),
        () =>
          characterLifecycle.deleteCharacter(
            transfer.sourceUserId,
            sourceAlternateCharacterId,
            transfer.sourceSubjectLifecycleId,
          ),
      ],
    )

    const transferSucceeded = transferOutcome!.status === 'fulfilled'
    const characterOwner = await optionalCharacterUserId(sourceAlternateCharacterId)
    expect(transferOutcome).toMatchObject(
      transferSucceeded
        ? { status: 'fulfilled' }
        : { status: 'rejected', reason: { code: 'approval-unusable' } },
    )
    expect(deletionOutcome).toMatchObject({
      status: 'fulfilled',
      value: transferSucceeded ? 'not-found' : 'deleted',
    })
    expect(characterOwner).toBe(transferSucceeded ? transfer.destinationUserId : null)
    await assertCharacterAccountInvariants()
  })

  test.each(['source', 'destination'] as const)(
    'keeps an approval unusable when its %s account is missing',
    async (missingAccount) => {
      const transfer = await prepareNonMainTransfer()
      await connection`delete from domain_events`
      await connection`
        delete from users
        where id = ${
          missingAccount === 'source' ? transfer.sourceUserId : transfer.destinationUserId
        }
      `

      await expect(redeemPreparedTransfer(transfer)).rejects.toMatchObject({
        code: 'approval-unusable',
      })

      const [approval] = await connection<{ consumed_at: Date | null }[]>`
        select consumed_at from character_transfer_approvals
        where approval_id = ${transfer.approvalId}
      `
      expect(approval?.consumed_at).toBeNull()
      const [events] = await connection<{ count: number }[]>`
        select count(*)::integer as count from domain_events
      `
      expect(events?.count).toBe(0)
    },
  )

  test('serializes transfer and login without replacing the transfer lifecycle', async () => {
    const transfer = await prepareNonMainTransfer()
    await connection`delete from domain_events`
    const loginSession = 'concurrent-login-session-token'

    const [transferOutcome, loginOutcome] = await raceBehindCharacterLock(
      sourceAlternateCharacterId,
      [
        () => redeemPreparedTransfer(transfer),
        () =>
          characterLifecycle.saveLogin({
            ...authorization(
              sourceAlternateCharacterId,
              'Concurrent Login Alt',
              ['scope.new'],
              'concurrent-login',
            ),
            sessionToken: loginSession,
            sessionExpiresAt: new Date(Date.now() + 60_000),
          }),
      ],
    )

    expect(transferOutcome?.status).toBe('fulfilled')
    expect(loginOutcome?.status).toBe('fulfilled')
    const transferResult = transferOutcome as PromiseFulfilledResult<{ subjectLifecycleId: string }>
    await expect(
      characterLifecycle.findOwnedCharacter(transfer.destinationUserId, sourceAlternateCharacterId),
    ).resolves.toMatchObject({ subjectLifecycleId: transferResult.value.subjectLifecycleId })
    const loginOwner = await findSession(loginSession)
    expect([transfer.sourceUserId, transfer.destinationUserId]).toContain(loginOwner)
    const token = await characterTokenStore.findCharacterTokenForLifecycle(
      sourceAlternateCharacterId,
      transferResult.value.subjectLifecycleId,
    )
    expect(token?.tokenVersion).toBe(2)
    expect(['new-access-token', 'concurrent-login-access-token']).toContain(
      security.decryptTokens(token!.encryptedTokens).accessToken,
    )
    const [events] = await connection<{ count: number }[]>`
      select count(*)::integer as count from domain_events
      where event_type in ('character.detached', 'character.attached')
    `
    expect(events?.count).toBe(2)
    await assertCharacterAccountInvariants()
  })

  test('serializes incoming transfer against destination losing its last character', async () => {
    const transfer = await prepareNonMainTransfer()
    const thirdSession = 'third-destination-session-token'
    await saveLogin(thirdCharacterId, thirdSession, 'Third Destination')
    const thirdUserId = await characterUserId(thirdCharacterId)
    const destinationLifecycle = await characterLifecycle.findOwnedCharacter(
      transfer.destinationUserId,
      destinationCharacterId,
    )
    const { approval: outgoingApproval } = await createApproval(
      transfer.administratorId,
      destinationCharacterId,
      thirdCharacterId,
    )
    await connection`delete from domain_events`

    const [incoming, outgoing] = await raceBehindUserTableLock([
      () => redeemPreparedTransfer(transfer),
      () =>
        characterTransfer.transferCharacter({
          approvalId: outgoingApproval.approvalId,
          sourceUserId: transfer.destinationUserId,
          sourceSubjectLifecycleId: destinationLifecycle!.subjectLifecycleId,
          destinationUserId: thirdUserId,
          characterId: destinationCharacterId,
          destinationSessionToken: thirdSession,
          authorization: authorization(destinationCharacterId, 'Moved Destination Main', [
            'scope.new',
          ]),
        }),
    ])

    expect([incoming?.status, outgoing?.status].toSorted()).toEqual(['fulfilled', 'rejected'])
    const incomingSucceeded = incoming!.status === 'fulfilled'
    const failedTransfer = incomingSucceeded ? outgoing : incoming
    const actualOwnerIds = await Promise.all([
      characterUserId(sourceAlternateCharacterId),
      ...(incomingSucceeded ? [] : [characterUserId(destinationCharacterId)]),
    ])
    expect(failedTransfer).toMatchObject({
      status: 'rejected',
      reason: { code: incomingSucceeded ? 'main-character' : 'approval-unusable' },
    })
    expect(actualOwnerIds).toEqual(
      incomingSucceeded ? [transfer.destinationUserId] : [transfer.sourceUserId, thirdUserId],
    )
    await assertCharacterAccountInvariants()
  })

  test('lets an in-flight old-owner token refresh commit only before transfer replaces it', async () => {
    const transfer = await prepareNonMainTransfer()
    await connection`
      update eve_tokens set access_token_expires_at = now() - interval '1 minute'
      where character_id = ${sourceAlternateCharacterId}
    `
    const refreshStarted = deferred<void>()
    const releaseRefresh = deferred<void>()
    ssoMocks.refreshAccessToken.mockImplementation(async () => {
      refreshStarted.resolve()
      await releaseRefresh.promise
      return {
        access_token: 'late-refresh-access',
        refresh_token: 'late-refresh-token',
        expires_in: 1_200,
        token_type: 'Bearer',
      }
    })
    ssoMocks.verifyAccessToken.mockResolvedValue({
      characterId: sourceAlternateCharacterId,
      characterName: 'Source Alt',
      scopes: ['scope.old'],
    })

    const refresh = tokenService.getCharacterAuthorizationForLifecycle(
      sourceAlternateCharacterId,
      transfer.sourceSubjectLifecycleId,
      'scope.old',
    )
    await refreshStarted.promise
    const redemption = redeemPreparedTransfer(transfer)
    await waitForBlockedDatabaseOperations(1)
    releaseRefresh.resolve()

    await expect(refresh).resolves.toMatchObject({ accessToken: 'late-refresh-access' })
    const transferred = await redemption
    const current = await characterTokenStore.findCharacterTokenForLifecycle(
      sourceAlternateCharacterId,
      transferred.subjectLifecycleId,
    )
    expect(current?.tokenVersion).toBe(2)
    expect(security.decryptTokens(current!.encryptedTokens).accessToken).toBe('new-access-token')
    await expect(
      characterTokenStore.findCharacterTokenForLifecycle(
        sourceAlternateCharacterId,
        transfer.sourceSubjectLifecycleId,
      ),
    ).resolves.toBeNull()
  })

  test('rejects an old-lifecycle refresh before SSO when transfer owns the character lock', async () => {
    const transfer = await prepareNonMainTransfer()
    await connection`
      update eve_tokens set access_token_expires_at = now() - interval '1 minute'
      where character_id = ${sourceAlternateCharacterId}
    `
    const holder = postgres(databaseUrl, { max: 1 })
    await holder`begin`
    await holder`select id from deployment_settings where id = 1 for update`
    try {
      const redemption = redeemPreparedTransfer(transfer)
      await waitForBlockedDatabaseOperations(1)
      const refresh = tokenService.getCharacterAuthorizationForLifecycle(
        sourceAlternateCharacterId,
        transfer.sourceSubjectLifecycleId,
        'scope.old',
      )
      await waitForBlockedDatabaseOperations(2)
      await holder`commit`

      const transferred = await redemption
      await expect(refresh).rejects.toBeInstanceOf(characterTokenStore.CharacterTokenNotFoundError)
      expect(ssoMocks.refreshAccessToken).not.toHaveBeenCalled()
      const current = await characterTokenStore.findCharacterTokenForLifecycle(
        sourceAlternateCharacterId,
        transferred.subjectLifecycleId,
      )
      expect(security.decryptTokens(current!.encryptedTokens).accessToken).toBe('new-access-token')
    } finally {
      await holder`rollback`
      await holder.end()
    }
  })

  test('serializes production owner-evidence creation with transfer revalidation', async () => {
    const transfer = await prepareNonMainTransfer()
    const ownerScope = 'esi-characters.read_corporation_roles.v1'
    await characterLifecycle.attachCharacter({
      ...authorization(sourceAlternateCharacterId, 'Source Alt', [ownerScope]),
      userId: transfer.sourceUserId,
      sessionToken: transfer.sourceSession,
    })

    const [claim, redemption] = await raceBehindDeploymentSettingsLock([
      () =>
        ownerClaim.claimOrganizationOwnership({
          userId: transfer.sourceUserId,
          characterId: sourceAlternateCharacterId,
          subjectLifecycleId: transfer.sourceSubjectLifecycleId,
          organizationId: 1_000_166,
          organizationVersion: 1,
          authorityCorporationId: 1_000_166,
          observedCorporationId: 1_000_166,
          observedAllianceId: null,
          affiliationCheckedAt: new Date(0),
          requiredScope: ownerScope,
        }),
      () => redeemPreparedTransfer(transfer),
    ])

    expect([claim?.status, redemption?.status].toSorted()).toEqual(['fulfilled', 'rejected'])
    const claimSucceeded = claim!.status === 'fulfilled'
    const failedOperation = claimSucceeded ? redemption : claim
    const characterOwner = await characterUserId(sourceAlternateCharacterId)
    expect(failedOperation).toMatchObject({
      status: 'rejected',
      reason: { code: claimSucceeded ? 'authority-evidence' : 'character-not-owned' },
    })
    expect(characterOwner).toBe(claimSucceeded ? transfer.sourceUserId : transfer.destinationUserId)
    const evidence = await connection<{ user_id: string; character_id: number }[]>`
      select user_id, character_id::integer as character_id
      from organization_authority_evidence
    `
    expect(evidence).toEqual(
      claim!.status === 'fulfilled'
        ? [{ user_id: transfer.sourceUserId, character_id: sourceAlternateCharacterId }]
        : [],
    )
    await assertCharacterAccountInvariants()
  })

  test('serializes production corporation-source creation with transfer revalidation', async () => {
    const transfer = await prepareNonMainTransfer()
    await prepareCorporationSourceCandidate(transfer, sourceAlternateCharacterId)

    const [registration, redemption] = await raceBehindDeploymentSettingsLock([
      () =>
        corporationSources.registerOrganizationCorporationSource({
          actorUserId: transfer.sourceUserId,
          corporationId: 1_000_166,
          characterId: sourceAlternateCharacterId,
        }),
      () => redeemPreparedTransfer(transfer),
    ])

    expect([registration?.status, redemption?.status].toSorted()).toEqual(['fulfilled', 'rejected'])
    const registrationSucceeded = registration!.status === 'fulfilled'
    const failedOperation = registrationSucceeded ? redemption : registration
    expect(failedOperation).toMatchObject({
      status: 'rejected',
      reason: {
        code: registrationSucceeded ? 'corporation-source' : 'source-character-ineligible',
      },
    })
    const activeSources = await connection<
      { character_id: number; registered_by_user_id: string }[]
    >`
      select character_id::integer as character_id, registered_by_user_id
      from organization_corporation_sources where revoked_at is null
    `
    expect(activeSources).toEqual(
      registration!.status === 'fulfilled'
        ? [
            {
              character_id: sourceAlternateCharacterId,
              registered_by_user_id: transfer.sourceUserId,
            },
          ]
        : [],
    )
    await assertCharacterAccountInvariants()
  })

  test('allows transfer only after production source replacement revokes the blocker', async () => {
    const transfer = await prepareNonMainTransfer()
    await prepareCorporationSourceCandidate(transfer, sourceAlternateCharacterId)
    const original = await corporationSources.registerOrganizationCorporationSource({
      actorUserId: transfer.sourceUserId,
      corporationId: 1_000_166,
      characterId: sourceAlternateCharacterId,
    })
    await prepareCorporationSourceCandidate(transfer, sourceCharacterId)

    const [replacement, redemption] = await raceBehindDeploymentSettingsLock([
      () =>
        corporationSources.registerOrganizationCorporationSource({
          actorUserId: transfer.sourceUserId,
          corporationId: 1_000_166,
          characterId: sourceCharacterId,
        }),
      () => redeemPreparedTransfer(transfer),
    ])

    expect(replacement?.status).toBe('fulfilled')
    const redemptionSucceeded = redemption!.status === 'fulfilled'
    const redemptionResult = {
      characterOwner: redemptionSucceeded
        ? await characterUserId(sourceAlternateCharacterId)
        : null,
      failureCode: redemptionSucceeded ? null : redemption!.reason.code,
    }
    expect(redemptionResult).toEqual(
      redemptionSucceeded
        ? { characterOwner: transfer.destinationUserId, failureCode: null }
        : { characterOwner: null, failureCode: 'corporation-source' },
    )
    const sources = await connection<
      {
        source_id: string
        character_id: number | null
        evidence_character_id: number
        registered_by_user_id: string
        revoked_at: Date | null
      }[]
    >`
      select source_id, character_id::integer as character_id,
        evidence_character_id::integer as evidence_character_id,
        registered_by_user_id, revoked_at
      from organization_corporation_sources order by registered_at
    `
    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({
      source_id: original.source.sourceId,
      evidence_character_id: sourceAlternateCharacterId,
      registered_by_user_id: transfer.sourceUserId,
      revoked_at: expect.any(Date),
    })
    expect(sources[1]).toMatchObject({
      character_id: sourceCharacterId,
      evidence_character_id: sourceCharacterId,
      registered_by_user_id: transfer.sourceUserId,
      revoked_at: null,
    })
    await assertCharacterAccountInvariants()
  })

  test('serializes organization epoch changes with transfer compliance recomputation', async () => {
    const transfer = await prepareNonMainTransfer()

    const [redemption, organizationChange] = await raceBehindDeploymentSettingsLock([
      () => redeemPreparedTransfer(transfer),
      () =>
        adminStore.updateDeploymentOrganization(
          { type: 'corporation', id: 98_000_002, name: 'Second Corporation', ticker: 'TWO' },
          transfer.administratorId,
        ),
    ])

    expect(redemption).toMatchObject({ status: 'fulfilled' })
    expect(organizationChange?.status).toBe('fulfilled')
    const [settings] = await connection<{ organization_version: number }[]>`
      select organization_version::integer as organization_version
      from deployment_settings where id = 1
    `
    expect(settings?.organization_version).toBe(2)
    const [projections] = await connection<
      { old_authoritative: number; current_authoritative: number }[]
    >`
      select
        count(*) filter (where organization_version = 1 and authoritative)::integer
          as old_authoritative,
        count(*) filter (where organization_version = 2 and authoritative)::integer
          as current_authoritative
      from organization_account_compliance
    `
    expect(projections).toEqual({ old_authoritative: 0, current_authoritative: 2 })
    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(
      transfer.destinationUserId,
    )
    await assertCharacterAccountInvariants()
  })

  test('transfers without organization configuration or organization side effects', async () => {
    const administratorId = await insertAdministrator()
    const administratorSession = 'unconfigured-administrator-session'
    await adminStore.createAdminSession(
      administratorId,
      administratorSession,
      new Date(Date.now() + 60_000),
    )
    await expect(adminStore.findAdminSession(administratorSession)).resolves.toMatchObject({
      adminId: administratorId,
      organization: null,
    })
    const sourceSession = 'unconfigured-source-session'
    const destinationSession = 'unconfigured-destination-session'
    await saveLogin(sourceCharacterId, sourceSession, 'Source Pilot')
    const sourceUserId = await characterUserId(sourceCharacterId)
    await characterLifecycle.attachCharacter({
      ...authorization(sourceAlternateCharacterId, 'Source Alt', ['scope.old']),
      userId: sourceUserId,
      sessionToken: sourceSession,
    })
    await saveLogin(destinationCharacterId, destinationSession, 'Destination Pilot')
    const destinationUserId = await characterUserId(destinationCharacterId)
    const source = await characterLifecycle.findOwnedCharacter(
      sourceUserId,
      sourceAlternateCharacterId,
    )
    const { approval } = await createApproval(
      administratorId,
      sourceAlternateCharacterId,
      destinationCharacterId,
    )

    await characterTransfer.transferCharacter({
      approvalId: approval.approvalId,
      sourceUserId,
      sourceSubjectLifecycleId: source!.subjectLifecycleId,
      destinationUserId,
      characterId: sourceAlternateCharacterId,
      destinationSessionToken: destinationSession,
      authorization: authorization(sourceAlternateCharacterId, 'Transferred Alt', ['scope.new']),
    })

    await expect(characterUserId(sourceAlternateCharacterId)).resolves.toBe(destinationUserId)
    const [effects] = await connection<
      { compliance: number; assignments: number; organization_audit: number }[]
    >`
      select
        (select count(*)::integer from organization_account_compliance) as compliance,
        (select count(*)::integer from organization_group_assignments) as assignments,
        (select count(*)::integer from organization_audit_events) as organization_audit
    `
    expect(effects).toEqual({ compliance: 0, assignments: 0, organization_audit: 0 })
    await expect(transferAuditActions(approval.approvalId)).resolves.toEqual([
      ['created', 'created'],
      ['consumed', 'consumed'],
    ])
  })

  test('revokes source compliance group and entitlement when its final character transfers', async () => {
    const administratorId = await insertDeployment()
    const sourceSession = 'compliance-source-session'
    const destinationSession = 'compliance-destination-session'
    await saveLogin(sourceCharacterId, sourceSession, 'Source Pilot')
    await saveLogin(destinationCharacterId, destinationSession, 'Destination Pilot')
    const sourceUserId = await characterUserId(sourceCharacterId)
    const destinationUserId = await characterUserId(destinationCharacterId)
    const source = await characterLifecycle.findOwnedCharacter(sourceUserId, sourceCharacterId)
    const { approval } = await createApproval(
      administratorId,
      sourceCharacterId,
      destinationCharacterId,
    )
    await insertRoleGrant(sourceUserId, destinationUserId, 'hr_auditor')
    const { groupId, auditSequence } = await configureTransferCompliance(
      sourceUserId,
      destinationUserId,
    )

    await characterTransfer.transferCharacter({
      approvalId: approval.approvalId,
      sourceUserId,
      sourceSubjectLifecycleId: source!.subjectLifecycleId,
      destinationUserId,
      characterId: sourceCharacterId,
      destinationSessionToken: destinationSession,
      authorization: authorization(sourceCharacterId, 'Transferred Pilot', []),
    })

    await expect(complianceState(sourceUserId)).resolves.toMatchObject({
      state: 'pending',
      evidence_freshness: 'unavailable',
      access_valid_until: null,
    })
    await expect(complianceIssues(sourceUserId)).resolves.toEqual([
      ['account:no-characters', 'no-attached-characters', null, null],
    ])
    await expect(complianceState(destinationUserId)).resolves.toMatchObject({
      state: 'compliant',
      evidence_freshness: 'fresh',
    })
    await expect(activeComplianceAssignment(groupId, sourceUserId)).resolves.toBe(false)
    await expect(activeComplianceAssignment(groupId, destinationUserId)).resolves.toBe(true)
    await expect(groupPermissions.getOrganizationGroupPermissions(sourceUserId)).resolves.toEqual({
      modules: [],
      services: [],
    })
    await expect(organizationAuditEffects(auditSequence)).resolves.toEqual([
      ['compliance.transitioned', 'transitioned', sourceUserId],
      ['entitlement.revoked', 'revoked', 'discord.member'],
      ['group.revoked', 'revoked', sourceUserId],
    ])
  })

  test.each([
    {
      name: 'outside-organization character',
      requiredScopes: [] as string[],
      callback: authorization(sourceAlternateCharacterId, 'External Alt', []),
      issue: [
        `character:${sourceAlternateCharacterId}:external`,
        'character-outside-managed-organization',
        sourceAlternateCharacterId,
        null,
      ],
    },
    {
      name: 'missing-scope character',
      requiredScopes: ['scope.required'],
      callback: authorization(sourceAlternateCharacterId, 'Unscoped Alt', []),
      issue: [
        `character:${sourceAlternateCharacterId}:scope:scope.required`,
        'required-scope-missing',
        sourceAlternateCharacterId,
        'scope.required',
      ],
    },
  ])('revokes destination compliance effects for a transferred $name', async (scenario) => {
    const transfer = await prepareNonMainTransfer()
    const { groupId, auditSequence } = await configureTransferCompliance(
      transfer.sourceUserId,
      transfer.destinationUserId,
      scenario.requiredScopes,
    )

    await characterTransfer.transferCharacter({
      approvalId: transfer.approvalId,
      sourceUserId: transfer.sourceUserId,
      sourceSubjectLifecycleId: transfer.sourceSubjectLifecycleId,
      destinationUserId: transfer.destinationUserId,
      characterId: sourceAlternateCharacterId,
      destinationSessionToken: transfer.destinationSession,
      authorization:
        scenario.name === 'outside-organization character'
          ? { ...scenario.callback, corporationId: 1_000_167 }
          : scenario.callback,
    })

    await expect(complianceState(transfer.sourceUserId)).resolves.toMatchObject({
      state: 'compliant',
    })
    await expect(complianceState(transfer.destinationUserId)).resolves.toMatchObject({
      state: 'suspended',
      evidence_freshness: 'fresh',
      access_valid_until: null,
    })
    await expect(complianceIssues(transfer.destinationUserId)).resolves.toEqual([scenario.issue])
    await expect(activeComplianceAssignment(groupId, transfer.sourceUserId)).resolves.toBe(true)
    await expect(activeComplianceAssignment(groupId, transfer.destinationUserId)).resolves.toBe(
      false,
    )
    await expect(
      groupPermissions.getOrganizationGroupPermissions(transfer.destinationUserId),
    ).resolves.toEqual({ modules: [], services: [] })
    await expect(organizationAuditEffects(auditSequence)).resolves.toEqual([
      ['compliance.transitioned', 'transitioned', transfer.destinationUserId],
      ['entitlement.revoked', 'revoked', 'discord.member'],
      ['group.revoked', 'revoked', transfer.destinationUserId],
    ])
  })

  test('does not transfer a source-owned external-character exception', async () => {
    const transfer = await prepareNonMainTransfer()
    await connection`
      update characters set corporation_id = 1000167
      where character_id = ${sourceAlternateCharacterId}
    `
    await connection`
      insert into organization_character_exceptions (
        exception_id, deployment_id, organization_version, user_id, character_id,
        approver_user_id, reason
      ) values (
        ${randomUUID()}, 1, 1, ${transfer.sourceUserId}, ${sourceAlternateCharacterId},
        ${transfer.destinationUserId}, 'Transfer test source exception'
      )
    `
    const { groupId } = await configureTransferCompliance(
      transfer.sourceUserId,
      transfer.destinationUserId,
    )

    await characterTransfer.transferCharacter({
      approvalId: transfer.approvalId,
      sourceUserId: transfer.sourceUserId,
      sourceSubjectLifecycleId: transfer.sourceSubjectLifecycleId,
      destinationUserId: transfer.destinationUserId,
      characterId: sourceAlternateCharacterId,
      destinationSessionToken: transfer.destinationSession,
      authorization: {
        ...authorization(sourceAlternateCharacterId, 'Transferred External Alt', []),
        corporationId: 1_000_167,
      },
    })

    const [exceptions] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_character_exceptions
      where character_id = ${sourceAlternateCharacterId}
    `
    expect(exceptions?.count).toBe(0)
    await expect(complianceState(transfer.sourceUserId)).resolves.toMatchObject({
      state: 'compliant',
    })
    await expect(complianceIssues(transfer.destinationUserId)).resolves.toEqual([
      [
        `character:${sourceAlternateCharacterId}:external`,
        'character-outside-managed-organization',
        sourceAlternateCharacterId,
        null,
      ],
    ])
    await expect(activeComplianceAssignment(groupId, transfer.sourceUserId)).resolves.toBe(true)
    await expect(activeComplianceAssignment(groupId, transfer.destinationUserId)).resolves.toBe(
      false,
    )
  })

  test('preserves blocked destination compliance state while effective permissions stay denied', async () => {
    const transfer = await prepareNonMainTransfer()
    const { groupId } = await configureTransferCompliance(
      transfer.sourceUserId,
      transfer.destinationUserId,
    )
    await insertRoleGrant(transfer.sourceUserId, transfer.sourceUserId, 'director')
    await blockStore.blockOrganizationMember({
      actorUserId: transfer.sourceUserId,
      targetUserId: transfer.destinationUserId,
      reason: 'Transfer test destination block',
    })
    const auditSequence = await latestOrganizationAuditSequence()

    await redeemPreparedTransfer(transfer)

    await expect(complianceState(transfer.destinationUserId)).resolves.toMatchObject({
      state: 'compliant',
      evidence_freshness: 'fresh',
    })
    await expect(activeComplianceAssignment(groupId, transfer.destinationUserId)).resolves.toBe(
      true,
    )
    await expect(
      groupPermissions.getOrganizationGroupPermissions(transfer.destinationUserId),
    ).resolves.toEqual({ modules: [], services: [] })
    await expect(organizationAuditEffects(auditSequence)).resolves.toEqual([])
  })

  test('invalidates materialization that commits under the old lifecycle before transfer', async () => {
    const transfer = await prepareNonMainTransfer()
    const materializationStarted = deferred<void>()
    const releaseMaterialization = deferred<void>()
    const materialize = vi.fn<PlatformResourceOperationImplementation['materialize']>(async () => {
      materializationStarted.resolve()
      await releaseMaterialization.promise
    })
    const observation = await prepareCharacterResourceObservation(transfer, materialize)

    const application = resourceRefresh.applyInstalledResourceObservation(observation)
    await materializationStarted.promise
    const redemption = redeemPreparedTransfer(transfer)
    await waitForBlockedDatabaseOperations(1)
    releaseMaterialization.resolve()

    await application
    const transferred = await redemption
    expect(materialize).toHaveBeenCalledOnce()
    const oldState = await collectionStateCount(observation.identity.subjectLifecycleId)
    expect(oldState).toBe(0)
    expect(transferred.subjectLifecycleId).not.toBe(observation.identity.subjectLifecycleId)
  })

  test('discards old-lifecycle materialization after transfer without relabeling its write', async () => {
    const transfer = await prepareNonMainTransfer()
    const materialize = vi.fn<PlatformResourceOperationImplementation['materialize']>()
    const observation = await prepareCharacterResourceObservation(transfer, materialize)
    const holder = postgres(databaseUrl, { max: 1 })
    let lockHeld = false
    try {
      await holder`
        select pg_advisory_lock(
          ${dbLocks.resourceRefreshLockNamespace},
          ${dbLocks.resourceRefreshLockKey(observation.identity)}
        )
      `
      lockHeld = true
      const application = resourceRefresh.applyInstalledResourceObservation(observation)
      await waitForBlockedDatabaseOperations(1)
      const transferred = await redeemPreparedTransfer(transfer)
      await holder`
        select pg_advisory_unlock(
          ${dbLocks.resourceRefreshLockNamespace},
          ${dbLocks.resourceRefreshLockKey(observation.identity)}
        )
      `
      lockHeld = false
      await application

      expect(materialize).not.toHaveBeenCalled()
      expect(await collectionStateCount(observation.identity.subjectLifecycleId)).toBe(0)
      expect(await collectionStateCount(transferred.subjectLifecycleId)).toBe(0)
    } finally {
      if (lockHeld)
        await holder`
          select pg_advisory_unlock(
            ${dbLocks.resourceRefreshLockNamespace},
            ${dbLocks.resourceRefreshLockKey(observation.identity)}
          )
        `
      await holder.end()
    }
  })

  test.each([
    'lifecycle',
    'token',
    'detached-event',
    'attached-event',
    'source-compliance',
    'destination-compliance',
    'session-deletion',
    'approval-consumption',
    'consumption-audit',
  ] as const)('rolls back every required write when %s persistence fails', async (failurePoint) => {
    const transfer = await prepareSoleTransferFailure()
    const removeFailure = await installTransferFailure(failurePoint, transfer)

    try {
      await expect(redeemSoleTransfer(transfer)).rejects.toThrow(/^Failed query:/)
    } finally {
      await removeFailure()
    }

    expect(await loadTransferRollbackState(transfer.approvalId)).toEqual(transfer.baseline)
    await expect(oauthStateStore.consumeOAuthState(transfer.oauthState)).resolves.toBeNull()
  })

  test('commits transfer while retaining an empty source after an unknown restrictive refusal', async () => {
    const transfer = await prepareSoleTransferFailure()
    await connection`
      create table test_transfer_user_restriction (
        user_id uuid primary key references users(id) on delete restrict
      )
    `
    await connection`
      insert into test_transfer_user_restriction (user_id) values (${transfer.sourceUserId})
    `

    let result: Awaited<ReturnType<typeof redeemSoleTransfer>>
    try {
      result = await redeemSoleTransfer(transfer)
    } finally {
      await connection`drop table test_transfer_user_restriction`
    }

    await expect(characterUserId(sourceCharacterId)).resolves.toBe(transfer.destinationUserId)
    const [source] = await connection<{ id: string }[]>`
      select id from users where id = ${transfer.sourceUserId}
    `
    expect(source?.id).toBe(transfer.sourceUserId)
    await expect(findSession(transfer.sourceSession)).resolves.toBeNull()
    await expect(findSession(transfer.destinationSession)).resolves.toBe(transfer.destinationUserId)
    await expect(
      characterLifecycle.findOwnedCharacter(transfer.destinationUserId, sourceCharacterId),
    ).resolves.toMatchObject({ subjectLifecycleId: result.subjectLifecycleId, isMain: false })
    const [approval] = await connection<{ consumed_at: Date | null }[]>`
      select consumed_at from character_transfer_approvals where approval_id = ${transfer.approvalId}
    `
    expect(approval?.consumed_at).toBeInstanceOf(Date)
  })

  test('rolls back transfer when optional source cleanup fails unexpectedly', async () => {
    const transfer = await prepareSoleTransferFailure()
    await connection.unsafe(`
      create function reject_transfer_source_delete() returns trigger language plpgsql as $$
      begin
        if old.id = '${transfer.sourceUserId}'::uuid then
          raise exception 'injected cleanup failure' using errcode = 'P0001';
        end if;
        return old;
      end
      $$
    `)
    await connection`
      create trigger reject_transfer_source_delete before delete on users
      for each row execute function reject_transfer_source_delete()
    `

    try {
      await expect(redeemSoleTransfer(transfer)).rejects.toMatchObject({
        cause: { code: 'P0001' },
      })
    } finally {
      await connection`drop trigger reject_transfer_source_delete on users`
      await connection`drop function reject_transfer_source_delete()`
    }

    expect(await loadTransferRollbackState(transfer.approvalId)).toEqual(transfer.baseline)
    await expect(oauthStateStore.consumeOAuthState(transfer.oauthState)).resolves.toBeNull()
  })
})

async function insertDeployment() {
  const administratorId = await insertAdministrator()
  await connection`
    insert into organization_epochs (
      deployment_id, organization_version, organization_type, organization_id,
      organization_name, organization_ticker
    ) values (1, 1, 'corporation', 1000166, 'Transfer Corporation', 'MOVE')
  `
  await connection`
    insert into deployment_settings (
      id, organization_type, organization_id,
      organization_name, organization_ticker, organization_version
    ) values (
      1, 'corporation', 1000166,
      'Transfer Corporation', 'MOVE', 1
    )
  `
  await connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, is_current,
      first_observed_at, last_observed_at
    ) values (1, 1, 1000166, true, now(), now())
  `
  return administratorId
}

async function insertAdministrator() {
  const administratorId = randomUUID()
  await connection`
    insert into deployment_admins (id, email, password_hash)
    values (${administratorId}, 'owner@example.com', 'unused')
  `
  await connection`
    insert into deployment_installation_settings (id, owner_admin_id)
    values (1, ${administratorId})
    on conflict (id) do update set owner_admin_id = excluded.owner_admin_id
  `
  return administratorId
}

async function saveLogin(characterId: number, sessionToken: string, characterName: string) {
  await characterLifecycle.saveLogin({
    ...authorization(characterId, characterName, [], `login-${characterId}`),
    sessionToken,
    sessionExpiresAt: new Date(Date.now() + 60_000),
  })
}

async function createApproval(
  administratorId: string,
  characterId: number,
  destinationMainCharacterId: number,
) {
  const preview = await transferApprovals.previewCharacterTransfer({
    administratorId,
    characterId,
    destinationMainCharacterId,
    reason: 'Repair split account',
  })
  if (!preview.eligible) throw new Error(`Expected eligible preview, got ${preview.blocker}`)
  return transferApprovals.createCharacterTransferApproval({
    administratorId,
    previewId: preview.previewId,
  })
}

async function prepareNonMainTransfer() {
  const administratorId = await insertDeployment()
  const sourceSession = 'source-session-token'
  const destinationSession = 'destination-session-token'
  await saveLogin(sourceCharacterId, sourceSession, 'Source Pilot')
  const sourceUserId = await characterUserId(sourceCharacterId)
  await characterLifecycle.attachCharacter({
    ...authorization(sourceAlternateCharacterId, 'Source Alt', ['scope.old']),
    userId: sourceUserId,
    sessionToken: sourceSession,
  })
  await saveLogin(destinationCharacterId, destinationSession, 'Destination Pilot')
  const destinationUserId = await characterUserId(destinationCharacterId)
  const sourceCharacter = await characterLifecycle.findOwnedCharacter(
    sourceUserId,
    sourceAlternateCharacterId,
  )
  const { approval, secret } = await createApproval(
    administratorId,
    sourceAlternateCharacterId,
    destinationCharacterId,
  )
  return {
    administratorId,
    approvalId: approval.approvalId,
    approvalSecret: secret,
    sourceUserId,
    sourceSubjectLifecycleId: sourceCharacter!.subjectLifecycleId,
    destinationUserId,
    sourceSession,
    destinationSession,
  }
}

function redeemPreparedTransfer(transfer: Awaited<ReturnType<typeof prepareNonMainTransfer>>) {
  return characterTransfer.transferCharacter({
    approvalId: transfer.approvalId,
    sourceUserId: transfer.sourceUserId,
    sourceSubjectLifecycleId: transfer.sourceSubjectLifecycleId,
    destinationUserId: transfer.destinationUserId,
    characterId: sourceAlternateCharacterId,
    destinationSessionToken: transfer.destinationSession,
    authorization: authorization(sourceAlternateCharacterId, 'Transferred Alt', ['scope.new']),
  })
}

async function insertOwnerEvidence(userId: string, characterId: number) {
  const grantId = randomUUID()
  await connection`
    insert into organization_role_grants (
      grant_id, deployment_id, organization_version, user_id, role, granted_by_user_id, reason
    ) values (
      ${grantId}, 1, 1, ${userId}, 'organization_owner', ${userId}, 'Transfer test authority'
    )
  `
  await connection`
    insert into organization_authority_evidence (
      grant_id, deployment_id, organization_version, user_id, role, character_id,
      authority_corporation_id, observed_corporation_id, observed_alliance_id,
      required_scope, director_role_present, status, verified_at, last_checked_at
    ) values (
      ${grantId}, 1, 1, ${userId}, 'organization_owner', ${characterId},
      1000166, 1000166, null, 'esi-characters.read_corporation_roles.v1',
      true, 'fresh', now(), now()
    )
  `
  return grantId
}

async function insertCorporationSource(userId: string, characterId: number) {
  await connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, is_current,
      first_observed_at, last_observed_at
    ) values (1, 1, 1000166, true, now(), now())
    on conflict (deployment_id, organization_version, corporation_id)
    do update set is_current = true, last_observed_at = excluded.last_observed_at
  `
  const sourceId = randomUUID()
  await connection`
    insert into organization_corporation_sources (
      source_id, deployment_id, organization_version, corporation_id,
      character_id, evidence_character_id, registered_by_user_id
    ) values (${sourceId}, 1, 1, 1000166, ${characterId}, ${characterId}, ${userId})
  `
  return sourceId
}

async function transferCharacterEvents() {
  return connection<{ event_type: string; user_id: string; is_main: boolean }[]>`
    select event_type, payload ->> 'userId' as user_id,
      (payload ->> 'isMain')::boolean as is_main
    from domain_events
    where event_type in ('character.detached', 'character.attached')
    order by event_sequence
  `
}

async function transferAuditActions(approvalId: string) {
  const actions = await connection<{ action: string; outcome: string }[]>`
    select action, outcome from character_transfer_audit
    where approval_id = ${approvalId} order by occurred_at, audit_id
  `
  return actions.map(({ action, outcome }) => [action, outcome])
}

async function addSession(userId: string, sessionToken: string) {
  await connection`
    insert into sessions (session_hash, user_id, expires_at)
    values (${security.hashToken(sessionToken)}, ${userId}, now() + interval '1 hour')
  `
}

async function insertCollectionState(
  characterId: number,
  subjectLifecycleId: string,
  authorizationGeneration: number,
) {
  await connection`
    insert into deployment_modules (module_id, enabled)
    values ('core', true) on conflict (module_id) do nothing
  `
  await connection`
    insert into platform_collection_state (
      module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id,
      authorization_generation, next_eligible_at
    ) values (
      'core', 'transfer-test', 'character', ${subjectLifecycleId}, ${String(characterId)},
      ${authorizationGeneration}, now()
    )
  `
}

async function storeSourceOAuthStates(userId: string, characterId: number) {
  await oauthStateStore.storeOAuthState('pending-source-attachment-state', {
    intent: 'attach',
    userId,
  })
  await oauthStateStore.storeOAuthState('pending-source-reauthorization-state', {
    intent: 'reauthorize',
    userId,
    characterId,
  })
  await oauthStateStore.storeOAuthState('pending-source-owner-claim-state', {
    intent: 'claim-organization-owner',
    userId,
    characterId,
    organizationId: 1_000_166,
    organizationVersion: 1,
  })
}

async function insertRoleGrant(
  userId: string,
  grantedByUserId: string,
  role: 'hr_auditor' | 'director',
) {
  const grantId = randomUUID()
  await connection`
    insert into organization_role_grants (
      grant_id, deployment_id, organization_version, user_id, role, granted_by_user_id, reason
    ) values (${grantId}, 1, 1, ${userId}, ${role}, ${grantedByUserId}, 'Retained authority')
  `
  return grantId
}

type TransferFailurePoint =
  | 'lifecycle'
  | 'token'
  | 'detached-event'
  | 'attached-event'
  | 'source-compliance'
  | 'destination-compliance'
  | 'session-deletion'
  | 'approval-consumption'
  | 'consumption-audit'

async function prepareSoleTransferFailure() {
  const administratorId = await insertDeployment()
  const sourceSession = 'source-session-token'
  const destinationSession = 'destination-session-token'
  await saveLogin(sourceCharacterId, sourceSession, 'Source Pilot')
  await saveLogin(destinationCharacterId, destinationSession, 'Destination Pilot')
  const sourceUserId = await characterUserId(sourceCharacterId)
  const destinationUserId = await characterUserId(destinationCharacterId)
  const source = await characterLifecycle.findOwnedCharacter(sourceUserId, sourceCharacterId)
  const { approval } = await createApproval(
    administratorId,
    sourceCharacterId,
    destinationCharacterId,
  )
  await insertCollectionState(sourceCharacterId, source!.subjectLifecycleId, 0)
  const oauthState = `transfer-${randomUUID()}`
  await oauthStateStore.storeOAuthState(oauthState, {
    intent: 'transfer',
    approvalId: approval.approvalId,
    sourceUserId,
    sourceSubjectLifecycleId: source!.subjectLifecycleId,
    userId: destinationUserId,
    characterId: sourceCharacterId,
  })
  await expect(oauthStateStore.consumeOAuthState(oauthState)).resolves.toMatchObject({
    intent: 'transfer',
    approvalId: approval.approvalId,
    sourceUserId,
    sourceSubjectLifecycleId: source!.subjectLifecycleId,
    userId: destinationUserId,
    characterId: sourceCharacterId,
  })
  await connection`delete from domain_events`
  const baseline = await loadTransferRollbackState(approval.approvalId)
  return {
    approvalId: approval.approvalId,
    sourceUserId,
    sourceSubjectLifecycleId: source!.subjectLifecycleId,
    destinationUserId,
    sourceSession,
    destinationSession,
    oauthState,
    baseline,
  }
}

function redeemSoleTransfer(transfer: Awaited<ReturnType<typeof prepareSoleTransferFailure>>) {
  return characterTransfer.transferCharacter({
    approvalId: transfer.approvalId,
    sourceUserId: transfer.sourceUserId,
    sourceSubjectLifecycleId: transfer.sourceSubjectLifecycleId,
    destinationUserId: transfer.destinationUserId,
    characterId: sourceCharacterId,
    destinationSessionToken: transfer.destinationSession,
    authorization: authorization(sourceCharacterId, 'Transferred Pilot', ['scope.new']),
  })
}

async function installTransferFailure(
  failurePoint: TransferFailurePoint,
  transfer: Awaited<ReturnType<typeof prepareSoleTransferFailure>>,
): Promise<() => Promise<void>> {
  if (failurePoint === 'lifecycle') {
    await connection.unsafe(`
      alter table platform_subject_lifecycles add constraint reject_transfer_lifecycle
      check (not (subject_kind = 'character' and character_id = ${sourceCharacterId})) not valid
    `)
    return async () => {
      await connection`alter table platform_subject_lifecycles drop constraint reject_transfer_lifecycle`
    }
  }
  if (failurePoint === 'token') {
    await connection.unsafe(`
      alter table eve_tokens add constraint reject_transfer_token
      check (character_id <> ${sourceCharacterId}) not valid
    `)
    return async () => {
      await connection`alter table eve_tokens drop constraint reject_transfer_token`
    }
  }
  if (failurePoint === 'detached-event' || failurePoint === 'attached-event') {
    const eventType =
      failurePoint === 'detached-event' ? 'character.detached' : 'character.attached'
    await connection.unsafe(`
      alter table domain_events add constraint reject_transfer_event
      check (event_type <> '${eventType}') not valid
    `)
    return async () => {
      await connection`alter table domain_events drop constraint reject_transfer_event`
    }
  }
  if (failurePoint === 'source-compliance' || failurePoint === 'destination-compliance') {
    const userId =
      failurePoint === 'source-compliance' ? transfer.sourceUserId : transfer.destinationUserId
    await connection.unsafe(`
      alter table organization_account_compliance add constraint reject_transfer_compliance
      check (user_id <> '${userId}'::uuid) not valid
    `)
    return async () => {
      await connection`alter table organization_account_compliance drop constraint reject_transfer_compliance`
    }
  }
  if (failurePoint === 'session-deletion') {
    await connection`
      create table test_transfer_session_restriction (
        session_hash varchar(64) primary key references sessions(session_hash) on delete restrict
      )
    `
    await connection`
      insert into test_transfer_session_restriction (session_hash)
      values (${security.hashToken(transfer.sourceSession)})
    `
    return async () => {
      await connection`drop table test_transfer_session_restriction`
    }
  }
  if (failurePoint === 'approval-consumption') {
    await connection`
      alter table character_transfer_approvals add constraint reject_transfer_consumption
      check (consumed_at is null) not valid
    `
    return async () => {
      await connection`
        alter table character_transfer_approvals drop constraint reject_transfer_consumption
      `
    }
  }
  await connection`
    alter table character_transfer_audit add constraint reject_transfer_consumption_audit
    check (action <> 'consumed') not valid
  `
  return async () => {
    await connection`
      alter table character_transfer_audit drop constraint reject_transfer_consumption_audit
    `
  }
}

async function loadTransferRollbackState(approvalId: string) {
  const [
    users,
    characters,
    lifecycles,
    tokens,
    collectionState,
    sessions,
    compliance,
    groupAssignments,
    organizationAudit,
    domainEvents,
    approvals,
    transferAudit,
  ] = await Promise.all([
    connection`select * from users order by id`,
    connection`select * from characters order by character_id`,
    connection`select * from platform_subject_lifecycles order by subject_lifecycle_id`,
    connection`select * from eve_tokens order by character_id`,
    connection`select * from platform_collection_state order by subject_lifecycle_id`,
    connection`select * from sessions order by session_hash`,
    connection`select * from organization_account_compliance order by user_id`,
    connection`select * from organization_group_assignments order by assignment_id`,
    connection`select * from organization_audit_events order by audit_sequence`,
    connection`select * from domain_events order by event_sequence`,
    connection`
      select * from character_transfer_approvals where approval_id = ${approvalId}
    `,
    connection`
      select * from character_transfer_audit where approval_id = ${approvalId} order by audit_id
    `,
  ])
  return {
    users,
    characters,
    lifecycles,
    tokens,
    collectionState,
    sessions,
    compliance,
    groupAssignments,
    organizationAudit,
    domainEvents,
    approvals,
    transferAudit,
  }
}

function authorization(
  characterId: number,
  characterName: string,
  scopes: string[],
  credentialLabel = 'new',
) {
  return {
    characterId,
    characterName,
    corporationId: 1_000_166,
    allianceId: null,
    accessToken: `${credentialLabel}-access-token`,
    refreshToken: `${credentialLabel}-refresh-token`,
    expiresIn: 1_200,
    scopes,
  }
}

async function characterUserId(characterId: number) {
  const [record] = await connection<{ user_id: string }[]>`
    select user_id from characters where character_id = ${characterId}
  `
  if (!record) throw new Error('Character is missing')
  return record.user_id
}

async function optionalCharacterUserId(characterId: number) {
  const [record] = await connection<{ user_id: string }[]>`
    select user_id from characters where character_id = ${characterId}
  `
  return record?.user_id ?? null
}

async function findSession(sessionToken: string) {
  const sessionHash = security.hashToken(sessionToken)
  const [record] = await connection<{ user_id: string }[]>`
    select user_id from sessions where session_hash = ${sessionHash}
  `
  return record?.user_id ?? null
}

async function raceBehindDeploymentSettingsLock(operations: readonly (() => Promise<unknown>)[]) {
  const holder = postgres(databaseUrl, { max: 1 })
  let transactionOpen = false
  let pending: Promise<unknown>[] = []
  try {
    await holder`begin`
    transactionOpen = true
    await holder`select id from deployment_settings where id = 1 for update`
    pending = operations.map((operation) => operation())
    await waitForBlockedDatabaseOperations(operations.length)
    await holder`commit`
    transactionOpen = false
    return await Promise.allSettled(pending)
  } finally {
    if (transactionOpen) await holder`rollback`
    await Promise.allSettled(pending)
    await holder.end()
  }
}

async function raceBehindCharacterLock(
  characterId: number,
  operations: readonly (() => Promise<unknown>)[],
) {
  const holder = postgres(databaseUrl, { max: 1 })
  let lockHeld = false
  let pending: Promise<unknown>[] = []
  try {
    await holder`
      select pg_advisory_lock(
        ${dbLocks.characterLockNamespace},
        ${dbLocks.characterLockKey(characterId)}
      )
    `
    lockHeld = true
    pending = operations.map((operation) => operation())
    await waitForBlockedDatabaseOperations(operations.length)
    await holder`
      select pg_advisory_unlock(
        ${dbLocks.characterLockNamespace},
        ${dbLocks.characterLockKey(characterId)}
      )
    `
    lockHeld = false
    return await Promise.allSettled(pending)
  } finally {
    if (lockHeld) {
      await holder`
        select pg_advisory_unlock(
          ${dbLocks.characterLockNamespace},
          ${dbLocks.characterLockKey(characterId)}
        )
      `
    }
    await Promise.allSettled(pending)
    await holder.end()
  }
}

async function raceBehindUserTableLock(operations: readonly (() => Promise<unknown>)[]) {
  const holder = postgres(databaseUrl, { max: 1 })
  let transactionOpen = false
  let pending: Promise<unknown>[] = []
  try {
    await holder`begin`
    transactionOpen = true
    await holder`lock table users in access exclusive mode`
    pending = operations.map((operation) => operation())
    await waitForBlockedDatabaseOperations(operations.length)
    await holder`commit`
    transactionOpen = false
    return await Promise.allSettled(pending)
  } finally {
    if (transactionOpen) await holder`rollback`
    await Promise.allSettled(pending)
    await holder.end()
  }
}

async function waitForBlockedDatabaseOperations(expected: number) {
  const timeoutAt = Date.now() + 10_000
  while (Date.now() < timeoutAt) {
    const [record] = await connection<{ count: number }[]>`
      select count(*)::integer as count
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
    `
    if ((record?.count ?? 0) >= expected) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${expected} blocked PostgreSQL operations`)
}

async function waitForBlockedDatabaseOperation(excludedPid: number) {
  const timeoutAt = Date.now() + 10_000
  while (Date.now() < timeoutAt) {
    const [record] = await connection<{ pid: number; xact_start: Date }[]>`
      select pid::integer as pid, xact_start
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and pid <> ${excludedPid}
        and wait_event_type = 'Lock'
        and xact_start is not null
      order by query_start
      limit 1
    `
    if (record) return record
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for a blocked PostgreSQL operation')
}

async function assertCharacterAccountInvariants() {
  const duplicateOwners = await connection`
    select character_id from characters group by character_id having count(*) <> 1
  `
  expect(duplicateOwners).toHaveLength(0)
  const invalidMainCounts = await connection`
    select user_id
    from characters
    group by user_id
    having count(*) filter (where is_main) <> 1
  `
  expect(invalidMainCounts).toHaveLength(0)
}

async function configureTransferCompliance(
  sourceUserId: string,
  destinationUserId: string,
  requiredScopes: readonly string[] = [],
) {
  await connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, is_current,
      first_observed_at, last_observed_at
    ) values (1, 1, 1000166, true, now(), now())
    on conflict (deployment_id, organization_version, corporation_id)
    do update set is_current = true, last_observed_at = excluded.last_observed_at
  `
  await connection`
    update deployment_settings
    set strict_remediation_duration_seconds = 0,
      required_registration_scopes = ${connection.json([...requiredScopes])}
    where id = 1
  `
  if (requiredScopes.length > 0)
    await connection`
      update eve_tokens set scopes = ${connection.json([...requiredScopes])}
      where character_id in (${sourceCharacterId}, ${sourceAlternateCharacterId}, ${destinationCharacterId})
    `
  const bundleId = randomUUID()
  const groupId = randomUUID()
  await connection`
    insert into organization_permission_bundles (
      bundle_id, deployment_id, organization_version, name, created_by_user_id
    ) values (${bundleId}, 1, 1, 'Transfer compliance services', ${destinationUserId})
  `
  await connection`
    insert into organization_permission_bundle_entries (
      bundle_id, deployment_id, organization_version, permission_type, permission_key
    ) values (${bundleId}, 1, 1, 'service', 'discord.member')
  `
  await connection`
    insert into organization_groups (
      group_id, deployment_id, organization_version, name, restricted,
      management_mode, compliance_source, created_by_user_id
    ) values (
      ${groupId}, 1, 1, 'Registered transfer members', false,
      'compliance', 'core.registration', ${destinationUserId}
    )
  `
  await connection`
    insert into organization_group_permission_bundles (
      group_id, bundle_id, deployment_id, organization_version
    ) values (${groupId}, ${bundleId}, 1, 1)
  `
  await Promise.all(
    [sourceUserId, destinationUserId].map((userId) =>
      organizationCompliance.recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        organizationVersion: 1,
        userId,
      }),
    ),
  )
  await connection`
    update organization_group_assignments
    set assigned_at = clock_timestamp() - interval '1 second'
    where group_id = ${groupId}
  `
  return { groupId, auditSequence: await latestOrganizationAuditSequence() }
}

async function complianceState(userId: string) {
  const [record] = await connection<
    { state: string; evidence_freshness: string; access_valid_until: Date | null }[]
  >`
    select state, evidence_freshness, access_valid_until
    from organization_account_compliance
    where organization_version = 1 and user_id = ${userId}
  `
  return record
}

async function complianceIssues(userId: string) {
  const issues = await connection<
    {
      issue_key: string
      issue_code: string
      character_id: number | null
      required_scope: string | null
    }[]
  >`
    select issue_key, issue_code, character_id::integer as character_id, required_scope
    from organization_compliance_issues
    where organization_version = 1 and user_id = ${userId}
    order by issue_key
  `
  return issues.map(({ issue_key, issue_code, character_id, required_scope }) => [
    issue_key,
    issue_code,
    character_id,
    required_scope,
  ])
}

async function activeComplianceAssignment(groupId: string, userId: string) {
  const [record] = await connection<{ count: number }[]>`
    select count(*)::integer as count from organization_group_assignments
    where group_id = ${groupId} and user_id = ${userId}
      and assignment_source = 'compliance' and revoked_at is null
  `
  return record?.count === 1
}

async function latestOrganizationAuditSequence() {
  const [record] = await connection<{ sequence: number }[]>`
    select coalesce(max(audit_sequence), 0)::integer as sequence from organization_audit_events
  `
  return record?.sequence ?? 0
}

async function organizationAuditEffects(afterSequence: number) {
  const effects = await connection<{ event_type: string; outcome: string; subject: string }[]>`
    select event_type, outcome,
      case when event_type like 'entitlement.%' then subject_id
        else coalesce(target_user_id::text, subject_id) end as subject
    from organization_audit_events
    where audit_sequence > ${afterSequence}
      and event_type in ('compliance.transitioned', 'entitlement.revoked', 'group.revoked')
    order by audit_sequence
  `
  return effects.map(({ event_type, outcome, subject }) => [event_type, outcome, subject])
}

async function prepareCorporationSourceCandidate(
  transfer: Awaited<ReturnType<typeof prepareNonMainTransfer>>,
  characterId: number,
) {
  const membershipScope = 'esi-corporations.read_corporation_membership.v1'
  await characterLifecycle.attachCharacter({
    ...authorization(characterId, `Source ${characterId}`, [membershipScope]),
    userId: transfer.sourceUserId,
    sessionToken: transfer.sourceSession,
  })
  await connection`
    update characters set next_affiliation_check = now() + interval '1 hour'
    where character_id = ${characterId}
  `
  await connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, is_current,
      first_observed_at, last_observed_at
    ) values (1, 1, 1000166, true, now(), now())
    on conflict (deployment_id, organization_version, corporation_id)
    do update set is_current = true, last_observed_at = excluded.last_observed_at
  `
  await connection`
    insert into organization_role_grants (
      grant_id, deployment_id, organization_version, user_id, role,
      granted_by_user_id, reason
    )
    select ${randomUUID()}, 1, 1, ${transfer.sourceUserId}, 'director',
      ${transfer.sourceUserId}, 'Transfer source race manager'
    where not exists (
      select 1 from organization_role_grants
      where deployment_id = 1 and organization_version = 1
        and user_id = ${transfer.sourceUserId} and role = 'director' and revoked_at is null
    )
  `
  await connection`
    update organization_account_compliance
    set state = 'compliant', evidence_freshness = 'fresh', authoritative = true,
      evidence_at = now(), review_deadline = null,
      established_compliant_at = coalesce(established_compliant_at, now()),
      evaluated_at = now(), access_valid_until = now() + interval '1 hour', updated_at = now()
    where deployment_id = 1 and organization_version = 1
      and user_id = ${transfer.sourceUserId}
  `
}

async function prepareCharacterResourceObservation(
  transfer: Awaited<ReturnType<typeof prepareNonMainTransfer>>,
  materialize: PlatformResourceOperationImplementation['materialize'],
) {
  const requiredScope = 'esi-characters.read_freelance_jobs.v1'
  await characterLifecycle.attachCharacter({
    ...authorization(sourceAlternateCharacterId, 'Source Alt', [requiredScope]),
    userId: transfer.sourceUserId,
    sessionToken: transfer.sourceSession,
  })
  const token = await characterTokenStore.findCharacterTokenForLifecycle(
    sourceAlternateCharacterId,
    transfer.sourceSubjectLifecycleId,
  )
  await connection`
    insert into deployment_modules (module_id, enabled)
    values ('transfer-race', true)
    on conflict (module_id) do update set enabled = true
  `
  const identity = {
    moduleId: 'transfer-race',
    resourceId: 'character-jobs',
    subjectKind: 'character' as const,
    subjectLifecycleId: transfer.sourceSubjectLifecycleId,
    subjectId: String(sourceAlternateCharacterId),
  }
  const implementation = {
    operation: 'character-jobs',
    request: vi.fn(),
    map: vi.fn(),
    materialize,
  } satisfies PlatformResourceOperationImplementation
  return {
    identity,
    resource: {
      moduleId: identity.moduleId,
      resourceId: identity.resourceId,
      operationId: 'organization-activity-character-jobs' as const,
      subjectKind: 'character' as const,
      materializationIntervalSeconds: 60,
      eligibility: { kind: 'current-owned-character' as const },
      implementation,
    },
    subject: {
      kind: 'character' as const,
      characterId: sourceAlternateCharacterId,
      lifecycleId: transfer.sourceSubjectLifecycleId,
    },
    authorizationGeneration: token!.tokenVersion,
    validatedAt: new Date().toISOString(),
    outcome: 'complete' as const,
    data: { source: 'old-lifecycle' },
  }
}

function characterResourceDescriptor() {
  const implementation = {
    operation: 'character-jobs',
    request: vi.fn(),
    map: vi.fn(),
    materialize: vi.fn(),
  } satisfies PlatformResourceOperationImplementation
  return {
    moduleId: 'transfer-repair',
    resourceId: 'character-jobs',
    operationId: 'organization-activity-character-jobs' as const,
    subjectKind: 'character' as const,
    materializationIntervalSeconds: 60,
    eligibility: { kind: 'current-owned-character' as const },
    implementation,
  } satisfies PlatformInstalledResourceDescriptor
}

async function collectionStateCount(subjectLifecycleId: string) {
  const [record] = await connection<{ count: number }[]>`
    select count(*)::integer as count from platform_collection_state
    where subject_lifecycle_id = ${subjectLifecycleId}
  `
  return record?.count ?? 0
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
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
