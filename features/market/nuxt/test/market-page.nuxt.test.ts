import type { GraphQLJSONObject } from '@eve-space/platform-module-nuxt/runtime'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQueryCache } from '@pinia/colada'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import MarketPage from '../src/runtime/app/pages/MarketPage.vue'
import UiProvider from '../../../../layers/ui/app/components/ui/UiProvider.vue'
import {
  MarketBookDocument,
  MarketItemDocument,
  MarketProfilesDocument,
} from '../src/runtime/app/market-graphql'
import { clearQueryCache } from '../../../../tests/support/clear-query-cache'

const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }))
vi.mock('../src/runtime/app/market-search-worker', () => ({
  createMarketSearchWorker: mocks.createWorker,
}))

const item = { id: 1, groupId: 19, name: 'Test market item' }
const revision = { buildNumber: 1, ingestVersion: 5, ingestedAt: '2026-09-24' }
const catalogue = (key: string) => ({
  key,
  tree: { kind: 'tree', complete: true, groups: [], revision: { ...revision, ingestedAt: key } },
})
const searchIndex = (key: string) => ({
  kind: 'search-index',
  complete: true,
  types: [item],
  revision: { ...revision, ingestedAt: key },
})
const mountedWrappers: { unmount: () => void }[] = []

const mountPage = async () => {
  useQueryCache().setQueryData(['market', 'catalogue', 'current-tree'], catalogue('revision-a'))
  const wrapper = await mountSuspended(MarketPage, {
    route: false,
    global: { stubs: { MarketCatalogueTree: true } },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  clearQueryCache()
  localStorage.clear()
  mocks.createWorker.mockReset()
  mocks.createWorker.mockImplementation(() => ({
    search: vi.fn().mockResolvedValue([{ item, score: 0 }]),
    terminate: vi.fn(),
  }))
})

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  clearQueryCache()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('shows an index request failure and retries through loading to results', async () => {
  const retryResponse = Promise.withResolvers<Response>()
  let retrying = false
  const requests = vi.fn(() => {
    if (retrying) return retryResponse.promise
    return Promise.resolve(new Response('{}', { status: 503 }))
  })
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('/market/catalogue/body/revision-a/search-index')) return requests()
    return originalFetch(input, init)
  })
  const wrapper = await mountPage()
  await wrapper.get('input[type="search"]').setValue('test')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Market search is unavailable'), {
    timeout: 5000,
  })
  expect(wrapper.text()).not.toContain('Searching market items')
  expect(wrapper.text()).not.toContain('No matching items')
  const retry = wrapper.findAll('button').find((button) => button.text() === 'Retry search')
  expect(retry).toBeDefined()
  const failedAttempts = requests.mock.calls.length
  retrying = true
  await retry!.trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Searching market items'))
  expect(wrapper.text()).not.toContain('Market search is unavailable')
  retryResponse.resolve(
    new Response(JSON.stringify(searchIndex('revision-a')), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  await vi.waitFor(() =>
    expect(wrapper.get('[aria-label="Market search results"]').text()).toContain(item.name),
  )
  await wrapper.get('button[aria-label="Add Test market item to Quickbar"]').trigger('click')
  expect(
    wrapper
      .get('button[aria-label="Remove Test market item from Quickbar"]')
      .attributes('aria-pressed'),
  ).toBe('true')
  expect(wrapper.text()).toContain('Select an item')
  await wrapper.get('button[aria-label="Remove Test market item from Quickbar"]').trigger('click')
  expect(
    wrapper.get('button[aria-label="Add Test market item to Quickbar"]').attributes('aria-pressed'),
  ).toBe('false')
  expect(requests).toHaveBeenCalledTimes(failedAttempts + 1)
})

const lastViewedItemKey = 'eve-space-market-last-item-v1'
const directItem = { id: 35912, groupId: 19, name: 'Standup Generator' }
const publicProfiles = [
  {
    profileId: 'forge',
    revision: 1,
    regionId: 10000002,
    marketScope: 'region' as const,
    mode: 'region' as const,
    stationIds: [],
    watchedTypeIds: [],
  },
  {
    profileId: 'global-plex',
    revision: 1,
    regionId: 19000001,
    marketScope: 'global-plex' as const,
    mode: 'watched-types' as const,
    stationIds: [],
    watchedTypeIds: [44992],
  },
]
type DirectMarketPageOptions = {
  readonly route?: string
  readonly item?: typeof directItem
  readonly profiles?: readonly (typeof publicProfiles)[number][]
}

const marketResponse = (market: GraphQLJSONObject) =>
  Promise.resolve(
    new Response(JSON.stringify({ data: { market } }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const mountDirectMarketPage = async (options: DirectMarketPageOptions = {}) => {
  const viewedItem = options.item ?? directItem
  useQueryCache().setQueryData(['market', 'catalogue', 'current-tree'], {
    key: 'revision-a',
    tree: {
      kind: 'tree',
      complete: true,
      revision: { ...revision, ingestedAt: 'revision-a' },
      groups: [{ id: 19, parentId: null, name: 'Trade Goods', iconId: null, directTypeCount: 1 }],
    },
  })
  useQueryCache().setQueryData(['market', 'catalogue', 'revision-a', 'search-index'], {
    ...searchIndex('revision-a'),
    types: [viewedItem],
  })
  let clipboardText = ''
  const clipboard = {
    read: vi.fn(async () => []),
    readText: vi.fn(async () => clipboardText),
    write: vi.fn(async () => {}),
    writeText: vi.fn(async (text: string) => {
      clipboardText = text
    }),
  } satisfies Clipboard
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(clipboard)
  const requests: string[] = []
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    requests.push(url)
    if (url.endsWith('/api/modules')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            enabledModuleIds: ['market'],
            enabledSections: [],
            shellNavigationOrder: { dashboard: [], character: [] },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    if (url.endsWith('/api/graphql')) {
      // SAFETY: this intercepts the configured transport’s serialized generated documents and variables.
      const body = JSON.parse(String(init?.body)) as {
        query: string
        variables: { profileId?: string; typeId?: string }
      }
      if (body.query === MarketItemDocument.toString())
        return marketResponse({
          catalogueType: {
            revision: 'revision-a',
            item: { ...viewedItem, id: String(viewedItem.id), groupId: String(viewedItem.groupId) },
          },
        })
      if (body.query === MarketProfilesDocument.toString())
        return marketResponse({
          profiles: (options.profiles ?? []).map((profile) =>
            Object.assign({}, profile, {
              revision: String(profile.revision),
              regionId: String(profile.regionId),
              watchedTypeIds: profile.watchedTypeIds.map(String),
            }),
          ),
        })
      if (body.query === MarketBookDocument.toString()) {
        requests.push(`book:${body.variables.profileId}:${body.variables.typeId}`)
        return marketResponse({
          book: {
            profileId: body.variables.profileId,
            profileRevision: '1',
            typeId: body.variables.typeId,
            status: 'uncollected',
            collectionStatus: 'ready',
            replacement: null,
            observation: null,
          },
        })
      }
      throw new Error('Unexpected Market operation')
    }
    return originalFetch(input, init)
  })
  const Host = defineComponent({
    setup: () => () => h(UiProvider, null, { default: () => h(MarketPage) }),
  })
  const wrapper = await mountSuspended(Host, {
    route: options.route ?? '/market?typeId=35912',
    global: { stubs: { MarketCatalogueTree: true } },
  })
  mountedWrappers.push(wrapper)
  const setClipboardText = (text: string) => {
    clipboardText = text
  }
  return { wrapper, requests, clipboard, setClipboardText }
}

test('resolves a direct type link without loading the search index', async () => {
  const { wrapper, requests } = await mountDirectMarketPage()
  await vi.waitFor(() => expect(wrapper.text()).toContain('Standup Generator'))
  const header = wrapper.get('.market-catalogue-page__detail-heading')
  expect(header.get('.market-catalogue-page__path').text()).toContain('Trade Goods')
  expect(header.get('h2').text()).toBe('Standup Generator')
  expect(header.find('img[width="48"]').exists()).toBe(true)
  expect(header.get('button').attributes('aria-label')).toBe('Add to Quickbar')
  await vi.waitFor(() => expect(wrapper.text()).toContain('No public market is configured'))
  expect(requests.some((url) => url.includes('/search-index'))).toBe(false)
})

test('opens PLEX only in its global market and hides the market selector', async () => {
  const { wrapper, requests } = await mountDirectMarketPage({
    item: { id: 44992, groupId: 19, name: 'PLEX' },
    profiles: publicProfiles,
    route: '/market?typeId=44992&profileId=forge',
  })
  await vi.waitFor(() => expect(wrapper.text()).toContain('No complete order observation'))
  expect(wrapper.find('select[aria-label="Supported market"]').exists()).toBe(false)
  expect(wrapper.get('.market-catalogue-page__detail-heading').text()).not.toContain(
    'Global PLEX Market',
  )
  await vi.waitFor(() =>
    expect(requests.some((url) => url === 'book:global-plex:44992')).toBe(true),
  )
  expect(requests.some((url) => url.startsWith('book:forge:'))).toBe(false)
})

test('keeps the regional selector available for other items', async () => {
  const { wrapper } = await mountDirectMarketPage({ profiles: publicProfiles })
  await vi.waitFor(() =>
    expect(wrapper.find('select[aria-label="Supported market"]').exists()).toBe(true),
  )
  expect(wrapper.get('select[aria-label="Supported market"]').text()).toBe('The Forge')
})

test('restores the last viewed item when opening Market without a type link', async () => {
  localStorage.setItem(lastViewedItemKey, '35912')
  const { wrapper, requests } = await mountDirectMarketPage({ route: '/market' })
  await vi.waitFor(() => expect(wrapper.text()).toContain('Standup Generator'))
  expect(requests.some((url) => url.includes('/search-index'))).toBe(false)
})

test('a direct item link takes precedence and becomes the last viewed item', async () => {
  localStorage.setItem(lastViewedItemKey, '44992')
  const { wrapper, requests } = await mountDirectMarketPage()
  await vi.waitFor(() => expect(wrapper.text()).toContain('Standup Generator'))
  await vi.waitFor(() => expect(localStorage.getItem(lastViewedItemKey)).toBe('35912'))
  expect(requests.some((url) => url.includes('/types/44992'))).toBe(false)
})

test.each(['not-an-id', '0', '9007199254740992'])(
  'ignores invalid stored item %s without requesting it',
  async (stored) => {
    localStorage.setItem(lastViewedItemKey, stored)
    const { wrapper, requests } = await mountDirectMarketPage({ route: '/market' })
    expect(wrapper.text()).toContain('Select an item')
    expect(requests.some((url) => url.includes('/types/'))).toBe(false)
  },
)

test('opens an explicit item when browser storage is blocked', async () => {
  vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
    throw new Error('Browser storage is blocked')
  })
  const { wrapper } = await mountDirectMarketPage()
  await vi.waitFor(() => expect(wrapper.text()).toContain('Standup Generator'))
})

test('reports Quickbar pin and unpin through shared toasts', async () => {
  const { wrapper } = await mountDirectMarketPage()
  await vi.waitFor(() => expect(wrapper.text()).toContain('Standup Generator'))
  const header = wrapper.get('.market-catalogue-page__detail-heading')
  await header.get('button').trigger('click')
  await vi.waitFor(() => expect(wrapper.get('.ui-toast-title').text()).toBe('Added to Quickbar'))
  expect(wrapper.get('.ui-toast-description').text()).toBe('Standup Generator was pinned.')
  await header.get('button').trigger('click')
  await vi.waitFor(() =>
    expect(wrapper.get('.ui-toast-title').text()).toBe('Removed from Quickbar'),
  )
  expect(wrapper.get('.ui-toast-description').text()).toBe('Standup Generator was unpinned.')
})

const runQuickbarMenuAction = async (
  wrapper: Awaited<ReturnType<typeof mountDirectMarketPage>>['wrapper'],
  label: string,
) => {
  await wrapper
    .get('button[aria-label="More Quickbar actions"]')
    .trigger('keydown', { key: 'Enter' })
  let menuItem: HTMLElement | undefined
  await vi.waitFor(() => {
    menuItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent?.trim() === label,
    )
    expect(menuItem).toBeDefined()
  })
  menuItem?.click()
}

test('reports Quickbar export, clear, import and invalid import through shared toasts', async () => {
  const { wrapper, clipboard, setClipboardText } = await mountDirectMarketPage()
  await vi.waitFor(() => expect(wrapper.text()).toContain('Standup Generator'))
  const header = wrapper.get('.market-catalogue-page__detail-heading')
  await header.get('button').trigger('click')
  const quickbarTab = wrapper
    .findAll('[role="tab"]')
    .find((tab) => tab.text().startsWith('Quickbar'))
  await quickbarTab?.trigger('click')
  await vi.waitFor(() =>
    expect(wrapper.get('.market-quickbar-panel__summary').text()).toBe('1 item'),
  )
  await runQuickbarMenuAction(wrapper, 'Export to clipboard')
  await vi.waitFor(() => expect(wrapper.get('.ui-toast-title').text()).toBe('Quickbar copied'))
  expect(wrapper.get('.ui-toast-description').text()).toContain('1 saved item')
  expect(clipboard.writeText).toHaveBeenCalledOnce()
  await runQuickbarMenuAction(wrapper, 'Clear Quickbar')
  let confirmClear: HTMLButtonElement | undefined
  await vi.waitFor(() => {
    confirmClear = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((button) => button.textContent?.trim() === 'Clear Quickbar')
    expect(confirmClear).toBeDefined()
  })
  confirmClear?.click()
  await vi.waitFor(() => expect(wrapper.get('.ui-toast-title').text()).toBe('Quickbar cleared'))
  expect(wrapper.get('.ui-toast-description').text()).toContain('1 saved item')
  expect(wrapper.text()).toContain('Quickbar is empty')
  await runQuickbarMenuAction(wrapper, 'Import from clipboard')
  await vi.waitFor(() => expect(wrapper.get('.ui-toast-title').text()).toBe('Quickbar imported'))
  expect(wrapper.get('.ui-toast-description').text()).toContain('1 new item added')
  expect(clipboard.readText).toHaveBeenCalledOnce()
  setClipboardText('not a Quickbar export')
  await runQuickbarMenuAction(wrapper, 'Import from clipboard')
  await vi.waitFor(() =>
    expect(wrapper.get('.ui-toast-title').text()).toBe('Quickbar action failed'),
  )
  expect(wrapper.get('.ui-toast-description').text()).toContain('invalid')
})

test('creates a folder that opens in rename and moves items without select controls', async () => {
  const { wrapper } = await mountDirectMarketPage()
  await vi.waitFor(() => expect(wrapper.text()).toContain('Standup Generator'))
  await wrapper.get('.market-catalogue-page__detail-heading button').trigger('click')
  await wrapper
    .findAll('[role="tab"]')
    .find((tab) => tab.text().startsWith('Quickbar'))
    ?.trigger('click')
  await vi.waitFor(() => expect(wrapper.find('.market-quickbar-item').exists()).toBe(true))
  expect(wrapper.find('.market-quickbar-panel select').exists()).toBe(false)
  await wrapper.get('button[aria-label="New folder"]').trigger('click')
  const rename = wrapper.get<HTMLInputElement>('input[aria-label="Folder name"]')
  expect(rename.element.value).toBe('New folder')
  rename.element.value = 'Industry'
  await rename.trigger('keydown', { key: 'Enter' })
  await vi.waitFor(() =>
    expect(wrapper.get('.market-quickbar-folder__name').text()).toBe('Industry'),
  )
  expect(wrapper.get('.market-quickbar-panel__summary').text()).toBe('1 item · 1 folder')
  await wrapper.get('button[aria-label="Move Standup Generator to folder"]').trigger('click')
  const targets = wrapper.get('[role="group"][aria-label="Move Standup Generator to"]')
  expect(targets.get('button[aria-pressed="true"]').text()).toBe('No folder')
  await targets
    .findAll('button')
    .find((button) => button.text() === 'Industry')
    ?.trigger('click')
  await vi.waitFor(() => expect(wrapper.get('.market-quickbar-folder__count').text()).toBe('1'))
  expect(wrapper.find('[aria-label="Move Standup Generator to"]').exists()).toBe(false)
})
