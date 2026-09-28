// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Page } from '@playwright/test'
import type { IncomingMessage } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cacheAdmissionForOrganization } from '../support/cache-admission'
import { startCorsJsonApi } from '../support/cors-json-api'

const targetUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const reviewerCharacterId = 90_000_010
const targetCharacterId = 90_000_001
const altCharacterId = 90_000_004
const recordedRequests: URL[] = []
const blockRequests: unknown[] = []
let apiOrigin = ''
let organizationVersion = 7
let reviewAccessDenied = false
let blockPermission = false
let accountBlocked = false
let observationPermission = false
let observationEnabled = false
let authenticated = true
let sessionOwnerId = 'reviewer-user'
let authorizationGeneration = 4
let observationDisclosureVersion = 1
let slowAltRead: Promise<void> | null = null
let suspendAdmission = false

const shellResponse = (url: URL) => {
  if (url.pathname === '/auth/config') {
    return {
      body: {
        attachUrl: `${apiOrigin}/auth/eve/attach`,
        configured: true,
        loginUrl: `${apiOrigin}/auth/eve/login`,
      },
    }
  }
  if (url.pathname === '/auth/session') {
    if (!authenticated) return { body: { authenticated: false } }
    return {
      body: {
        account: {
          mainCharacter: { characterId: reviewerCharacterId, name: 'Reviewer Pilot' },
          userId: sessionOwnerId,
        },
        authenticated: true,
      },
    }
  }
  if (url.pathname === '/api/admin/session') {
    return { body: { authenticated: false } }
  }
  if (url.pathname === '/api/me/cache-admission') {
    if (suspendAdmission)
      return {
        body: { code: 'ADMISSION_UNAVAILABLE', message: 'Verification unavailable.' },
        status: 503,
      }
    return {
      body: cacheAdmissionForOrganization(sessionOwnerId, reviewerCharacterId, organizationVersion),
    }
  }
  if (url.pathname === '/api/organization/context') {
    return {
      body: {
        memberAccess: true,
        organization: {
          organizationId: 98_000_001,
          organizationName: 'Review Corporation',
          organizationTicker: 'REV',
          organizationType: 'corporation',
          organizationVersion,
        },
      },
    }
  }
  if (url.pathname === '/api/me/characters') {
    return { body: { characters: [] } }
  }
  if (url.pathname === '/api/modules') {
    return { body: moduleRuntime() }
  }
  return null
}

const reviewerResponse = (url: URL) => {
  if (url.pathname === '/api/organization/review') {
    if (reviewAccessDenied) {
      return {
        body: {
          code: 'ORGANIZATION_REVIEWER_REQUIRED',
          message: 'Organization reviewer authority is required.',
        },
        status: 403,
      }
    }
    return { body: { contributions: contributions(), organizationVersion } }
  }
  if (url.pathname === '/api/organization/review/characters') {
    const page = directoryPage(url)
    return {
      body: {
        groupFacets: [
          { groupId: 'group-alpha', name: 'Alpha' },
          { groupId: 'group-remote', name: 'Remote reviewers' },
        ],
        organizationVersion,
        status: 'available',
        ...page,
      },
    }
  }
  if (url.pathname === `/api/organization/review/members/${targetUserId}`) {
    return { body: { member: targetMember(), organizationVersion } }
  }
  if (
    url.pathname ===
      `/api/organization/review/members/${targetUserId}/characters/${targetCharacterId}` ||
    url.pathname === `/api/organization/review/members/${targetUserId}/characters/${altCharacterId}`
  ) {
    return {
      body: {
        member: exactTargetMember(Number(url.pathname.split('/').at(-1))),
        organizationVersion,
      },
    }
  }
  return null
}

const profileResponse = async (url: URL) => {
  if (
    url.pathname ===
      `/api/modules/member-audit/accounts/${targetUserId}/characters/${altCharacterId}/overview` ||
    url.pathname ===
      `/api/modules/member-audit/accounts/${targetUserId}/characters/${targetCharacterId}/overview`
  ) {
    const id = Number(url.pathname.split('/').at(-2))
    if (id === altCharacterId) await slowAltRead
    return {
      body: {
        account: directoryMember('review').account,
        character: exactTargetMember(id).character,
        managedMemberLifecycleId: directoryMember('review').managedMemberLifecycleId,
        organizationVersion,
        profile: {
          id,
          name: id === altCharacterId ? 'Review Alt' : 'Review Pilot',
          birthday: '2022-01-01T00:00:00Z',
          gender: 'Female',
          race: 'Caldari',
          raceFactionId: null,
          bloodline: 'Achura',
          securityStatus: 1,
          achievementScore: 2,
          factionId: null,
          corporation: {
            id: 98_000_001,
            name: 'Review Corporation',
            ticker: 'REV',
            memberCount: 50,
          },
          alliance: null,
          validatedAt: '2026-09-19T08:00:00Z',
          cachedUntil: '2026-09-19T08:10:00Z',
          stale: false,
        },
      },
    }
  }
  return null
}

const observationResponse = async (url: URL) => {
  if (url.pathname.endsWith('/current-observation')) {
    const id = Number(url.pathname.split('/').at(-2))
    if (id === altCharacterId) await slowAltRead
    const validatedAt = new Date().toISOString()
    const cachedUntil = new Date(Date.now() + 60_000).toISOString()
    return {
      body: {
        currentShip: {
          status: { resourceId: 'current-ship', status: 'current', validatedAt, cachedUntil },
          evidence: {
            snapshot: {
              kind: 'current-ship',
              name: id === altCharacterId ? 'Alt Vessel' : 'Main Vessel',
              typeName: 'Merlin',
              groupName: 'Frigate',
            },
            validatedAt,
            cachedUntil,
          },
        },
        currentLocation: {
          status: { resourceId: 'current-location', status: 'never-collected', validatedAt: null },
          evidence: null,
        },
      },
    }
  }
  return null
}

const blockResponse = async (request: IncomingMessage, url: URL) => {
  if (url.pathname === `/api/modules/member-audit/accounts/${targetUserId}/block`) {
    if (request.method === 'GET')
      return {
        body: {
          block: accountBlocked
            ? { blocked: true, blockedAt: '2026-09-19T08:00:00Z' }
            : { blocked: false },
        },
      }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    blockRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    accountBlocked = request.method === 'POST'
    return {
      body: {
        decision: accountBlocked ? 'blocked' : 'unblocked',
        blockId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      status: accountBlocked ? 201 : 200,
    }
  }
  return null
}

const apiServer = await startCorsJsonApi(async (request) => {
  const url = new URL(request.url ?? '/', 'http://mock-api.invalid')
  recordedRequests.push(url)
  const shell = shellResponse(url)
  if (shell) return shell
  const reviewer = reviewerResponse(url)
  if (reviewer) return reviewer
  const profile = await profileResponse(url)
  if (profile) return profile
  const observation = await observationResponse(url)
  if (observation) return observation
  const block = await blockResponse(request, url)
  if (block) return block
  if (url.pathname === `/api/modules/member-audit/accounts/${targetUserId}/summary`) {
    return { body: memberSummary() }
  }
  if (
    url.pathname ===
    `/api/modules/member-audit/accounts/${targetUserId}/characters/${targetCharacterId}/assets`
  ) {
    return {
      body: {
        assets: {
          evidence: { snapshot: { records: [] } },
          status: {
            authorizationGeneration: 4,
            disclosureVersion: 1,
            resourceId: 'assets',
            status: 'current',
            validatedAt: '2026-09-19T08:00:00.000Z',
          },
        },
      },
    }
  }

  return { body: { code: 'NOT_FOUND', message: 'Not found.' }, status: 404 }
})

apiOrigin = apiServer.origin
process.env.NUXT_PUBLIC_API_BASE = apiOrigin
process.env.NUXT_PUBLIC_EVE_IMAGE_BASE = apiOrigin

afterAll(apiServer.close)

describe('Member Audit production reviewer journey', async () => {
  await setup({
    browser: true,
    build: false,
    captureServerLogs: false,
    nuxtConfig: {
      nitro: { output: { dir: fileURLToPath(new URL('../../.output-e2e', import.meta.url)) } },
    },
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    setupTimeout: 120_000,
  })

  const openPages = new Set<Page>()

  beforeEach(() => {
    recordedRequests.length = 0
    blockRequests.length = 0
    organizationVersion = 7
    reviewAccessDenied = false
    blockPermission = false
    accountBlocked = false
    observationPermission = false
    observationEnabled = false
    authenticated = true
    sessionOwnerId = 'reviewer-user'
    authorizationGeneration = 4
    observationDisclosureVersion = 1
    slowAltRead = null
    suspendAdmission = false
    apiServer.setAllowedOrigin(useTestContext().url)
  })

  afterEach(async () => {
    await Promise.all(Array.from(openPages, (page) => page.close()))
    openPages.clear()
  })

  it('configures, sorts, filters, pages, and selects the directory without preloading evidence', async () => {
    const html = await $fetch('/organization/review')
    expect(html).toContain('Verifying reviewer identity')
    expect(memberAuditRequests()).toHaveLength(0)

    const page = await createPage('/organization/review')
    openPages.add(page)
    await page.getByRole('heading', { name: 'Select a character' }).waitFor()
    await page.getByRole('table', { name: /Current managed organization characters/ }).waitFor()
    expect(await page.getByRole('row').count()).toBe(4)
    await page.getByText('Access blocked', { exact: true }).waitFor()
    await page.getByText('3 of 7 covered', { exact: true }).waitFor()
    expect(memberAuditRequests()).toHaveLength(0)

    const managedSinceSort = page.getByRole('button', { name: 'Sort by Account managed since' })
    const sortRequestStart = directoryRequests().length
    await managedSinceSort.focus()
    await page.keyboard.press('Enter')
    await expect
      .poll(() =>
        directoryRequests()
          .slice(sortRequestStart)
          .some(({ searchParams }) => searchParams.get('sort') === 'managed_since'),
      )
      .toBe(true)
    const sortRequest = directoryRequests()
      .slice(sortRequestStart)
      .findLast(({ searchParams }) => searchParams.get('sort') === 'managed_since')!
    expect(sortRequest.searchParams.get('direction')).toBe('asc')
    expect(sortRequest.searchParams.has('cursor')).toBe(false)

    const columnsButton = page.getByRole('button', { name: /COLUMNS/ })
    await columnsButton.focus()
    await page.keyboard.press('Enter')
    const siteRegistered = page.getByRole('checkbox', { name: 'Account site registered' })
    await siteRegistered.focus()
    await page.keyboard.press('Space')
    await page.getByRole('columnheader', { name: /Account site registered/ }).waitFor()
    await page.keyboard.press('Escape')
    await expect
      .poll(() => columnsButton.evaluate((element) => element === document.activeElement))
      .toBe(true)

    const groupOverflow = page.getByRole('button', { name: 'Show all 4 current groups' })
    expect((await groupOverflow.textContent())?.trim()).toBe('+2')
    await groupOverflow.click()
    await page.getByRole('region', { name: 'Current groups' }).getByText('Delta').waitFor()
    await page.getByRole('button', { name: 'Close current groups' }).click()

    await page.getByRole('combobox', { name: 'Audit data filter' }).click()
    await page.getByRole('option', { exact: true, name: 'Stale' }).click()
    await expect
      .poll(() => directoryRequests().at(-1)?.searchParams.get('auditState'))
      .toBe('stale')
    await page.getByRole('button', { name: 'Select Stale Pilot' }).waitFor()
    expect(await page.getByRole('row').count()).toBe(2)

    await page.getByRole('combobox', { name: 'Audit data filter' }).click()
    await page.getByRole('option', { name: 'All audit states' }).click()
    await page.getByRole('button', { name: 'Next character page' }).click()
    await page.getByRole('button', { name: 'Select Remote Pilot' }).waitFor()
    expect(directoryRequests().at(-1)?.searchParams.get('cursor')).toBe('opaque-next-cursor')

    await page.getByRole('button', { name: 'Previous character page' }).click()
    await page.getByRole('button', { name: 'Select Review Pilot' }).waitFor()
    await page.getByRole('searchbox', { name: 'Character search' }).fill('Review')
    await page.getByRole('button', { name: 'SEARCH' }).click()
    await expect.poll(() => directoryRequests().at(-1)?.searchParams.get('query')).toBe('Review')
    expect(directoryRequests().at(-1)?.searchParams.has('cursor')).toBe(false)

    await page.getByRole('button', { name: 'Select Review Pilot' }).press('Enter')
    await page.getByText('Select a permitted panel to load its private data.').waitFor()
    expect(memberAuditRequests()).toHaveLength(0)

    await page.getByRole('button', { name: 'Member overview' }).click()
    await page.getByText('Organization access data', { exact: true }).waitFor()
    expect(memberAuditRequests().map(({ pathname }) => pathname)).toStrictEqual([
      `/api/modules/member-audit/accounts/${targetUserId}/summary`,
    ])

    const overviewTab = page.getByRole('tab', { name: 'Member overview' })
    await overviewTab.focus()
    await page.keyboard.press('ArrowRight')
    await page.getByText('Read-only character review').waitFor()
    await page.keyboard.press('ArrowRight')
    await page.getByText('The current complete observation contains no records.').waitFor()
    expect(await page.getByRole('tab', { name: 'Assets' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(memberAuditRequests().map(({ pathname }) => pathname)).toStrictEqual([
      `/api/modules/member-audit/accounts/${targetUserId}/summary`,
      `/api/modules/member-audit/accounts/${targetUserId}/characters/${targetCharacterId}/overview`,
      `/api/modules/member-audit/accounts/${targetUserId}/characters/${targetCharacterId}/assets`,
    ])

    await page.setViewportSize({ height: 844, width: 390 })
    const mobileWidths = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    // The root reserves a stable scrollbar gutter, so the body sits inside the viewport.
    expect(mobileWidths.viewport).toBe(390)
    expect(mobileWidths.body).toBeLessThanOrEqual(mobileWidths.viewport)
    expect(await page.locator('[tabindex="1"], [tabindex="2"]').count()).toBe(0)
  })

  it('closes the workspace after organization version and reviewer authority change', async () => {
    const page = await createPage('/organization/review')
    openPages.add(page)
    await page.getByRole('button', { name: 'Select Review Pilot' }).click()
    await page.getByRole('button', { name: 'Member overview' }).click()
    await page.getByText('Organization access data', { exact: true }).waitFor()

    organizationVersion = 8
    reviewAccessDenied = true
    recordedRequests.length = 0
    await page.reload()

    await page.getByRole('heading', { name: 'Organization review access is blocked' }).waitFor()
    expect(memberAuditRequests()).toHaveLength(0)
    expect(directoryRequests()).toHaveLength(0)
    expect(await page.getByText('Review Pilot', { exact: true }).count()).toBe(0)
  })

  it('reviews the exact alt and applies one account-wide block from a mobile row action', async () => {
    blockPermission = true
    const page = await createPage('/organization/review')
    openPages.add(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Review Review Alt' }).press('Enter')
    await page.getByText('Read-only character review').waitFor()
    expect(new URL(page.url()).searchParams.get('targetCharacterId')).toBe(String(altCharacterId))
    expect(memberAuditRequests().map(({ pathname }) => pathname)).toStrictEqual([
      `/api/modules/member-audit/accounts/${targetUserId}/characters/${altCharacterId}/overview`,
    ])
    expect(
      recordedRequests.some(({ pathname }) => pathname.startsWith('/api/me/characters/')),
    ).toBe(false)

    await page.getByRole('button', { name: 'Block account for Review Alt' }).click()
    await page
      .getByText(
        'Blocking this account immediately denies protected organization access for all its characters',
        { exact: false },
      )
      .waitFor()
    await page.getByLabel('Audit reason').fill('Account-wide review hold.')
    await page.getByRole('checkbox', { name: /account-wide consequences/ }).check()
    await page.getByRole('button', { name: 'Block account', exact: true }).click()
    await expect.poll(() => blockRequests.length).toBe(1)
    expect(blockRequests[0]).toStrictEqual({
      reason: 'Account-wide review hold.',
      expectedOrganizationVersion: 7,
      expectedManagedMemberLifecycleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })
    await page.getByRole('button', { name: 'Unblock account for Review Alt' }).waitFor()
    await page.getByRole('button', { name: 'Unblock account for Review Pilot' }).waitFor()
    const width = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(width.body).toBeLessThanOrEqual(width.viewport)
  })

  it('closes superseded profile and observation reads as target and authority change', async () => {
    observationPermission = true
    observationEnabled = true
    let releaseAlt!: () => void
    slowAltRead = new Promise<void>((resolve) => {
      releaseAlt = resolve
    })
    const page = await createPage('/organization/review')
    openPages.add(page)
    try {
      await page.getByRole('button', { name: 'Review Review Alt' }).click()
      await expect
        .poll(
          () =>
            memberAuditRequests().filter(({ pathname }) => pathname.includes(`/${altCharacterId}/`))
              .length,
        )
        .toBe(2)
      await page.getByRole('button', { name: 'Review Review Pilot' }).click()
      await page
        .locator('.app-reviewer-character-profile')
        .getByRole('heading', { name: 'Review Pilot' })
        .waitFor()
      await page.getByText('Main Vessel · Merlin').waitFor()
      releaseAlt()
      slowAltRead = null
      expect(
        await page.locator('.app-reviewer-character-profile').getByText('Review Alt').count(),
      ).toBe(0)
      expect(await page.getByText('Alt Vessel · Merlin').count()).toBe(0)
      expect(
        recordedRequests.some(({ pathname }) => pathname.startsWith('/api/me/characters/')),
      ).toBe(false)
      expect(
        await page.getByRole('button', { name: /Send mail|Set main|Detach|Reauthorize/ }).count(),
      ).toBe(0)
      const persisted = await page.evaluate(async () => {
        const values = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })]
        for (const { name } of await indexedDB.databases()) {
          if (!name) continue
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(name)
            request.addEventListener('success', () => resolve(request.result))
            request.addEventListener('error', () => reject(request.error))
          })
          for (const store of database.objectStoreNames) {
            const entries = await new Promise<unknown[]>((resolve, reject) => {
              const request = database.transaction(store).objectStore(store).getAll()
              request.addEventListener('success', () => resolve(request.result))
              request.addEventListener('error', () => reject(request.error))
            })
            values.push(JSON.stringify(entries))
          }
          database.close()
        }
        return values.join(' ')
      })
      expect(persisted).not.toContain('Main Vessel')
      expect(persisted).not.toContain('Alt Vessel')

      observationPermission = false
      recordedRequests.length = 0
      await page.reload()
      await page
        .locator('.app-reviewer-character-profile')
        .getByRole('heading', { name: 'Review Pilot' })
        .waitFor()
      expect(
        memberAuditRequests().some(({ pathname }) => pathname.endsWith('/current-observation')),
      ).toBe(false)
      expect(await page.getByText('Main Vessel · Merlin').count()).toBe(0)

      observationPermission = true
      observationEnabled = false
      recordedRequests.length = 0
      await page.reload()
      await page
        .locator('.app-reviewer-character-profile')
        .getByRole('heading', { name: 'Review Pilot' })
        .waitFor()
      expect(
        memberAuditRequests().some(({ pathname }) => pathname.endsWith('/current-observation')),
      ).toBe(false)

      observationEnabled = true
      authorizationGeneration = 5
      observationDisclosureVersion = 2
      recordedRequests.length = 0
      await page.reload()
      await page.getByText('Main Vessel · Merlin').waitFor()
      expect(
        memberAuditRequests().some(({ pathname }) => pathname.endsWith('/current-observation')),
      ).toBe(true)

      organizationVersion = 8
      reviewAccessDenied = true
      recordedRequests.length = 0
      await page.reload()
      await page.getByRole('heading', { name: 'Organization review access is blocked' }).waitFor()
      expect(memberAuditRequests()).toHaveLength(0)

      reviewAccessDenied = false
      authenticated = false
      recordedRequests.length = 0
      await page.reload()
      expect(memberAuditRequests()).toHaveLength(0)
    } finally {
      releaseAlt()
      slowAltRead = null
    }
  })

  it('gates the read-only landing on owner change and suspended verification', async () => {
    const page = await createPage('/organization/review')
    openPages.add(page)
    const hydrationWarnings: string[] = []
    page.on('console', (message) => {
      if (/hydration mismatch/i.test(message.text())) hydrationWarnings.push(message.text())
    })
    await page.getByRole('button', { name: 'Review Review Pilot' }).click()
    await page
      .locator('.app-reviewer-character-profile')
      .getByRole('heading', { name: 'Review Pilot' })
      .waitFor()

    sessionOwnerId = 'another-reviewer'
    recordedRequests.length = 0
    await page.reload()
    await page
      .locator('.app-reviewer-character-profile')
      .getByRole('heading', { name: 'Review Pilot' })
      .waitFor()
    expect(memberAuditRequests().every(({ pathname }) => pathname.endsWith('/overview'))).toBe(true)

    suspendAdmission = true
    recordedRequests.length = 0
    await page.reload()
    await page
      .getByRole('heading', { name: 'Current organization access could not be verified' })
      .waitFor()
    expect(memberAuditRequests()).toHaveLength(0)
    expect(await page.locator('.app-reviewer-character-profile').count()).toBe(0)
    expect(hydrationWarnings).toStrictEqual([])
  })
})

function memberAuditRequests() {
  return recordedRequests.filter(({ pathname }) =>
    pathname.startsWith('/api/modules/member-audit/'),
  )
}

function directoryRequests() {
  return recordedRequests.filter(
    ({ pathname }) => pathname === '/api/organization/review/characters',
  )
}

function directoryPage(url: URL) {
  if (url.searchParams.get('cursor') === 'opaque-next-cursor') {
    return { items: [directoryMember('remote')], nextCursor: null }
  }
  if (url.searchParams.get('auditState') === 'stale') {
    return { items: [directoryMember('stale')], nextCursor: null }
  }
  if (url.searchParams.get('query')?.toLocaleLowerCase('en').includes('review')) {
    return { items: [directoryMember('review'), directoryMember('alt')], nextCursor: null }
  }
  return {
    items: [directoryMember('review'), directoryMember('alt'), directoryMember('stale')],
    nextCursor: 'opaque-next-cursor',
  }
}

function moduleRuntime() {
  return {
    enabledModuleIds: ['member-audit'],
    enabledSections: [
      {
        activationVersion: 1,
        disclosureVersion: 1,
        kind: 'workspace',
        moduleId: 'member-audit',
        sectionId: 'overview',
      },
      {
        activationVersion: 1,
        disclosureVersion: 1,
        kind: 'sensitive-evidence',
        moduleId: 'member-audit',
        sectionId: 'assets',
      },
      ...(observationEnabled
        ? [
            {
              activationVersion: 2,
              disclosureVersion: observationDisclosureVersion,
              kind: 'sensitive-evidence',
              moduleId: 'member-audit',
              sectionId: 'current-observation',
            },
          ]
        : []),
      ...(blockPermission
        ? [
            {
              activationVersion: 1,
              disclosureVersion: 1,
              kind: 'access-management',
              moduleId: 'member-audit',
              sectionId: 'access-management',
            },
          ]
        : []),
    ],
    shellNavigationOrder: { character: [], dashboard: [] },
  }
}

function contributions() {
  return [
    {
      directoryAction: 'review',
      contributionId: 'overview',
      description: 'Review identity, compliance, access, and evidence availability.',
      icon: 'overview',
      label: 'Member overview',
      moduleId: 'member-audit',
      order: 100,
      routeId: 'member-summary',
      routePath: '/api/modules/member-audit/accounts/:userId/summary',
      sectionId: 'overview',
      target: 'managed-organization-account',
    },
    {
      directoryAction: 'review',
      contributionId: 'character-landing-profile',
      description: 'Read-only public profile for one exact disclosed character.',
      icon: 'character',
      label: 'Character profile',
      moduleId: 'member-audit',
      order: 105,
      routeId: 'character-overview',
      routePath: '/api/modules/member-audit/accounts/:userId/characters/:characterId/overview',
      sectionId: 'overview',
      target: 'managed-organization-character',
      placement: 'character-landing',
    },
    ...(observationPermission
      ? [
          {
            directoryAction: 'review',
            contributionId: 'current-observation',
            description: 'Independently authorized current ship and location snapshots.',
            icon: 'location',
            label: 'Current ship and location',
            moduleId: 'member-audit',
            order: 106,
            routeId: 'current-observation-detail',
            routePath:
              '/api/modules/member-audit/accounts/:userId/characters/:characterId/current-observation',
            sectionId: 'current-observation',
            target: 'managed-organization-character',
            placement: 'character-landing',
          },
        ]
      : []),
    ...(blockPermission
      ? [
          {
            directoryAction: 'manage-account',
            contributionId: 'member-block',
            description: 'Block or unblock organization access with an audited reason.',
            icon: 'auth',
            label: 'Member block',
            moduleId: 'member-audit',
            order: 160,
            routeId: 'block-actions',
            routePath: '/api/modules/member-audit/accounts/:userId/block',
            sectionId: 'access-management',
            target: 'managed-organization-account',
          },
        ]
      : []),
    {
      directoryAction: 'review',
      contributionId: 'assets',
      description: 'Review current asset evidence for one disclosed character.',
      icon: 'ship',
      label: 'Assets',
      moduleId: 'member-audit',
      order: 120,
      routeId: 'assets-detail',
      routePath: '/api/modules/member-audit/accounts/:userId/characters/:characterId/assets',
      sectionId: 'assets',
      target: 'managed-organization-character',
    },
  ]
}

const directoryAccountFacts = (stale: boolean) => ({
  auditData: {
    asOf: stale ? '2026-09-18T08:00:00.000Z' : '2026-09-19T08:00:00.000Z',
    covered: stale ? 3 : 7,
    expected: 7,
    state: stale ? 'stale' : 'current',
  },
  block:
    stale || accountBlocked
      ? { blocked: true, blockedAt: '2026-09-19T07:00:00.000Z' }
      : { blocked: false },
  compliance: {
    accessValidUntil: stale ? null : '2026-09-20T08:00:00.000Z',
    evaluatedAt: '2026-09-19T08:00:00.000Z',
    evidenceAt: stale ? null : '2026-09-19T08:00:00.000Z',
    evidenceFreshness: stale ? 'stale' : 'fresh',
    reviewDeadline: stale ? '2026-09-20T08:00:00.000Z' : null,
    state: stale ? 'review_required' : 'compliant',
  },
  groups: stale
    ? [
        { groupId: 'group-alpha', name: 'Alpha' },
        { groupId: 'group-bravo', name: 'Bravo' },
        { groupId: 'group-charlie', name: 'Charlie' },
        { groupId: 'group-delta', name: 'Delta' },
      ]
    : [{ groupId: 'group-alpha', name: 'Alpha' }],
})

function directoryMember(variant: 'remote' | 'review' | 'stale' | 'alt' = 'review') {
  const remote = variant === 'remote'
  const stale = variant === 'stale'
  const alt = variant === 'alt'
  let characterId = targetCharacterId
  let name = 'Review Pilot'
  let userId = targetUserId
  let managedMemberLifecycleId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  if (remote) {
    characterId = 90_000_002
    name = 'Remote Pilot'
    userId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    managedMemberLifecycleId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  }
  if (stale) {
    characterId = 90_000_003
    name = 'Stale Pilot'
    userId = '99999999-9999-4999-8999-999999999999'
    managedMemberLifecycleId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  }
  if (alt) {
    characterId = altCharacterId
    name = 'Review Alt'
  }
  return {
    account: {
      mainCharacter: alt
        ? { characterId: targetCharacterId, name: 'Review Pilot' }
        : { characterId, name },
      userId,
    },
    ...directoryAccountFacts(stale),
    disclosedCharacterCount: 2,
    character: {
      characterId,
      name,
      subjectLifecycleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      authorizationGeneration,
      isMain: !alt,
      affiliation: {
        allianceId: null,
        checkedAt: '2026-09-19T08:00:00.000Z',
        corporationId: remote ? 98_000_002 : 98_000_001,
        membership: alt ? 'approved-external' : 'managed',
        freshness: 'fresh',
      },
    },
    managedMemberLifecycleId,
    managedSince: remote ? '2026-03-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
    siteRegisteredAt: '2025-12-01T00:00:00.000Z',
  }
}

function targetMember() {
  const { character: _character, ...row } = directoryMember('review')
  return {
    ...row,
    managedAffiliation: {
      allianceId: null,
      characterId: targetCharacterId,
      checkedAt: '2026-09-19T08:00:00.000Z',
      corporationId: 98_000_001,
      name: 'Review Pilot',
    },
    characters: [
      {
        affiliation: {
          allianceId: null,
          checkedAt: '2026-09-19T08:00:00.000Z',
          corporationId: 98_000_001,
          freshness: 'fresh',
          membership: 'managed',
        },
        authorizationGeneration,
        characterId: targetCharacterId,
        isMain: true,
        name: 'Review Pilot',
        subjectLifecycleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
    ],
  }
}

function exactTargetMember(characterId = targetCharacterId) {
  const row = directoryMember(characterId === altCharacterId ? 'alt' : 'review')
  return {
    account: row.account,
    block: row.block,
    character: row.character,
    compliance: row.compliance,
    managedMemberLifecycleId: row.managedMemberLifecycleId,
  }
}

function memberSummary() {
  return {
    account: directoryMember('review').account,
    block: { blocked: false },
    characters: targetMember().characters,
    compliance: { evaluatedAt: '2026-09-19T08:00:00.000Z', state: 'compliant' },
    evidence: [
      {
        characterId: targetCharacterId,
        sections: [
          {
            sectionId: 'assets',
            resources: [
              {
                resourceId: 'assets',
                status: 'current',
                validatedAt: '2026-09-19T08:00:00.000Z',
              },
            ],
          },
        ],
      },
    ],
    groups: [],
    managedMemberLifecycleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    organizationVersion: 7,
  }
}
