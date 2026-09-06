import { mountSuspended } from '@nuxt/test-utils/runtime'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AssetsToolbar from '../../app/components/assets/Toolbar.vue'
import AssetsWorkspace from '../../app/components/assets/Workspace.vue'
import type { AssetCollection, AssetRecord, AssetResourceState } from '../../app/types/assets'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []
const characterId = 7_001

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

afterEach(async () => {
  queryServer.resetHandlers()
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  await settle()
  document.body.replaceChildren()
})

describe('Assets workspace resource states', () => {
  it('distinguishes loading, scope, rejected authorization, cooldown, and unavailable states', async () => {
    const loading = await mountWorkspace(null, state({ phase: 'loading', initialLoading: true }))
    expect(loading.get('[role="status"] h2').text()).toBe('Resolving personal inventory')
    loading.unmount()

    for (const { message, phase, title } of [
      {
        message: 'Grant esi-assets.read_assets.v1 for this character.',
        phase: 'access-required' as const,
        title: 'Asset authorization required',
      },
      {
        message: 'The existing character authorization was rejected.',
        phase: 'authorization-rejected' as const,
        title: 'Asset authorization expired',
      },
    ]) {
      const access = await mountWorkspace(
        null,
        state({
          phase,
          message,
          statusLabel: 'ESI 403 / ASSETS',
          action: { href: `/reauthorize/${characterId}`, label: 'AUTHORIZE ASSETS' },
        }),
      )
      expect(access.get('[role="alert"] h2').text()).toBe(title)
      expect(access.text()).toContain(message)
      const authorize = access.get('a')
      expect(authorize.text()).toBe('AUTHORIZE ASSETS')
      expect(authorize.attributes('href')).toBe(`/reauthorize/${characterId}`)
      access.unmount()
    }

    const cooldown = await mountWorkspace(
      null,
      state({
        phase: 'cooldown',
        message: 'Retry after 30 seconds.',
        retryAt: '2026-09-03T12:00:30.000Z',
      }),
    )
    expect(cooldown.text()).toContain('Asset service cooling down')
    expect(cooldown.get('time').attributes('datetime')).toBe('2026-09-03T12:00:30.000Z')
    expect(cooldown.find('button').exists()).toBe(false)
    cooldown.unmount()

    const unavailable = await mountWorkspace(
      null,
      state({ phase: 'unavailable', message: 'Complete collection unavailable.', canRetry: true }),
    )
    expect(unavailable.get('[role="alert"] h2').text()).toBe('Personal inventory unavailable')
    await unavailable.get('button').trigger('click')
    expect(unavailable.emitted('retry')).toHaveLength(1)
  })

  it('keeps stale retained data primary and reports refresh and partial enrichment context', async () => {
    const wrapper = await mountWorkspace(
      collection([asset(1)], {
        stale: true,
        refreshFailureClass: 'esi-unavailable',
        enrichment: { types: 'unavailable', names: 'partial', locations: 'partial' },
      }),
      state({
        phase: 'ready',
        stale: true,
        refreshFailed: true,
        message: 'Live refresh failed.',
        canRetry: true,
      }),
    )

    expect(wrapper.text()).toContain('Jita IV - Moon 4')
    expect(wrapper.get('[role="alert"]').text()).toContain('retained inventory shown')
    expect(wrapper.get('[role="alert"] time').attributes('datetime')).toBe(
      '2026-09-03T12:00:00.000Z',
    )
    expect(wrapper.get('[aria-label="Enrichment status"]').text()).toContain(
      'type details: unavailable',
    )
    expect(wrapper.get('[aria-label="Enrichment status"]').text()).toContain(
      'custom names: partial',
    )
    await wrapper.get('.assets-notice--warning button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('offers reauthorization when an expired authorization still has retained data', async () => {
    const wrapper = await mountWorkspace(
      collection([asset(1)], { stale: true, refreshFailureClass: 'esi-unavailable' }),
      state({
        phase: 'ready',
        stale: true,
        refreshFailed: true,
        canRetry: false,
        message: 'Authorization expired.',
        action: { href: `/reauthorize/${characterId}`, label: 'AUTHORIZE ASSETS' },
      }),
    )

    expect(wrapper.text()).toContain('Jita IV - Moon 4')
    const authorize = wrapper.get('.assets-notice--warning button')
    expect(authorize.text()).toBe('AUTHORIZE ASSETS')
    await authorize.trigger('click')
    expect(wrapper.emitted('authorize')?.[0]).toEqual([
      { href: `/reauthorize/${characterId}`, label: 'AUTHORIZE ASSETS' },
    ])
  })

  it('clears an autocomplete draft when its facet is cleared', async () => {
    const wrapper = await mountWorkspace(
      collection([
        asset(1, { typeId: 100, typeName: 'Secure Container' }),
        asset(2, { typeId: 200, typeName: 'Cargo Expander' }),
      ]),
      state(),
    )

    await wrapper.get('.assets-strip-filters').trigger('click')
    const typeFilter = wrapper.get('#assets-type-filter')
    await typeFilter.setValue('Secure Container')
    expect((typeFilter.element as HTMLInputElement).value).toBe('Secure Container')

    await wrapper.get('.assets-chips-clear').trigger('click')
    await settle()
    expect((wrapper.get('#assets-type-filter').element as HTMLInputElement).value).toBe('')
  })

  it('separates a complete empty inventory from filtered no-results', async () => {
    const empty = await mountWorkspace(collection([]), state())
    expect(empty.get('[role="status"] h2').text()).toBe('Personal inventory empty')
    expect(empty.find('#assets-search').exists()).toBe(false)
    empty.unmount()

    const filtered = await mountWorkspace(collection([asset(1)]), state())
    await filtered.get('#assets-search').setValue('definitely absent')
    expect(filtered.get('.assets-filtered-empty h2').text()).toBe('No inventory matches')
    expect(filtered.get('.assets-chips-count').text()).toContain('0 matches / 1 assets')
  })

  it('uses the local generic image for SKIN inventory types', async () => {
    const wrapper = await mountWorkspace(
      collection([
        asset(57_006, {
          typeId: 57_006,
          typeName: 'Raptor Aurora Universalis SKIN',
          categoryId: 91,
          categoryName: 'SKINs',
        }),
      ]),
      state(),
    )

    expect(wrapper.get('[data-asset-item-id="57006"] img').attributes('src')).toBe(
      '/images/eve-skin.png',
    )
  })
})

describe('Assets workspace inventory interactions', () => {
  it('keeps unavailable active facets clearable and supports empty-string flags', async () => {
    const wrapper = await mountSuspended(AssetsToolbar, {
      props: {
        categoryOptions: [{ value: 65, label: 'Structure' }],
        filters: {
          search: '',
          typeIds: [999],
          groupIds: [],
          categoryIds: [],
          locationKeys: [],
          locationTypes: [],
          flags: [''],
          singleton: 'all',
          blueprint: 'all',
        },
        flagOptions: [
          { value: '', label: 'Unknown flag' },
          { value: 'Hangar', label: 'Hangar' },
        ],
        groupOptions: [{ value: 12, label: 'Cargo Container' }],
        locationOptions: [{ value: 'station:1', label: 'Station 1' }],
        typeOptions: [{ value: 100, label: 'Secure Container' }],
        matchCount: 1,
        sourceCount: 1,
        sort: 'item',
        sortOptions: [{ value: 'item', label: 'Name' }],
      },
      route: false,
    })
    mountedWrappers.push(wrapper)
    await settle()

    await wrapper.get('.assets-strip-filters').trigger('click')
    const typeFilter = wrapper.get('#assets-type-filter')
    const flagFilter = wrapper.get('#assets-flag-filter')
    expect((typeFilter.element as HTMLInputElement).value).not.toBe('')
    expect((flagFilter.element as HTMLInputElement).value).not.toBe('')
    expect(wrapper.find('#assets-group-filter').exists()).toBe(false)
    expect(wrapper.find('#assets-category-filter').exists()).toBe(false)
    expect(wrapper.find('#assets-location-filter').exists()).toBe(false)

    await typeFilter.setValue('')
    expect(wrapper.emitted('change')?.at(-1)?.[0]).toMatchObject({ typeIds: [] })
    await flagFilter.setValue('')
    expect(wrapper.emitted('change')?.at(-1)?.[0]).toMatchObject({ flags: [] })
  })

  it('renders semantic location lists, complete facts, nested context, and deterministic fallbacks', async () => {
    const records = [
      asset(1, {
        customName: 'Expedition crate',
        typeName: 'Secure Container',
      }),
      asset(2, {
        customName: 'Nested probe',
        locationId: 1,
        locationType: 'item',
        locationName: null,
        parentItemId: 1,
        locationFlag: 'FutureFlag',
        quantity: 12,
        categoryId: 9,
        categoryName: 'Blueprint',
        isBlueprintCopy: true,
        unitVolume: null,
        totalVolume: null,
      }),
      asset(3, {
        typeId: 999,
        typeName: 'Unknown type 999',
        groupId: null,
        groupName: null,
        categoryId: null,
        categoryName: null,
        locationId: 9_999,
        locationType: 'other',
        locationName: null,
        locationFlag: '',
      }),
      asset(4, {
        customName: 'Lost cargo',
        locationId: 404,
        locationType: 'item',
        locationName: null,
        parentItemId: 404,
      }),
      asset(5, {
        customName: 'Cycle alpha',
        locationId: 6,
        locationType: 'item',
        locationName: null,
        parentItemId: 6,
      }),
      asset(6, {
        customName: 'Cycle beta',
        locationId: 5,
        locationType: 'item',
        locationName: null,
        parentItemId: 5,
      }),
    ]
    const wrapper = await mountWorkspace(collection(records), state())

    expect(wrapper.get('section[aria-labelledby="assets-results-title"]')).toBeTruthy()
    expect(wrapper.get('table').attributes('class')).toContain('assets-manifest')
    expect(
      wrapper.findAll('thead th button').map((heading) => heading.text().replace(/ [<>^v]+$/, '')),
    ).toEqual(['Name', 'Quantity', 'Group', 'Category', 'Placement', 'Volume', 'Unit vol.'])
    await wrapper.get('.assets-strip-filters').trigger('click')
    expect(wrapper.find('#assets-type-filter').exists()).toBe(true)
    expect(wrapper.find('#assets-group-filter').exists()).toBe(false)
    expect(wrapper.find('#assets-category-filter').exists()).toBe(true)
    expect(wrapper.findAll('.assets-location')).toHaveLength(4)
    expect(wrapper.text()).toContain('Restricted structure')
    expect(wrapper.text()).toContain('Broken container cycle')
    expect(wrapper.text()).toContain('Location 9999')
    const search = wrapper.get('#assets-search')
    await search.setValue('Expedition crate')
    expect(wrapper.get('[data-asset-item-id="1"] img').attributes('src')).toContain(
      '/types/100/icon?size=32&tenant=tranquility',
    )

    await search.setValue('Nested probe')
    const nested = wrapper.get('[data-asset-item-id="2"]')
    expect(wrapper.find('[data-asset-item-id="1"]').exists()).toBe(true)
    expect(nested.attributes('data-depth')).toBe('1')
    expect(nested.text()).toContain('12')
    expect(nested.text()).toContain('Future Flag')
    expect(nested.text()).toContain('BPC')
    expect(nested.text()).toContain('Unknown')
    expect(nested.get('img').attributes('src')).toContain(
      '/types/100/bpc?size=32&tenant=tranquility',
    )
    expect(wrapper.get('.assets-hierarchy-toggle').attributes('aria-expanded')).toBe('true')

    await search.setValue('Unknown type 999')
    const unknown = wrapper.get('[data-asset-item-id="3"]')
    expect(unknown.text()).toContain('Unknown group')
    expect(unknown.text()).toContain('Unknown category')
    expect(unknown.text()).toContain('Unknown')
    expect(unknown.get('img').attributes('src')).toContain(
      '/types/999/icon?size=32&tenant=tranquility',
    )
    expect(
      unknown.get('button[aria-label="View item information for Unknown type 999"]'),
    ).toBeTruthy()
  })

  it('uses native keyboard-addressable location and container disclosures', async () => {
    const wrapper = await mountWorkspace(
      collection([
        asset(1, { customName: 'Container one' }),
        asset(2, {
          customName: 'Nested item',
          locationId: 1,
          locationType: 'item',
          locationName: null,
          parentItemId: 1,
        }),
      ]),
      state(),
      true,
    )

    const locationToggle = wrapper.get('.assets-location-toggle')
    expect(locationToggle.element.tagName).toBe('BUTTON')
    expect(locationToggle.attributes('aria-expanded')).toBe('true')
    const containerToggle = wrapper.get('.assets-hierarchy-toggle')
    expect(containerToggle.element.tagName).toBe('BUTTON')
    expect(containerToggle.attributes('aria-expanded')).toBe('false')
    expect(containerToggle.findAll('rect')).toHaveLength(2)
    containerToggle.element.focus()
    await containerToggle.trigger('click')
    expect(containerToggle.attributes('aria-expanded')).toBe('true')
    expect(containerToggle.findAll('rect')).toHaveLength(1)
    expect(document.activeElement).toBe(containerToggle.element)
    expect(wrapper.get('[data-asset-item-id="2"]').attributes('data-depth')).toBe('1')

    locationToggle.element.focus()
    await locationToggle.trigger('click')
    expect(locationToggle.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(locationToggle.element)
  })

  it('keeps container children under their container whatever the sort order', async () => {
    const wrapper = await mountWorkspace(
      collection([
        asset(1, { customName: 'None', typeName: 'Asset Safety Wrap' }),
        asset(2, {
          customName: 'mskvites on a branch',
          typeName: 'Amarr Shuttle',
          locationId: 1,
          locationType: 'item',
          locationName: null,
          parentItemId: 1,
        }),
      ]),
      state(),
    )

    await wrapper.get('.assets-hierarchy-toggle').trigger('click')
    const order = wrapper
      .findAll('.assets-hierarchy-row')
      .map((row) => row.attributes('data-asset-item-id'))
    expect(order).toEqual(['1', '2'])
    expect(wrapper.get('[data-asset-item-id="2"]').attributes('data-depth')).toBe('1')
  })

  it('enforces 100-row pages without losing criteria state', async () => {
    const wrapper = await mountWorkspace(
      collection(Array.from({ length: 235 }, (_, index) => asset(index + 1))),
      state(),
    )

    expect(wrapper.findAll('.assets-hierarchy-row')).toHaveLength(100)
    const search = wrapper.get('#assets-search')
    await search.setValue('Inventory')
    expect(wrapper.findAll('.assets-hierarchy-row')).toHaveLength(100)
    await wrapper.get('button[aria-label="Next page"]').trigger('click')
    expect(wrapper.findAll('.assets-hierarchy-row')).toHaveLength(100)
    expect(wrapper.get('[aria-current="page"]').text()).toContain('2')
    expect((search.element as HTMLInputElement).value).toBe('Inventory')
  })

  it('loads only activated public item detail and restores focus without resetting workspace state', async () => {
    const requests: string[] = []
    queryServer.use(
      http.get('*/api/universe/types/100', ({ request }) => {
        requests.push(new URL(request.url).pathname)
        return HttpResponse.json({
          typeId: 100,
          name: 'Secure Container',
          description: 'Public static detail only.',
          group: { id: 12, name: 'Cargo Container' },
          category: { id: 65, name: 'Structure' },
          detail: null,
        })
      }),
    )
    const wrapper = await mountWorkspace(
      collection([
        asset(1, { customName: 'Named vault', typeName: 'Secure Container' }),
        asset(2, {
          locationId: 1,
          locationType: 'item',
          locationName: null,
          parentItemId: 1,
        }),
      ]),
      state(),
      true,
    )
    const search = wrapper.get('#assets-search')
    await search.setValue('Named vault')
    const trigger = wrapper.get('button[aria-label="View item information for Named vault"]')
    expect(trigger.element.tagName).toBe('BUTTON')
    const informationIcon = trigger.get('.app-information-icon')
    expect(informationIcon.element.tagName).toBe('svg')
    expect(informationIcon.attributes()).toMatchObject({ width: '16', height: '16' })
    await trigger.trigger('mouseenter')
    await trigger.trigger('pointerenter')
    await settle()
    expect(requests).toEqual([])

    trigger.element.focus()
    await trigger.trigger('click')
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Secure Container'),
    )
    expect(requests).toEqual(['/api/universe/types/100'])
    expect(wrapper.emitted('itemInformation')).toEqual([[1]])
    const close = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[aria-label="Close item information"]',
    )!
    close.click()
    await settle()
    expect(document.activeElement).toBe(trigger.element)
    expect((search.element as HTMLInputElement).value).toBe('Named vault')
    expect(wrapper.get('.assets-location-toggle').attributes('aria-expanded')).toBe('true')
  })
})

async function mountWorkspace(
  data: AssetCollection | null,
  resourceState: AssetResourceState,
  attachToBody = false,
) {
  const wrapper = await mountSuspended(AssetsWorkspace, {
    attachTo: attachToBody ? document.body : undefined,
    props: { collection: data, state: resourceState },
    route: false,
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function state(overrides: Partial<AssetResourceState> = {}): AssetResourceState {
  return {
    phase: 'ready',
    initialLoading: false,
    refreshing: false,
    refreshFailed: false,
    stale: false,
    message: null,
    statusLabel: null,
    canRetry: false,
    retryAt: null,
    action: null,
    ...overrides,
  }
}

function collection(
  assets: AssetRecord[],
  overrides: Partial<AssetCollection> = {},
): AssetCollection {
  return {
    assets,
    enrichment: { types: 'complete', names: 'complete', locations: 'complete' },
    stale: false,
    validatedAt: '2026-09-03T12:00:00.000Z',
    refreshFailureClass: null,
    retryAt: null,
    ...overrides,
  }
}

function asset(itemId: number, overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    itemId,
    typeId: 100,
    typeName: `Inventory item ${itemId}`,
    groupId: 12,
    groupName: 'Cargo Container',
    categoryId: 65,
    categoryName: 'Structure',
    unitVolume: 1.5,
    totalVolume: 1.5,
    quantity: 1,
    isSingleton: true,
    isBlueprintCopy: null,
    customName: null,
    locationId: 60_003_760,
    locationType: 'station',
    locationName: 'Jita IV - Moon 4',
    locationFlag: 'Hangar',
    parentItemId: null,
    ...overrides,
  }
}
