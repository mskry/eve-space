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
  if (url.pathname === '/api/organization/review')
    return { body: { organizationVersion: 7, contributions: contributions() } }
  if (url.pathname === '/api/organization/review/members')
    return {
      body: {
        organizationVersion: 7,
        status: 'available',
        items: [directoryMember()],
        nextCursor: null,
      },
    }
  if (url.pathname === `/api/organization/review/members/${targetUserId}`)
    return { body: { organizationVersion: 7, member: targetMember() } }
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
    apiServer.setAllowedOrigin(useTestContext().url)
  })

  afterEach(async () => {
    await Promise.all(Array.from(openPages, (page) => page.close()))
    openPages.clear()
  })

  it('loads private evidence only after explicit keyboard selection and fits a mobile viewport', async () => {
    const html = await $fetch('/organization/review')
    expect(html).toContain('Verifying reviewer identity')
    expect(memberAuditRequests()).toHaveLength(0)

    const page = await createPage('/organization/review')
    openPages.add(page)
    await page.getByRole('heading', { name: 'Select a member' }).waitFor()
    await page.getByRole('button', { name: /Review Pilot/ }).click()
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
    expect(
      await page.evaluate(() => ({
        body: document.body.scrollWidth,
        viewport: document.documentElement.clientWidth,
      })),
    ).toEqual({ body: 390, viewport: 390 })
    expect(await page.locator('[tabindex="1"], [tabindex="2"]').count()).toBe(0)
  })
})

function memberAuditRequests() {
  return recordedRequests.filter(({ pathname }) =>
    pathname.startsWith('/api/modules/member-audit/'),
  )
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

function directoryMember() {
  return {
    managedMemberLifecycleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    account: {
      userId: targetUserId,
      mainCharacter: { characterId: targetCharacterId, name: 'Review Pilot' },
    },
    managedAffiliation: {
      characterId: targetCharacterId,
      name: 'Review Pilot',
      corporationId: 98_000_001,
      allianceId: null,
      checkedAt: '2026-09-19T08:00:00.000Z',
    },
  }
}

function targetMember() {
  return {
    ...directoryMember(),
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
    account: directoryMember().account,
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
