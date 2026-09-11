// @vitest-environment node

import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { BrowserContext, Page } from '@playwright/test'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAuthE2eInfrastructure, type FakeEveCharacter } from '../support/auth-e2e-stack'

const sourceMain = character(90_100_001, 'Source Main')
const movingCharacter = character(90_100_002, 'Moving Character')
const destinationMain = character(90_100_003, 'Destination Main')
const soleSourceCharacter = character(90_100_004, 'Sole Source')
const infrastructure = await startAuthE2eInfrastructure()
const openContexts = new Set<BrowserContext>()
let dbClient: typeof import('../../api/src/db/client.js')
let recomputeOrganizationAccountCompliance: typeof import('../../api/src/organization/compliance.js').recomputeOrganizationAccountCompliance
let webOrigin = ''

process.env.NUXT_PUBLIC_API_BASE = infrastructure.api.origin
process.env.NUXT_PUBLIC_EVE_IMAGE_BASE = infrastructure.api.origin

describe('explicit character transfer production journeys', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    build: false,
    nuxtConfig: {
      nitro: { output: { dir: fileURLToPath(new URL('../../.output', import.meta.url)) } },
    },
    browser: true,
    server: true,
    captureServerLogs: false,
    setupTimeout: 120_000,
  })

  beforeAll(async () => {
    const testUrl = useTestContext().url
    if (!testUrl) throw new Error('Nuxt test server URL is unavailable')
    webOrigin = new URL(testUrl).origin
    Object.assign(process.env, {
      DATABASE_URL: infrastructure.databaseUrl,
      WEB_ORIGIN: webOrigin,
      EVE_CALLBACK_URL: `${infrastructure.api.origin}/auth/eve/callback`,
      EVE_CLIENT_ID: 'deterministic-browser-client',
      EVE_CLIENT_SECRET: 'deterministic-browser-secret',
      TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      SESSION_COOKIE_SECURE: 'false',
    })

    vi.doMock('../../api/src/auth/sso.js', () => ({
      EveSsoTokenRefreshError: class EveSsoTokenRefreshError extends Error {},
      createAuthorizationUrl: async (state: string) => {
        const authorization = new URL('/authorize', infrastructure.sso.origin)
        authorization.searchParams.set('state', state)
        return authorization
      },
      exchangeAuthorizationCode: async (code: string) => infrastructure.sso.exchange(code),
      refreshAccessToken: async () => {
        throw new Error('Deterministic browser tests do not refresh EVE tokens')
      },
      verifyAccessToken: async (accessToken: string) => infrastructure.sso.verify(accessToken),
    }))
    vi.doMock('../../api/src/characters/profile.js', () => ({
      getCharacterAffiliation: async (characterId: number) =>
        infrastructure.sso.affiliation(characterId),
      getCharacterProfile: async () => undefined,
    }))

    const { runMigrations } = await import('../../api/src/db/migration-runner.js')
    await runMigrations(infrastructure.connection)
    ;({ recomputeOrganizationAccountCompliance } =
      await import('../../api/src/organization/compliance.js'))
    dbClient = await import('../../api/src/db/client.js')
    const { app } = await import('../../api/src/index.js')
    infrastructure.api.setHandler(app.fetch)
  })

  beforeEach(async () => {
    infrastructure.sso.reset()
    await infrastructure.connection.unsafe(
      'truncate organization_epochs, deployment_admins, users, domain_events restart identity cascade',
    )
  })

  afterEach(async () => {
    await Promise.all([...openContexts].map((context) => context.close()))
    openContexts.clear()
  })

  afterAll(async () => {
    await dbClient.sql.end()
    await infrastructure.close()
  })

  it('uses the first login cookie for immediate attachment before client hydration', async () => {
    const context = await browserContext({ javaScriptEnabled: false })
    const page = await context.newPage()

    await authorize(page, sourceMain, '/auth/eve/start', '/auth?auth=success')
    await authorize(page, movingCharacter, '/auth/eve/start', '/characters?attach=success')

    const users = await infrastructure.connection<{ count: number }[]>`
      select count(*)::integer as count from users
    `
    const sessions = await infrastructure.connection<{ count: number }[]>`
      select count(*)::integer as count from sessions
    `
    const characters = await infrastructure.connection<
      { character_id: string; user_id: string; is_main: boolean }[]
    >`
      select character_id, user_id, is_main from characters order by character_id
    `
    expect(users).toEqual([{ count: 1 }])
    expect(sessions).toEqual([{ count: 1 }])
    expect(characters).toEqual([
      {
        character_id: String(sourceMain.characterId),
        user_id: characters[0]!.user_id,
        is_main: true,
      },
      {
        character_id: String(movingCharacter.characterId),
        user_id: characters[0]!.user_id,
        is_main: false,
      },
    ])
  })

  it('revokes terminal links and repairs a non-main split without crossing account authority', async () => {
    const sourceContext = await browserContext()
    const destinationContext = await browserContext()
    const adminContext = await browserContext()
    const sourcePage = await sourceContext.newPage()
    const destinationPage = await destinationContext.newPage()
    const adminPage = await adminContext.newPage()

    await authorize(sourcePage, sourceMain, '/auth/eve/start', '/auth?auth=success')
    await authorize(sourcePage, movingCharacter, '/auth/eve/attach', '/characters?attach=success')
    await authorize(destinationPage, destinationMain, '/auth/eve/start', '/auth?auth=success')
    const sourceUserId = await characterUserId(sourceMain.characterId)
    const destinationUserId = await characterUserId(destinationMain.characterId)
    await seedOrganizationOwner(sourceUserId, destinationUserId)
    await seedAdministrator(adminContext)

    infrastructure.api.resetRequests()
    expect((await fetch(`${webOrigin}/transfer`)).status).toBe(200)
    expect((await fetch(`${webOrigin}/admin`)).status).toBe(200)
    expect(
      infrastructure.api.requests.filter(({ url }) => {
        const path = new URL(url).pathname
        return path === '/auth/session' || path === '/api/admin/session'
      }),
    ).toEqual([])

    const hostileReason = '<img src=x onerror="globalThis.compromised=true">'
    await adminPage.goto(`${webOrigin}/admin`)
    await adminPage.getByRole('heading', { name: 'Owner controls' }).waitFor()
    await adminPage.getByLabel('Moving character ID').fill(String(movingCharacter.characterId))
    await adminPage
      .getByLabel('Destination main-character ID')
      .fill(String(destinationMain.characterId))
    await adminPage.getByLabel('Approval reason').fill(hostileReason)
    await adminPage.getByRole('button', { name: 'PREVIEW TRANSFER' }).click()
    await adminPage.getByText('Preview ready. Confirm the immutable transfer details').waitFor()
    await adminPage.getByRole('button', { name: 'CREATE APPROVAL' }).click()
    const revokedLink = await adminPage.getByLabel('One-time destination link').inputValue()
    await adminPage.getByText(hostileReason, { exact: true }).waitFor()
    expect(await adminPage.locator('.admin-transfer-approval img').count()).toBe(0)

    const anonymousContext = await browserContext()
    const anonymousPage = await anonymousContext.newPage()
    await anonymousPage.goto(revokedLink)
    await anonymousPage.getByText('DESTINATION SIGN-IN REQUIRED').waitFor()
    await expect.poll(() => anonymousPage.url()).toBe(`${webOrigin}/transfer`)
    expect(
      await anonymousPage.getByRole('button', { name: 'CONTINUE TO EVE ONLINE' }).count(),
    ).toBe(0)

    await openTransferLink(sourcePage, revokedLink)
    await sourcePage.getByRole('button', { name: 'CONTINUE TO EVE ONLINE' }).click()
    await sourcePage.getByText(/replacement link/i).waitFor()

    await adminPage.getByLabel('Revocation reason').fill('Wrong destination selected')
    await adminPage.getByRole('button', { name: 'REVOKE APPROVAL' }).click()
    await adminPage.locator('[data-status="revoked"]').waitFor()
    expect(await adminPage.getByLabel('One-time destination link').count()).toBe(0)

    await openTransferLink(destinationPage, revokedLink)
    await destinationPage.getByRole('button', { name: 'CONTINUE TO EVE ONLINE' }).click()
    await destinationPage.getByText(/replacement link/i).waitFor()

    const expiredLink = await createApprovalLink(
      adminContext,
      movingCharacter.characterId,
      destinationMain.characterId,
      'Expiration browser proof',
    )
    await expireApproval(approvalIdFromLink(expiredLink))
    await openTransferLink(destinationPage, expiredLink)
    await destinationPage.getByRole('button', { name: 'CONTINUE TO EVE ONLINE' }).click()
    await destinationPage.getByText(/replacement link/i).waitFor()

    const transferLink = await createApprovalLink(
      adminContext,
      movingCharacter.characterId,
      destinationMain.characterId,
      'Repair split account',
    )
    await sourceContext.request.patch(
      `${infrastructure.api.origin}/api/me/characters/${movingCharacter.characterId}/main`,
    )
    await openTransferLink(destinationPage, transferLink)
    infrastructure.sso.queue(movingCharacter)
    await destinationPage.getByRole('button', { name: 'CONTINUE TO EVE ONLINE' }).click()
    await destinationPage.waitForURL(`${webOrigin}/characters?attach=main-character`, {
      waitUntil: 'domcontentloaded',
    })
    await destinationPage.getByText(/choose another main character/i).waitFor()

    await sourceContext.request.patch(
      `${infrastructure.api.origin}/api/me/characters/${sourceMain.characterId}/main`,
    )
    await openTransferLink(destinationPage, transferLink)
    infrastructure.sso.queue(movingCharacter)
    await destinationPage.getByRole('button', { name: 'CONTINUE TO EVE ONLINE' }).click()
    await destinationPage.waitForURL(
      `${webOrigin}/characters?attach=success&character=${movingCharacter.characterId}`,
      { waitUntil: 'domcontentloaded' },
    )

    expect(await characterUserId(movingCharacter.characterId)).toBe(destinationUserId)
    await expectMainCharacters([
      [sourceUserId, sourceMain.characterId],
      [destinationUserId, destinationMain.characterId],
    ])
    expect(
      (
        await sourceContext.request.get(
          `${infrastructure.api.origin}/api/me/characters/${movingCharacter.characterId}`,
        )
      ).status(),
    ).toBe(404)
    expect(
      (
        await destinationContext.request.get(
          `${infrastructure.api.origin}/api/me/characters/${sourceMain.characterId}`,
        )
      ).status(),
    ).toBe(404)
    expect(
      (
        await sourceContext.request.get(`${infrastructure.api.origin}/api/organization/roles`)
      ).status(),
    ).toBe(200)
    expect(
      (
        await destinationContext.request.get(`${infrastructure.api.origin}/api/organization/roles`)
      ).status(),
    ).toBe(403)
    expect(await destinationPage.content()).not.toContain('already added to another account')

    await destinationPage.goto(`${webOrigin}/characters?attach=authority-evidence`)
    await destinationPage.getByText(/Remove active organization authority/).waitFor()
    await destinationPage.goto(`${webOrigin}/characters?attach=corporation-source`)
    await destinationPage
      .getByText(/Replace or revoke the active corporation data source/)
      .waitFor()
    await destinationPage.goto(`${webOrigin}/characters?attach=approval-required`)
    await destinationPage.getByText(/requires deployment-administrator approval/).waitFor()
    await destinationPage.goto(`${webOrigin}/characters?attach=conflict`)
    await destinationPage.getByText(/Start a new character authorization and try again/).waitFor()
    expect(await destinationPage.content()).not.toContain('already added to another account')

    await openTransferLink(destinationPage, transferLink)
    await destinationPage.getByRole('button', { name: 'CONTINUE TO EVE ONLINE' }).click()
    await destinationPage.getByText(/replacement link/i).waitFor()
  })

  it('invalidates every session when transfer empties the source account', async () => {
    const sourceContext = await browserContext()
    const destinationContext = await browserContext()
    const adminContext = await browserContext()
    const sourcePage = await sourceContext.newPage()
    const destinationPage = await destinationContext.newPage()

    await authorize(sourcePage, soleSourceCharacter, '/auth/eve/start', '/auth?auth=success')
    await authorize(destinationPage, destinationMain, '/auth/eve/start', '/auth?auth=success')
    await seedAdministrator(adminContext)
    const transferLink = await createApprovalLink(
      adminContext,
      soleSourceCharacter.characterId,
      destinationMain.characterId,
      'Move sole source character',
    )

    await openTransferLink(destinationPage, transferLink)
    infrastructure.sso.queue(soleSourceCharacter)
    await destinationPage.getByRole('button', { name: 'CONTINUE TO EVE ONLINE' }).click()
    await destinationPage.waitForURL(
      `${webOrigin}/characters?attach=success&character=${soleSourceCharacter.characterId}`,
      { waitUntil: 'domcontentloaded' },
    )

    const sourceSession = await sourceContext.request.get(
      `${infrastructure.api.origin}/auth/session`,
    )
    expect(await sourceSession.json()).toEqual({ authenticated: false })
    const destinationSession = await destinationContext.request.get(
      `${infrastructure.api.origin}/auth/session`,
    )
    expect(await destinationSession.json()).toMatchObject({
      authenticated: true,
      account: { mainCharacter: { characterId: destinationMain.characterId } },
    })
  })
})

async function browserContext(options: { javaScriptEnabled?: boolean } = {}) {
  const browser = useTestContext().browser
  if (!browser) throw new Error('Nuxt browser is unavailable')
  const context = await browser.newContext(options)
  openContexts.add(context)
  return context
}

async function authorize(
  page: Page,
  proof: FakeEveCharacter,
  startPath: string,
  expectedPath: string,
) {
  infrastructure.sso.queue(proof)
  await page.goto(`${infrastructure.api.origin}${startPath}`)
  await page.waitForURL((url) => url.origin === webOrigin && url.href.includes(expectedPath), {
    waitUntil: 'domcontentloaded',
  })
}

async function openTransferLink(page: Page, link: string) {
  const transferRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/auth/eve/transfer'))
      transferRequests.push(request.url())
  })
  await page.goto('about:blank')
  await page.goto(link)
  await page.getByRole('button', { name: 'CONTINUE TO EVE ONLINE' }).waitFor()
  await expect.poll(() => page.url()).toBe(`${webOrigin}/transfer`)
  expect(transferRequests).toEqual([])
}

async function seedAdministrator(context: BrowserContext) {
  const administratorId = randomUUID()
  const sessionToken = `browser-admin-${randomUUID()}`
  await infrastructure.connection`
    insert into deployment_admins (id, email, password_hash)
    values (${administratorId}, 'browser-admin@example.com', 'unused-browser-test-hash')
  `
  await infrastructure.connection`
    insert into deployment_installation_settings (id, owner_admin_id)
    values (1, ${administratorId})
  `
  await infrastructure.connection`
    insert into admin_sessions (session_hash, admin_id, expires_at)
    values (${sha256(sessionToken)}, ${administratorId}, now() + interval '1 hour')
  `
  await context.addCookies([
    { name: 'eve_space_admin_session', value: sessionToken, url: infrastructure.api.origin },
  ])
}

async function createApprovalLink(
  context: BrowserContext,
  characterId: number,
  destinationMainCharacterId: number,
  reason: string,
) {
  const headers = { Origin: webOrigin }
  const previewResponse = await context.request.post(
    `${infrastructure.api.origin}/api/admin/character-transfer-approvals/preview`,
    { data: { characterId, destinationMainCharacterId, reason }, headers },
  )
  expect(previewResponse.status()).toBe(200)
  const preview = (await previewResponse.json()) as { preview: { previewId: string } }
  const approvalResponse = await context.request.post(
    `${infrastructure.api.origin}/api/admin/character-transfer-approvals`,
    { data: { previewId: preview.preview.previewId }, headers },
  )
  expect(approvalResponse.status()).toBe(201)
  return ((await approvalResponse.json()) as { transferLink: string }).transferLink
}

async function seedOrganizationOwner(sourceUserId: string, destinationUserId: string) {
  await infrastructure.connection`
    insert into organization_epochs (
      deployment_id, organization_version, organization_type, organization_id,
      organization_name, organization_ticker
    ) values (1, 1, 'corporation', ${sourceMain.corporationId}, 'Browser Corporation', 'BROW')
  `
  await infrastructure.connection`
    insert into deployment_settings (
      id, organization_type, organization_id, organization_name, organization_ticker,
      organization_version
    ) values (1, 'corporation', ${sourceMain.corporationId}, 'Browser Corporation', 'BROW', 1)
  `
  await infrastructure.connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at
    ) values (1, 1, ${sourceMain.corporationId}, now(), now())
  `
  const [grant] = await infrastructure.connection<{ grant_id: string }[]>`
    insert into organization_role_grants (
      deployment_id, organization_version, user_id, role, granted_by_user_id, reason
    ) values (1, 1, ${sourceUserId}, 'organization_owner', ${sourceUserId}, 'Browser authority')
    returning grant_id
  `
  await infrastructure.connection`
    insert into organization_authority_evidence (
      grant_id, deployment_id, organization_version, user_id, character_id,
      authority_corporation_id, observed_corporation_id, required_scope,
      director_role_present, status, verified_at, last_checked_at
    ) values (
      ${grant!.grant_id}, 1, 1, ${sourceUserId}, ${sourceMain.characterId},
      ${sourceMain.corporationId}, ${sourceMain.corporationId}, 'scope.owner',
      true, 'fresh', now(), now()
    )
  `
  await recomputeOrganizationAccountCompliance({
    deploymentId: 1,
    organizationVersion: 1,
    userId: sourceUserId,
  })
  await recomputeOrganizationAccountCompliance({
    deploymentId: 1,
    organizationVersion: 1,
    userId: destinationUserId,
  })
}

async function characterUserId(characterId: number) {
  const [characterRow] = await infrastructure.connection<{ user_id: string }[]>`
    select user_id from characters where character_id = ${characterId}
  `
  if (!characterRow) throw new Error(`Character ${characterId} is missing`)
  return characterRow.user_id
}

async function expectMainCharacters(expected: [string, number][]) {
  const mains = await infrastructure.connection<{ user_id: string; character_id: string }[]>`
    select user_id, character_id from characters where is_main order by user_id
  `
  expect(mains).toEqual(
    expected
      .map(([userId, characterId]) => ({ user_id: userId, character_id: String(characterId) }))
      .toSorted((left, right) => left.user_id.localeCompare(right.user_id)),
  )
}

function approvalIdFromLink(link: string) {
  return new URLSearchParams(new URL(link).hash.slice(1)).get('approval')!
}

async function expireApproval(approvalId: string) {
  await infrastructure.connection`
    with removed as (
      delete from character_transfer_approvals
      where approval_id = ${approvalId}
      returning *
    ), expired_at as (
      select clock_timestamp() - interval '16 minutes' as created_at
    )
    insert into character_transfer_approvals (
      approval_id, link_secret_hash, character_id, character_name, source_user_id,
      source_subject_lifecycle_id, source_character_count, destination_user_id,
      destination_main_character_id, destination_main_character_name,
      approved_by_administrator_id, reason, created_at, expires_at, consumed_at,
      consumed_by_user_id, new_subject_lifecycle_id, revoked_at,
      revoked_by_administrator_id, revocation_reason
    )
    select
      approval_id, link_secret_hash, character_id, character_name, source_user_id,
      source_subject_lifecycle_id, source_character_count, destination_user_id,
      destination_main_character_id, destination_main_character_name,
      approved_by_administrator_id, reason, expired_at.created_at,
      expired_at.created_at + interval '15 minutes', consumed_at, consumed_by_user_id,
      new_subject_lifecycle_id, revoked_at, revoked_by_administrator_id, revocation_reason
    from removed cross join expired_at
  `
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function character(characterId: number, characterName: string): FakeEveCharacter {
  return {
    characterId,
    characterName,
    corporationId: 10_001_166,
    allianceId: null,
    scopes: ['scope.owner'],
  }
}
