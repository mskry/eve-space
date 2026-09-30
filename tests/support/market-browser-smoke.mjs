import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const origin = process.env.MARKET_PREVIEW_ORIGIN ?? 'http://localhost:3002'
const fixtureOrigin = process.env.MARKET_FIXTURE_ORIGIN ?? 'http://localhost:9876'
const browser = await chromium.launch({ headless: true })
const catalogueRequests = []
const pageErrors = []
const hydrationMessages = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('request', (request) => {
    if (request.url().includes('/market/catalogue/')) catalogueRequests.push(request.url())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('Hydration')) hydrationMessages.push(message.text())
  })
  await page.goto(`${origin}/market`, { waitUntil: 'networkidle' })
  assert.equal(await page.title(), 'Market · EVE Space')
  assert.equal(catalogueRequests.length, 0, 'SSR tree was fetched again on hydration')
  const revalidation = await page.evaluate(async (apiOrigin) => {
    const response = await fetch(
      `${apiOrigin}/api/modules/market/catalogue/body/fixture-revision/tree`,
      {
        credentials: 'include',
        headers: { 'If-None-Match': 'W/"fixture-revision-tree"' },
      },
    )
    return { status: response.status, cache: response.headers.get('Cache-Control') }
  }, fixtureOrigin)
  assert.equal(revalidation.status, 304)
  assert.equal(revalidation.cache, 'public, max-age=31536000, immutable')
  const ships = page.getByRole('treeitem', { name: /^Ships,.*subgroups/ })
  await ships.focus()
  await page.keyboard.press('Enter')
  assert.equal(await ships.getAttribute('aria-expanded'), 'true')
  await page.getByRole('treeitem', { name: /^Frigates,.*subgroups/ }).click()
  await page.getByRole('treeitem', { name: /^Minmatar,.*direct items/ }).click()
  await page.getByRole('treeitem', { name: 'Group item 100', exact: true }).waitFor()
  assert.equal(catalogueRequests.filter((url) => url.includes('/groups/')).length, 1)
  await page.getByRole('treeitem', { name: 'Group item 1', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForURL(/typeId=1/)
  assert.match(page.url(), /typeId=1/)
  await page.getByText('Ships / Frigates / Minmatar').waitFor()
  await page.getByRole('treeitem', { name: 'Group item 100', exact: true }).scrollIntoViewIfNeeded()
  await page.getByRole('treeitem', { name: 'Group item 101', exact: true }).waitFor()
  assert.equal(catalogueRequests.filter((url) => url.includes('/groups/')).length, 2)
  await page.locator('#market-item-search').focus()
  await page.locator('#market-item-search').fill('Rif')
  assert.equal(catalogueRequests.filter((url) => url.includes('/search-index')).length, 0)
  await page.locator('#market-item-search').fill('Rift')
  await page.getByRole('button', { name: 'Rifter', exact: true }).waitFor()
  assert.equal(catalogueRequests.filter((url) => url.includes('/search-index')).length, 1)
  assert.equal(page.workers().length, 2)
  await page.locator('#market-item-search').fill('Rifte')
  assert.equal(catalogueRequests.filter((url) => url.includes('/search-index')).length, 1)
  await page.getByRole('button', { name: 'Rifter', exact: true }).click()
  await page.waitForURL(/typeId=587/)
  assert.match(page.url(), /typeId=587/)
  await page.request.post(`${fixtureOrigin}/__fixture/revision`)
  await page.reload({ waitUntil: 'networkidle' })
  await Promise.all([
    page.waitForRequest((request) =>
      request.url().includes('/body/fixture-revision-v2/search-index'),
    ),
    page.locator('#market-item-search').fill('Rift'),
  ])
  await page.getByText('Ships / Frigates / Minmatar').waitFor()
  assert.match(page.url(), /typeId=587/)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Add to Quickbar' }).click()
  await page.getByRole('tab', { name: 'Quickbar' }).click()
  await page.getByRole('treeitem', { name: /Rifter/ }).waitFor()
  await page.getByRole('button', { name: 'New folder', exact: true }).click()
  await page.getByRole('textbox', { name: 'Folder name' }).fill('Ships')
  await page.getByRole('textbox', { name: 'Folder name' }).press('Enter')
  await page.getByRole('button', { name: 'Move Rifter to folder' }).click()
  await page
    .getByRole('group', { name: 'Move Rifter to' })
    .getByRole('button', { name: 'Ships', exact: true })
    .click()
  await page.locator('.market-quickbar-folder').first().click()
  assert.equal(await page.locator('.market-quickbar-folder .market-quickbar-item').count(), 1)
  await page.getByRole('button', { name: 'More Quickbar actions' }).click()
  await page.getByRole('menuitem', { name: 'Export to clipboard' }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '+ Ships\n- Rifter')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'Quickbar' }).click()
  await page.locator('.market-quickbar-folder').first().waitFor()
  await page.evaluate(() => navigator.clipboard.writeText('Synthetic Market Item 0'))
  await page.getByRole('button', { name: 'More Quickbar actions' }).click()
  await page.getByRole('menuitem', { name: 'Import from clipboard' }).click()
  await page
    .getByRole('treeitem', { name: /Synthetic Market Item 0/ })
    .dragTo(page.locator('.market-quickbar-folder').first())
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('eve-space-market-quickbar-v1') ?? '{}')
    return Object.values(saved).some((folder) => folder.types?.includes(1_000_000))
  })
  await page.getByRole('button', { name: 'More Quickbar actions' }).click()
  await page.getByRole('menuitem', { name: 'Clear Quickbar' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear Quickbar' }).click()
  await page.getByText('Quickbar is empty', { exact: true }).waitFor()

  const profileId = '00000000-0000-4000-8000-000000000001'
  const secondProfileId = '00000000-0000-4000-8000-000000000003'
  const overviewRequests = []
  page.on('request', (request) => {
    if (request.url().includes('/market/books/') || request.url().includes('/market/history/'))
      overviewRequests.push(request.url())
  })
  await page.goto(`${origin}/market?typeId=587&profileId=${profileId}`, {
    waitUntil: 'networkidle',
  })
  await page.getByRole('heading', { name: 'Rifter' }).waitFor()
  await page.getByText('Ships / Frigates / Minmatar').waitFor()
  assert.equal(
    await page.locator('.market-catalogue-page__detail-heading img[width="64"]').count(),
    1,
  )
  const headerGeometry = await page.evaluate(() => {
    const header = document.querySelector('.market-catalogue-page__detail-heading')
    const icon = header?.querySelector('img')?.getBoundingClientRect()
    const path = header?.querySelector('.market-catalogue-page__path')?.getBoundingClientRect()
    const name = header?.querySelector('h2')?.getBoundingClientRect()
    const action = header?.querySelector('button')?.getBoundingClientRect()
    return { iconY: icon?.y, pathY: path?.y, nameY: name?.y, actionY: action?.y }
  })
  assert.ok(headerGeometry.pathY >= headerGeometry.iconY)
  assert.ok(headerGeometry.nameY > headerGeometry.pathY)
  assert.ok(headerGeometry.actionY >= headerGeometry.iconY)
  await page.getByRole('region', { name: 'Sellers' }).getByRole('row').first().waitFor()
  assert.equal(overviewRequests.length, 0, 'SSR book was fetched again on hydration')
  assert.equal(await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').count(), 2)
  assert.equal(await page.getByRole('region', { name: 'Buyers' }).locator('tbody tr').count(), 1)
  const headerAlignment = await page.evaluate(() =>
    [...document.querySelectorAll('section[aria-label="Sellers"] thead th')].map((cell) => ({
      label: cell.textContent?.trim(),
      align: getComputedStyle(cell).textAlign,
    })),
  )
  assert.equal(headerAlignment.find(({ label }) => label?.startsWith('Qty'))?.align, 'right')
  assert.equal(headerAlignment.find(({ label }) => label?.startsWith('Price'))?.align, 'right')
  assert.equal(headerAlignment.find(({ label }) => label?.startsWith('Location'))?.align, 'left')
  await page.route(`**/market/books/profiles/${profileId}/types/1/observation`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900))
    await route.continue().catch(() => {})
  })
  await page.getByRole('treeitem', { name: /^Ships,.*subgroups/ }).click()
  await page.getByRole('treeitem', { name: /^Frigates,.*subgroups/ }).click()
  await page.getByRole('treeitem', { name: /^Minmatar,.*direct items/ }).click()
  await page.getByRole('treeitem', { name: 'Group item 1', exact: true }).waitFor()
  await page.locator('.market-catalogue-item').first().hover()
  const treeHover = await page
    .locator('.market-catalogue-item')
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor)
  await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').first().hover()
  const orderHover = await page
    .getByRole('region', { name: 'Sellers' })
    .locator('tbody tr')
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor)
  assert.equal(orderHover, treeHover)
  await Promise.all([
    page.waitForRequest((request) => request.url().includes(`/types/1/observation`)),
    page.getByRole('treeitem', { name: 'Group item 1', exact: true }).click(),
  ])
  await page.locator('#market-item-search').fill('Rift')
  await page.getByRole('button', { name: 'Rifter', exact: true }).click()
  await page.getByRole('heading', { name: 'Rifter' }).waitFor()
  await page.waitForTimeout(1_000)
  assert.doesNotMatch(await page.getByRole('region', { name: 'Sellers' }).innerText(), /99\.00 ISK/)
  await page.getByRole('button', { name: 'Sort visible Sellers orders by Price' }).click()
  assert.match(
    await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').first().innerText(),
    /5\.00 ISK/,
  )
  await page.locator('#market-item-search').fill('')
  await page.getByRole('treeitem', { name: /^Ships,.*subgroups/ }).click()
  await page.getByRole('treeitem', { name: /^Frigates,.*subgroups/ }).click()
  await page.getByRole('treeitem', { name: /^Minmatar,.*direct items/ }).click()
  await page.getByRole('treeitem', { name: 'Group item 35', exact: true }).click()
  await page.waitForURL(/typeId=35/)
  await page.getByText('No orders in this ESI regional observation.').waitFor()
  assert.equal(await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').count(), 0)
  assert.doesNotMatch(await page.getByRole('region', { name: 'Sellers' }).innerText(), /5\.00 ISK/)
  await page.locator('#market-item-search').fill('Rift')
  await page.getByRole('button', { name: 'Rifter', exact: true }).click()
  await page.waitForURL(/typeId=587/)
  await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').first().waitFor()
  const large = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await large.goto(`${origin}/market?typeId=40520&profileId=${profileId}`, {
    waitUntil: 'networkidle',
  })
  const largeSellers = large.getByRole('region', { name: 'Sellers' })
  await largeSellers.getByText('Showing 1–100 sellers orders.').waitFor()
  assert.equal(await largeSellers.getByRole('button', { name: 'Previous' }).count(), 0)
  assert.equal(await largeSellers.getByRole('button', { name: 'Next' }).count(), 0)
  await largeSellers.locator('.market-order-table__scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll'))
  })
  await largeSellers.getByText('Showing 101–103 sellers orders.').waitFor()
  assert.ok((await largeSellers.locator('tbody tr').count()) <= 101)
  await largeSellers.locator('.market-order-table__scroll').evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await largeSellers.getByText('Showing 1–100 sellers orders.').waitFor()
  await large.close()
  const plexProfileId = '00000000-0000-4000-8000-000000000004'
  const plex = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const plexHydrationRequests = []
  plex.on('request', (request) => {
    if (request.url().includes('/types/44992/observation'))
      plexHydrationRequests.push(request.url())
  })
  await plex.goto(`${origin}/market?typeId=44992`, { waitUntil: 'networkidle' })
  await plex.getByRole('heading', { name: 'PLEX' }).waitFor()
  await plex.waitForURL((url) => url.searchParams.get('profileId') === plexProfileId)
  assert.equal(
    plexHydrationRequests.length,
    0,
    'SSR global PLEX book was fetched again on hydration',
  )
  assert.equal(await plex.getByLabel('Supported market').inputValue(), plexProfileId)
  await plex.getByRole('region', { name: 'Sellers' }).getByText('4,921,000.00 ISK').waitFor()
  await plex.getByRole('tab', { name: 'Price History' }).click()
  await plex.getByText(/Region 19000001 · Daily Average/).waitFor()
  await plex.getByRole('tab', { name: 'Order book' }).click()
  await plex.getByLabel('Supported market').selectOption(profileId)
  await plex.getByText('No orders in this ESI regional observation.').waitFor()
  await plex.getByText('PLEX orders use the Global PLEX Market.').waitFor()
  await plex.getByLabel('Supported market').selectOption(plexProfileId)
  await plex.getByRole('region', { name: 'Sellers' }).getByText('4,921,000.00 ISK').waitFor()
  await plex.locator('#market-item-search').fill('Rift')
  await plex.getByRole('button', { name: 'Rifter', exact: true }).click()
  await plex.waitForURL(/typeId=587/)
  await plex.getByRole('region', { name: 'Sellers' }).getByText('2.00 ISK').waitFor()
  assert.equal(await plex.getByLabel('Supported market').inputValue(), profileId)
  assert.equal(await plex.locator('#market-public-profile option').count(), 2)
  await plex.close()
  await page.getByRole('tab', { name: 'Price History' }).click()
  await page.getByRole('table', { name: /Daily regional price history/ }).waitFor()
  assert.equal(
    await page
      .getByRole('table', { name: /Daily regional price history/ })
      .locator('tbody tr')
      .count(),
    21,
  )
  await page.getByRole('slider', { name: 'Inspect date' }).focus()
  await page.keyboard.press('End')
  assert.match(
    await page.getByRole('slider', { name: 'Inspect date' }).getAttribute('aria-valuetext'),
    /2026-09-21/,
  )
  await Promise.all([
    page.waitForRequest((request) =>
      request.url().includes(`/market/history/profiles/${secondProfileId}/`),
    ),
    page.getByLabel('Supported market').selectOption(secondProfileId),
  ])
  await page.waitForURL((url) => url.searchParams.get('profileId') === secondProfileId)
  assert.equal(new URL(page.url()).searchParams.get('typeId'), '587')
  assert.ok(overviewRequests.some((url) => url.includes(secondProfileId)))
  await page.request.post(`${fixtureOrigin}/__fixture/market-state`, {
    data: { book: 'empty', history: 'one-day' },
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'Order book' }).click()
  await page.getByText('No sell orders observed.').waitFor()
  const emptySideHeights = await page.evaluate(() =>
    [...document.querySelectorAll('.market-order-table')].map(
      (section) => section.getBoundingClientRect().height,
    ),
  )
  assert.ok(emptySideHeights.every((height) => height >= 288))
  await page.getByRole('tab', { name: 'Price History' }).click()
  await page.getByText('Only one day is available').waitFor()
  await page.request.post(`${fixtureOrigin}/__fixture/market-state`, {
    data: { book: 'failed', history: 'complete' },
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'Order book' }).click()
  assert.equal(await page.getByText('Source details', { exact: true }).count(), 0)
  assert.equal(await page.getByText('This complete order book is stale.').count(), 0)
  assert.equal(await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').count(), 2)
  await page.request.post(`${fixtureOrigin}/__fixture/market-state`, {
    data: { book: 'uncollected' },
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'Order book' }).click()
  await page.getByText(/No complete order observation has been collected/).waitFor()
  await page.request.post(`${fixtureOrigin}/__fixture/market-state`, {
    data: { book: 'unavailable' },
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'Order book' }).click()
  await page.getByText('Market order source is unavailable').waitFor()
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(hydrationMessages, [])

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  })
  const mobileHistoryRequests = []
  mobile.on('request', (request) => {
    if (request.url().includes('/market/history/')) mobileHistoryRequests.push(request.url())
  })
  await mobile.goto(`${origin}/market?typeId=587&profileId=${profileId}&tab=history`, {
    waitUntil: 'networkidle',
  })
  await mobile.getByRole('table', { name: /Daily regional price history/ }).waitFor()
  assert.equal(mobileHistoryRequests.length, 0, 'SSR history was fetched again on hydration')
  await mobile.emulateMedia({ reducedMotion: 'reduce' })
  await mobile.getByRole('slider', { name: 'Inspect date' }).focus()
  await mobile.keyboard.press('ArrowRight')
  assert.match(
    await mobile.getByRole('slider', { name: 'Inspect date' }).getAttribute('aria-valuetext'),
    /2026-09-02/,
  )
  await mobile.getByLabel('Daily history table; scroll to inspect columns').focus()
  const layout = await mobile.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    columns: getComputedStyle(document.querySelector('.market-catalogue-page__workspace'))
      .gridTemplateColumns,
  }))
  assert.ok(layout.document <= layout.viewport, 'Market page overflows mobile viewport')
  await page.request.post(`${fixtureOrigin}/__fixture/market-state`, { data: { disabled: true } })
  const disabledRequests = []
  const disabled = await browser.newPage()
  disabled.on('request', (request) => {
    if (request.url().includes('/market/books/') || request.url().includes('/market/history/'))
      disabledRequests.push(request.url())
  })
  await disabled.goto(`${origin}/market?typeId=587`, { waitUntil: 'networkidle' })
  assert.equal(disabledRequests.length, 0, 'disabled Market requested public data')
  await disabled.close()
  await page.request.post(`${fixtureOrigin}/__fixture/market-state`, {
    data: { disabled: false, book: 'complete' },
  })
  console.log(
    JSON.stringify({
      desktop: {
        hydrationCatalogueRequests: 0,
        initialGroupPageRequests: 2,
        initialSearchIndexRequests: 1,
        workers: 2,
        replacementRevision: 'fixture-revision-v2',
        quickbar: 'pin/folder/move/import/export/drag/reload/clear',
      },
      mobile: layout,
      pageErrors,
    }),
  )
  await mobile.close()
  await page.close()
} finally {
  await browser.close()
}
