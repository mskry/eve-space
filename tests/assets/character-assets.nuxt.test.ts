import { mountSuspended } from '@nuxt/test-utils/runtime'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AssetsToolbar from '../../app/components/assets/Toolbar.vue'
import AssetsInventory from '../../app/components/assets/Inventory.vue'
import type { AssetCollection, AssetRecord, AssetResourceState } from '../../app/types/assets'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []
const characterId = 7001

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

afterEach(async () => {
  queryServer.resetHandlers()
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  await settle()
  document.body.replaceChildren()
})

describe('Assets workspace resource states', () => {
  it('distinguishes loading, scope, rejected authorization, cooldown, and unavailable states', async () => {
    const loading = await mountWorkspace(null, state({ initialLoading: true, phase: 'loading' }))
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
          action: { href: `/reauthorize/${characterId}`, label: 'AUTHORIZE ASSETS' },
          message,
          phase,
          statusLabel: 'ESI 403 / ASSETS',
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
        message: 'Retry after 30 seconds.',
        phase: 'cooldown',
        retryAt: '2026-09-03T12:00:30.000Z',
      }),
    )
    expect(cooldown.text()).toContain('Asset service cooling down')
    expect(cooldown.get('time').attributes('datetime')).toBe('2026-09-03T12:00:30.000Z')
    expect(cooldown.find('button').exists()).toBe(false)
    cooldown.unmount()

    const unavailable = await mountWorkspace(
      null,
      state({ canRetry: true, message: 'Complete collection unavailable.', phase: 'unavailable' }),
    )
    expect(unavailable.get('[role="alert"] h2').text()).toBe('Personal inventory unavailable')
    await unavailable.get('button').trigger('click')
    expect(unavailable.emitted('retry')).toHaveLength(1)
  })

  it('renders EVE security bands for resolved systems and hides unavailable values', async () => {
    const wrapper = await mountWorkspace(
      collection([
        asset(1),
        asset(2, {
          locationId: 30_000_142,
          locationName: 'Jita',
          locationType: 'solar_system',
          solarSystemId: 30_000_142,
          solarSystemSecurityStatus: -0.06,
        }),
        asset(3, {
          locationId: 60_000_002,
          locationName: 'Unresolved security station',
          solarSystemId: null,
          solarSystemSecurityStatus: null,
        }),
      ]),
      state(),
    )

    const statuses = wrapper.findAll('.system-security-status')
    expect(statuses).toHaveLength(2)
    const highSecurity = statuses.find((status) => status.text() === 'System security: 0.9')
    const nullSecurity = statuses.find((status) => status.text() === 'System security: -0.1')
    expect(highSecurity?.classes()).toContain('system-security-status--9')
    expect(nullSecurity?.classes()).toContain('system-security-status--0')
  })

  it('renders zero, singular, and plural route jumps while omitting unavailable routes', async () => {
    const wrapper = await mountWorkspace(
      collection([
        asset(1, { locationId: 60_000_001, locationName: 'Same system' }),
        asset(2, {
          locationId: 60_000_002,
          locationName: 'One jump',
          solarSystemId: 30_000_143,
        }),
        asset(3, {
          locationId: 60_000_003,
          locationName: 'Two jumps',
          solarSystemId: 30_000_144,
        }),
        asset(4, {
          locationId: 60_000_004,
          locationName: 'Route unavailable',
          solarSystemId: 30_000_145,
        }),
      ]),
      state(),
      false,
      new Map([
        [30_000_142, 0],
        [30_000_143, 1],
        [30_000_144, 2],
      ]),
    )

    const headers = wrapper.findAll('.assets-location-header')
    const sameSystemHeader = headers.find((header) => header.text().includes('Same system'))
    expect(sameSystemHeader?.text()).toContain('Route: 0 Jumps')
    expect(
      sameSystemHeader?.get('.assets-location-name').element.nextElementSibling?.classList,
    ).toContain('assets-location-route')
    expect(headers.find((header) => header.text().includes('One jump'))?.text()).toContain(
      'Route: 1 Jump',
    )
    expect(headers.find((header) => header.text().includes('Two jumps'))?.text()).toContain(
      'Route: 2 Jumps',
    )
    expect(
      headers.find((header) => header.text().includes('Route unavailable'))?.text(),
    ).not.toContain('Route:')
  })

  it('sorts locations by route jumps in both directions and leaves unavailable routes last', async () => {
    const wrapper = await mountWorkspace(
      collection([
        asset(1, {
          locationId: 60_000_001,
          locationName: 'Alpha unavailable',
          solarSystemId: 30_000_145,
        }),
        asset(2, {
          locationId: 60_000_002,
          locationName: 'Bravo two jumps',
          solarSystemId: 30_000_144,
        }),
        asset(3, {
          locationId: 60_000_003,
          locationName: 'Charlie same system',
          solarSystemId: 30_000_142,
        }),
        asset(4, {
          locationId: 60_000_004,
          locationName: 'Delta one jump',
          solarSystemId: 30_000_143,
        }),
      ]),
      state(),
      true,
      new Map([
        [30_000_142, 0],
        [30_000_143, 1],
        [30_000_144, 2],
      ]),
      new Map([
        [30_000_145, 0],
        [30_000_144, 1],
        [30_000_142, 2],
        [30_000_143, 3],
      ]),
    )

    const sort = wrapper.get('button[aria-label="Sort by"]')
    expect(sort.text()).toContain('Jumps ascending')
    expect(
      wrapper.findAll('.assets-location-name').map((location) => location.text()),
    ).toStrictEqual([
      'Charlie same system',
      'Delta one jump',
      'Bravo two jumps',
      'Alpha unavailable',
    ])

    await sort.trigger('pointerdown', {
      button: 0,
      ctrlKey: false,
      pageX: 0,
      pageY: 0,
      pointerId: 1,
      pointerType: 'mouse',
    })
    await settle()
    const jumpsOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.includes('Jumps descending'),
    )
    expect(jumpsOption).toBeDefined()
    jumpsOption?.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }),
    )
    await settle()

    expect(sort.text()).toContain('Jumps descending')
    expect(
      wrapper.findAll('.assets-location-name').map((location) => location.text()),
    ).toStrictEqual([
      'Bravo two jumps',
      'Delta one jump',
      'Charlie same system',
      'Alpha unavailable',
    ])
  })

  it('keeps stale retained data primary and reports refresh and partial enrichment context', async () => {
    const wrapper = await mountWorkspace(
      collection([asset(1)], {
        enrichment: { locations: 'partial', names: 'partial', types: 'unavailable' },
        refreshFailureClass: 'esi-unavailable',
        stale: true,
      }),
      state({
        canRetry: true,
        message: 'Live refresh failed.',
        phase: 'ready',
        refreshFailed: true,
        stale: true,
      }),
    )

    expect(wrapper.text()).toContain('Jita IV - Moon 4')
    expect(wrapper.get('.system-security-status').text()).toBe('System security: 0.9')
    expect(wrapper.get('.system-security-status').classes()).toContain('system-security-status--9')
    expect(wrapper.get('.assets-location-count').text()).toBe('1 items - 1.5 m³')
    expect(wrapper.find('.assets-location-kind').exists()).toBe(false)
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
      collection([asset(1)], { refreshFailureClass: 'esi-unavailable', stale: true }),
      state({
        action: { href: `/reauthorize/${characterId}`, label: 'AUTHORIZE ASSETS' },
        canRetry: false,
        message: 'Authorization expired.',
        phase: 'ready',
        refreshFailed: true,
        stale: true,
      }),
    )

    expect(wrapper.text()).toContain('Jita IV - Moon 4')
    const authorize = wrapper.get('.assets-notice--warning button')
    expect(authorize.text()).toBe('AUTHORIZE ASSETS')
    await authorize.trigger('click')
    expect(wrapper.emitted('authorize')?.[0]).toStrictEqual([
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
          categoryId: 91,
          categoryName: 'SKINs',
          typeId: 57_006,
          typeName: 'Raptor Aurora Universalis SKIN',
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
          blueprint: 'all',
          categoryIds: [],
          flags: [''],
          groupIds: [],
          locationKeys: [],
          locationTypes: [],
          search: '',
          singleton: 'all',
          typeIds: [999],
        },
        flagOptions: [
          { value: '', label: 'Unknown flag' },
          { value: 'Hangar', label: 'Hangar' },
        ],
        groupOptions: [{ value: 12, label: 'Cargo Container' }],
        locationOptions: [{ value: 'station:1', label: 'Station 1' }],
        matchCount: 1,
        sort: 'item',
        sortOptions: [{ value: 'item', label: 'Name' }],
        sourceCount: 1,
        typeOptions: [{ value: 100, label: 'Secure Container' }],
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
        categoryId: 9,
        categoryName: 'Blueprint',
        customName: 'Nested probe',
        isBlueprintCopy: true,
        locationFlag: 'FutureFlag',
        locationId: 1,
        locationName: null,
        locationType: 'item',
        parentItemId: 1,
        quantity: 12,
        totalVolume: null,
        unitVolume: null,
      }),
      asset(3, {
        categoryId: null,
        categoryName: null,
        groupId: null,
        groupName: null,
        locationFlag: '',
        locationId: 9999,
        locationName: null,
        locationType: 'other',
        typeId: 999,
        typeName: 'Unknown type 999',
      }),
      asset(4, {
        customName: 'Lost cargo',
        locationId: 404,
        locationName: null,
        locationType: 'item',
        parentItemId: 404,
      }),
      asset(5, {
        customName: 'Cycle alpha',
        locationId: 6,
        locationName: null,
        locationType: 'item',
        parentItemId: 6,
      }),
      asset(6, {
        customName: 'Cycle beta',
        locationId: 5,
        locationName: null,
        locationType: 'item',
        parentItemId: 5,
      }),
    ]
    const wrapper = await mountWorkspace(collection(records), state())

    expect(wrapper.get('section[aria-labelledby="assets-results-title"]')).toBeTruthy()
    expect(wrapper.get('table').attributes('class')).toContain('assets-manifest')
    expect(
      wrapper.findAll('thead th button').map((heading) => heading.text().replace(/ [<>^v]+$/, '')),
    ).toStrictEqual(['Name', 'Quantity', 'Group', 'Category', 'Placement', 'Volume', 'Unit vol.'])
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
          locationName: null,
          locationType: 'item',
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
          locationId: 1,
          locationName: null,
          locationType: 'item',
          parentItemId: 1,
          typeName: 'Amarr Shuttle',
        }),
      ]),
      state(),
    )

    await wrapper.get('.assets-hierarchy-toggle').trigger('click')
    const order = wrapper
      .findAll('.assets-hierarchy-row')
      .map((row) => row.attributes('data-asset-item-id'))
    expect(order).toStrictEqual(['1', '2'])
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

  it('paginates locations in groups of 50', async () => {
    const wrapper = await mountWorkspace(
      collection(
        Array.from({ length: 51 }, (_, index) =>
          asset(index + 1, {
            customName: index === 0 ? 'qzxvbnm-target' : null,
            locationId: 60_000_001 + index,
            locationName: `Location ${String(index + 1).padStart(3, '0')}`,
          }),
        ),
      ),
      state(),
    )

    expect(wrapper.findAll('.assets-location')).toHaveLength(50)
    expect(wrapper.text()).toContain('Location 001')
    expect(wrapper.text()).not.toContain('Location 051')

    await wrapper.get('button[aria-label="Next location page"]').trigger('click')

    expect(wrapper.findAll('.assets-location')).toHaveLength(1)
    expect(wrapper.text()).toContain('Location 051')
    expect(
      wrapper.get('[aria-label="Asset location pages"] [aria-current="page"]').text(),
    ).toContain('2')

    await wrapper.get('#assets-search').setValue('qzxvbnm-target')

    expect(wrapper.findAll('.assets-location')).toHaveLength(1)
    expect(wrapper.text()).toContain('Location 001')
    expect(wrapper.find('[aria-label="Asset location pages"]').exists()).toBe(false)
  })

  it('expands the first location after asynchronous route ranks reorder pages', async () => {
    const assets = Array.from({ length: 51 }, (_, index) =>
      asset(index + 1, {
        locationId: 60_000_001 + index,
        locationName: `Location ${String(index + 1).padStart(3, '0')}`,
        solarSystemId: 30_000_001 + index,
      }),
    )
    const wrapper = await mountWorkspace(collection(assets), state())
    const nearestFirstSystemIds = [
      30_000_051,
      ...Array.from({ length: 49 }, (_, index) => 30_000_002 + index),
      30_000_001,
    ]

    await wrapper.setProps({
      routeJumpsBySystemId: new Map(
        nearestFirstSystemIds.map((systemId, index) => [systemId, index]),
      ),
      routeRankBySystemId: new Map(
        nearestFirstSystemIds.map((systemId, index) => [systemId, index]),
      ),
    })
    await settle()

    expect(wrapper.findAll('.assets-location-name')[0]?.text()).toBe('Location 051')
    expect(
      wrapper
        .findAll('.assets-location-toggle')
        .map((toggle) => toggle.attributes('aria-expanded')),
    ).toStrictEqual(['true', ...Array.from({ length: 49 }, () => 'false')])
    expect(wrapper.text()).not.toContain('Location 001')
  })

  it('loads only activated public item detail and restores focus without resetting workspace state', async () => {
    const requests: string[] = []
    queryServer.use(
      http.get('*/api/universe/types/100', ({ request }) => {
        requests.push(new URL(request.url).pathname)
        return HttpResponse.json({
          category: { id: 65, name: 'Structure' },
          description: 'Public static detail only.',
          detail: null,
          group: { id: 12, name: 'Cargo Container' },
          name: 'Secure Container',
          typeId: 100,
        })
      }),
    )
    const wrapper = await mountWorkspace(
      collection([
        asset(1, { customName: 'Named vault', typeName: 'Secure Container' }),
        asset(2, {
          locationId: 1,
          locationName: null,
          locationType: 'item',
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
    expect(informationIcon.attributes()).toMatchObject({ height: '16', width: '16' })
    await trigger.trigger('mouseenter')
    await trigger.trigger('pointerenter')
    await settle()
    expect(requests).toStrictEqual([])

    trigger.element.focus()
    await trigger.trigger('click')
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Secure Container'),
    )
    expect(requests).toStrictEqual(['/api/universe/types/100'])
    expect(wrapper.emitted('itemInformation')).toStrictEqual([[1]])
    const close = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[aria-label="Close item information"]',
    )!
    close.click()
    await settle()
    expect(document.activeElement).toBe(trigger.element)
    expect((search.element as HTMLInputElement).value).toBe('Named vault')
    expect(wrapper.get('.assets-location-toggle').attributes('aria-expanded')).toBe('true')
  })

  it('uses enriched asset identity when an unpublished type has no public detail', async () => {
    queryServer.use(
      http.get('*/api/universe/types/60', () =>
        HttpResponse.json({ code: 'TYPE_NOT_FOUND', message: 'Type not found.' }, { status: 404 }),
      ),
    )
    const wrapper = await mountWorkspace(
      collection([
        asset(1, {
          categoryId: 65,
          categoryName: 'Structure',
          groupId: 12,
          groupName: 'Cargo Container',
          typeId: 60,
          typeName: 'Asset Safety Wrap',
        }),
      ]),
      state(),
      true,
    )

    await wrapper
      .get('button[aria-label="View item information for Asset Safety Wrap"]')
      .trigger('click')
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Asset Safety Wrap'),
    )
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Structure / Cargo Container',
    )
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'No description is available for this item.',
    )
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
      'Item information unavailable',
    )
  })
})

async function mountWorkspace(
  data: AssetCollection | null,
  resourceState: AssetResourceState,
  attachToBody = false,
  routeJumpsBySystemId?: ReadonlyMap<number, number>,
  routeRankBySystemId?: ReadonlyMap<number, number>,
) {
  const wrapper = await mountSuspended(AssetsInventory, {
    attachTo: attachToBody ? document.body : undefined,
    props: { collection: data, routeJumpsBySystemId, routeRankBySystemId, state: resourceState },
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
    action: null,
    canRetry: false,
    initialLoading: false,
    message: null,
    phase: 'ready',
    refreshFailed: false,
    refreshing: false,
    retryAt: null,
    stale: false,
    statusLabel: null,
    ...overrides,
  }
}

function collection(
  assets: AssetRecord[],
  overrides: Partial<AssetCollection> = {},
): AssetCollection {
  return {
    assets,
    enrichment: { locations: 'complete', names: 'complete', types: 'complete' },
    refreshFailureClass: null,
    retryAt: null,
    stale: false,
    validatedAt: '2026-09-03T12:00:00.000Z',
    ...overrides,
  }
}

function asset(itemId: number, overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    categoryId: 65,
    categoryName: 'Structure',
    customName: null,
    groupId: 12,
    groupName: 'Cargo Container',
    isBlueprintCopy: null,
    isSingleton: true,
    itemId,
    locationFlag: 'Hangar',
    locationId: 60_003_760,
    locationName: 'Jita IV - Moon 4',
    locationType: 'station',
    parentItemId: null,
    quantity: 1,
    solarSystemId: 30_000_142,
    solarSystemSecurityStatus: 0.945,
    totalVolume: 1.5,
    typeId: 100,
    typeName: `Inventory item ${itemId}`,
    unitVolume: 1.5,
    ...overrides,
  }
}
