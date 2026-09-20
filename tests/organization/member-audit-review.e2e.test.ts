// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cacheAdmissionForOrganization } from '../support/cache-admission'
import { startCorsJsonApi } from '../support/cors-json-api'

const targetUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const reviewerCharacterId = 90_000_010
const targetCharacterId = 90_000_001
const recordedRequests: URL[] = []
let apiOrigin = ''
let organizationVersion = 7
let reviewAccessDenied = false

const apiServer = await startCorsJsonApi((request) => {
  const url = new URL(request.url ?? '/', 'http://mock-api.invalid')
  recordedRequests.push(url)

  if (url.pathname === '/auth/config')
    return {
      body: {
        configured: true,
        loginUrl: `${apiOrigin}/auth/eve/login`,
        attachUrl: `${apiOrigin}/auth/eve/attach`,
      },
    }
  if (url.pathname === '/auth/session')
    return {
      body: {
        authenticated: true,
        account: {
          userId: 'reviewer-user',
          mainCharacter: { characterId: reviewerCharacterId, name: 'Reviewer Pilot' },
        },
      },
    }
  if (url.pathname === '/api/admin/session') return { body: { authenticated: false } }
  if (url.pathname === '/api/me/cache-admission')
    return { body: cacheAdmissionForOrganization('reviewer-user', reviewerCharacterId, 7) }
  if (url.pathname === '/api/me/characters') return { body: { characters: [] } }
  if (url.pathname === '/api/modules') return { body: moduleRuntime() }
  if (url.pathname === '/api/organization/review') {
    if (reviewAccessDenied)
      return {
        status: 403,
        body: {
          code: 'ORGANIZATION_REVIEWER_REQUIRED',
          message: 'Organization reviewer authority is required.',
        },
      }
    return { body: { organizationVersion, contributions: contributions() } }
  }
  if (url.pathname === '/api/organization/review/members') {
    const page = directoryPage(url)
    return {
      body: {
        organizationVersion,
        status: 'available',
        groupFacets: [
          { groupId: 'group-alpha', name: 'Alpha' },
          { groupId: 'group-remote', name: 'Remote reviewers' },
        ],
        ...page,
      },
    }
  }
  if (url.pathname === `/api/organization/review/members/${targetUserId}`)
    return { body: { organizationVersion, member: targetMember() } }
  if (url.pathname === `/api/modules/member-audit/accounts/${targetUserId}/summary`)
    return { body: memberSummary() }
  if (
    url.pathname ===
    `/api/modules/member-audit/accounts/${targetUserId}/characters/${targetCharacterId}/assets`
  )
    return {
      body: {
        status: {
          resourceId: 'assets',
          status: 'current',
          validatedAt: '2026-09-19T08:00:00.000Z',
          authorizationGeneration: 4,
          disclosureVersion: 1,
        },
        evidence: { snapshot: { records: [] } },
      },
    }

  return { status: 404, body: { code: 'NOT_FOUND', message: 'Not found.' } }
})

apiOrigin = apiServer.origin
process.env.NUXT_PUBLIC_API_BASE = apiOrigin
process.env.NUXT_PUBLIC_EVE_IMAGE_BASE = apiOrigin

afterAll(apiServer.close)

describe('Member Audit production reviewer journey', async () => {
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

  const openPages = new Set<Page>()

  beforeEach(() => {
    recordedRequests.length = 0
    organizationVersion = 7
    reviewAccessDenied = false
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
    await page.getByRole('heading', { name: 'Select a member' }).waitFor()
    await page.getByRole('table', { name: /Current managed organization accounts/ }).waitFor()
    expect(await page.getByRole('row').count()).toBe(3)
    await page.getByText('Access blocked', { exact: true }).waitFor()
    await page.getByText('3 of 7 covered', { exact: true }).waitFor()
    expect(memberAuditRequests()).toHaveLength(0)

    const managedSinceSort = page.getByRole('button', { name: 'Sort by Managed since' })
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
    const siteRegistered = page.getByRole('checkbox', { name: 'Site registered' })
    await siteRegistered.focus()
    await page.keyboard.press('Space')
    await page.getByRole('columnheader', { name: /Site registered/ }).waitFor()
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
    await page.getByRole('option', { name: 'Stale', exact: true }).click()
    await expect
      .poll(() => directoryRequests().at(-1)?.searchParams.get('auditState'))
      .toBe('stale')
    await page.getByRole('button', { name: 'Select Stale Pilot' }).waitFor()
    expect(await page.getByRole('row').count()).toBe(2)

    await page.getByRole('combobox', { name: 'Audit data filter' }).click()
    await page.getByRole('option', { name: 'All audit states' }).click()
    await page.getByRole('button', { name: 'Next member page' }).click()
    await page.getByRole('button', { name: 'Select Remote Pilot' }).waitFor()
    expect(directoryRequests().at(-1)?.searchParams.get('cursor')).toBe('opaque-next-cursor')

    await page.getByRole('button', { name: 'Previous member page' }).click()
    await page.getByRole('button', { name: 'Select Review Pilot' }).waitFor()
    await page.getByRole('searchbox', { name: 'Member search' }).fill('Review')
    await page.getByRole('button', { name: 'SEARCH' }).click()
    await expect.poll(() => directoryRequests().at(-1)?.searchParams.get('query')).toBe('Review')
    expect(directoryRequests().at(-1)?.searchParams.has('cursor')).toBe(false)

    await page.getByRole('button', { name: 'Select Review Pilot' }).press('Enter')
    await page.getByText('Select a permitted panel to load its private data.').waitFor()
    expect(memberAuditRequests()).toHaveLength(0)

    await page.getByRole('button', { name: 'Member overview' }).click()
    await page.getByText('Organization access data', { exact: true }).waitFor()
    expect(memberAuditRequests().map(({ pathname }) => pathname)).toEqual([
      `/api/modules/member-audit/accounts/${targetUserId}/summary`,
    ])

    const overviewTab = page.getByRole('tab', { name: 'Member overview' })
    await overviewTab.focus()
    await page.keyboard.press('ArrowRight')
    await page.getByText('The current complete observation contains no records.').waitFor()
    expect(await page.getByRole('tab', { name: 'Assets' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(memberAuditRequests().map(({ pathname }) => pathname)).toEqual([
      `/api/modules/member-audit/accounts/${targetUserId}/summary`,
      `/api/modules/member-audit/accounts/${targetUserId}/characters/${targetCharacterId}/assets`,
    ])

    await page.setViewportSize({ width: 390, height: 844 })
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
})

function memberAuditRequests() {
  return recordedRequests.filter(({ pathname }) =>
    pathname.startsWith('/api/modules/member-audit/'),
  )
}

function directoryRequests() {
  return recordedRequests.filter(({ pathname }) => pathname === '/api/organization/review/members')
}

function directoryPage(url: URL) {
  if (url.searchParams.get('cursor') === 'opaque-next-cursor')
    return { items: [directoryMember('remote')], nextCursor: null }
  if (url.searchParams.get('auditState') === 'stale')
    return { items: [directoryMember('stale')], nextCursor: null }
  if (url.searchParams.get('query')?.toLocaleLowerCase('en').includes('review'))
    return { items: [directoryMember('review')], nextCursor: null }
  return {
    items: [directoryMember('review'), directoryMember('stale')],
    nextCursor: 'opaque-next-cursor',
  }
}

function moduleRuntime() {
  return {
    enabledModuleIds: ['member-audit'],
    enabledSections: [
      {
        moduleId: 'member-audit',
        sectionId: 'overview',
        kind: 'workspace',
        disclosureVersion: 1,
        activationVersion: 1,
      },
      {
        moduleId: 'member-audit',
        sectionId: 'assets',
        kind: 'sensitive-evidence',
        disclosureVersion: 1,
        activationVersion: 1,
      },
    ],
    shellNavigationOrder: { dashboard: [], character: [] },
  }
}

function contributions() {
  return [
    {
      moduleId: 'member-audit',
      contributionId: 'overview',
      routeId: 'member-summary',
      routePath: '/api/modules/member-audit/accounts/:userId/summary',
      target: 'managed-organization-account',
      sectionId: 'overview',
      label: 'Member overview',
      description: 'Review identity, compliance, access, and evidence availability.',
      icon: 'overview',
      order: 100,
    },
    {
      moduleId: 'member-audit',
      contributionId: 'assets',
      routeId: 'assets-detail',
      routePath: '/api/modules/member-audit/accounts/:userId/characters/:characterId/assets',
      target: 'managed-organization-character',
      sectionId: 'assets',
      label: 'Assets',
      description: 'Review current asset evidence for one disclosed character.',
      icon: 'ship',
      order: 120,
    },
  ]
}

function directoryMember(variant: 'remote' | 'review' | 'stale' = 'review') {
  const remote = variant === 'remote'
  const stale = variant === 'stale'
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
  return {
    managedMemberLifecycleId,
    managedSince: remote ? '2026-03-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
    siteRegisteredAt: '2025-12-01T00:00:00.000Z',
    account: {
      userId,
      mainCharacter: { characterId, name },
    },
    portraitCharacter: {
      characterId,
      name,
      source: 'main-character',
    },
    managedAffiliation: {
      characterId,
      name,
      corporationId: remote ? 98_000_002 : 98_000_001,
      allianceId: null,
      checkedAt: '2026-09-19T08:00:00.000Z',
    },
    disclosedCharacterCount: remote ? 2 : 1,
    groups: stale
      ? [
          { groupId: 'group-alpha', name: 'Alpha' },
          { groupId: 'group-bravo', name: 'Bravo' },
          { groupId: 'group-charlie', name: 'Charlie' },
          { groupId: 'group-delta', name: 'Delta' },
        ]
      : [{ groupId: 'group-alpha', name: 'Alpha' }],
    compliance: {
      state: stale ? 'review_required' : 'compliant',
      evidenceFreshness: stale ? 'stale' : 'fresh',
      evidenceAt: stale ? null : '2026-09-19T08:00:00.000Z',
      reviewDeadline: stale ? '2026-09-20T08:00:00.000Z' : null,
      accessValidUntil: stale ? null : '2026-09-20T08:00:00.000Z',
      evaluatedAt: '2026-09-19T08:00:00.000Z',
    },
    block: stale ? { blocked: true, blockedAt: '2026-09-19T07:00:00.000Z' } : { blocked: false },
    auditData: {
      state: stale ? 'stale' : 'current',
      expected: 7,
      covered: stale ? 3 : 7,
      asOf: stale ? '2026-09-18T08:00:00.000Z' : '2026-09-19T08:00:00.000Z',
    },
  }
}

function targetMember() {
  return {
    ...directoryMember('review'),
    characters: [
      {
        characterId: targetCharacterId,
        subjectLifecycleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        authorizationGeneration: 4,
        name: 'Review Pilot',
        isMain: true,
        affiliation: {
          corporationId: 98_000_001,
          allianceId: null,
          membership: 'managed',
          freshness: 'fresh',
          checkedAt: '2026-09-19T08:00:00.000Z',
        },
      },
    ],
  }
}

function memberSummary() {
  return {
    organizationVersion: 7,
    managedMemberLifecycleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    account: directoryMember('review').account,
    characters: targetMember().characters,
    compliance: { state: 'compliant', evaluatedAt: '2026-09-19T08:00:00.000Z' },
    groups: [],
    block: { blocked: false },
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
  }
}
