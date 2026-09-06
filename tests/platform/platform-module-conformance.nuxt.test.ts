import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../support/cors-json-api'

let moduleEnabled = true
let featureRequests = 0
const apiServer = await startCorsJsonApi((request) => {
  if (request.url?.startsWith('/api/modules/conformance/characters/')) {
    featureRequests += 1
    const characterId = Number(request.url.match(/characters\/(\d+)/)?.[1])
    if (characterId === 9)
      return {
        status: 403,
        body: {
          code: 'ORGANIZATION_PERMISSION_REQUIRED',
          message: 'Conformance permission is required.',
        },
      }
    return {
      body: {
        characterId,
        corporationId: 98_000_001,
        organizationVersion: 4,
        view: 'summary',
        resource: {
          status: characterId === 8 ? 'stale' : 'current',
          authorizationGeneration: 2,
          lastFailureClass: null,
          validatedAt: '2026-09-06T20:00:00Z',
        },
      },
    }
  }
  return {
    body: {
      enabledModuleIds: moduleEnabled ? ['conformance'] : [],
      shellNavigationOrder: {
        dashboard: moduleEnabled
          ? [{ ownerId: 'conformance', navigationId: 'conformance-activity-navigation' }]
          : [],
        character: [],
      },
    },
  }
})
process.env.NUXT_PUBLIC_API_BASE = apiServer.origin

afterAll(apiServer.close)

describe('module conformance Nuxt production fixture', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/platform-module-conformance', import.meta.url)),
    browser: true,
    server: true,
    setupTimeout: 120_000,
  })

  it('runs the final-route typed query and shared confirmation and announcement states', async () => {
    moduleEnabled = true
    apiServer.setAllowedOrigin(useTestContext().url)
    const page = await createPage('/conformance/7')

    await page
      .getByText('Character 7 belongs to corporation 98000001.', { exact: true })
      .waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Confirm activity' }).click()
    expect(await page.getByRole('dialog').textContent()).toContain('Confirm conformance activity')
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    const liveRegion = page.locator('.nuxt-announcer [aria-live]')
    expect(await liveRegion.count()).toBe(1)
    expect(await liveRegion.textContent()).toBe('Conformance activity confirmed.')
  })

  it('renders shared stale and authorization-required resource states', async () => {
    moduleEnabled = true
    let page = await createPage('/conformance/8')
    await page
      .getByText('Character 8 belongs to corporation 98000001.', { exact: true })
      .waitFor({ state: 'visible' })
    expect(await page.locator('body').innerText()).toContain(
      'Showing the last production-shaped fixture snapshot.',
    )
    await page.close()

    page = await createPage('/conformance/9')
    await page
      .getByText('Conformance authorization required', { exact: true })
      .waitFor({ state: 'visible' })
    await page.close()
  })

  it('blocks a disabled module page before its typed feature query executes', async () => {
    moduleEnabled = false
    const requestsBefore = featureRequests

    await expect($fetch('/conformance/7')).rejects.toMatchObject({ statusCode: 404 })
    expect(featureRequests).toBe(requestsBefore)
  })
})
