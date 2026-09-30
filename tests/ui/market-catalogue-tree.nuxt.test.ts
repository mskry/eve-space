import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, expect, test, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import MarketCatalogueTree from '../../features/market/nuxt/src/runtime/app/components/MarketCatalogueTree.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

test('loads the next bounded page when the end is observed and retains selected items', async () => {
  const intersections: Array<() => void> = []
  vi.stubGlobal(
    'IntersectionObserver',
    class implements IntersectionObserver {
      readonly root = null
      readonly rootMargin = '0px'
      readonly thresholds = [0]
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        intersections.push(() =>
          this.callback(
            [
              {
                boundingClientRect: target.getBoundingClientRect(),
                intersectionRatio: 1,
                intersectionRect: target.getBoundingClientRect(),
                isIntersecting: true,
                rootBounds: document.documentElement.getBoundingClientRect(),
                target,
                time: performance.now(),
              },
            ],
            this,
          ),
        )
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return []
      }
    },
  )
  const requests: string[] = []
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('/market/catalogue/body/')) return originalFetch(input, init)
    requests.push(url)
    const cursor = new URL(url).searchParams.get('cursor')
    const start = cursor === 't_2s' ? 101 : 1
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: start + index,
      groupId: 19,
      name: `Item ${start + index}`,
    }))
    return new Response(
      JSON.stringify({
        kind: 'group-types',
        groupId: 19,
        revision: { buildNumber: 1, ingestVersion: 5, ingestedAt: '2026-09-24' },
        items,
        nextCursor: cursor ? null : 't_2s',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  })

  const selected = ref<number | null>(null)
  const pinned = ref<number[]>([])
  const Host = defineComponent({
    setup() {
      return () =>
        h('div', [
          h('output', { 'data-selected': '' }, String(selected.value)),
          h(MarketCatalogueTree, {
            canPinNew: true,
            collapseToken: 0,
            groups: [
              { id: 19, parentId: null, name: 'Trade Goods', iconId: 15, directTypeCount: 200 },
            ],
            pinnedIds: pinned.value,
            revisionKey: 'revision-a',
            selectedId: selected.value,
            onSelect: (item: { id: number }) => {
              selected.value = item.id
            },
            onTogglePin: (item: { id: number }) => {
              pinned.value = pinned.value.includes(item.id) ? [] : [item.id]
            },
          }),
        ])
    },
  })
  const wrapper = await mountSuspended(Host, { attachTo: document.body, route: false })
  mountedWrappers.push(wrapper)
  const root = wrapper.get('.market-catalogue-group')
  expect(root.attributes('role')).toBe('treeitem')
  expect(root.find('img').attributes('src')).toMatch(/\.png/)
  await root.trigger('click')
  await vi.waitFor(() => expect(wrapper.findAll('.market-catalogue-item')).toHaveLength(100))
  expect(requests).toHaveLength(1)
  expect(wrapper.text()).not.toContain('Items 1–100')
  expect(wrapper.text()).not.toContain('Load more items')
  const pin = wrapper.get('.market-catalogue-item__pin')
  expect(pin.attributes('aria-label')).toBe('Add Item 1 to Quickbar')
  await pin.trigger('click')
  expect(wrapper.get('[data-selected]').text()).toBe('null')
  expect(wrapper.get('.market-catalogue-item__pin').attributes('aria-label')).toBe(
    'Remove Item 1 from Quickbar',
  )
  await wrapper.get('.market-catalogue-item').trigger('click')
  expect(wrapper.get('[data-selected]').text()).toBe('1')
  await vi.waitFor(() => expect(intersections.length).toBeGreaterThan(0))
  intersections.at(-1)?.()
  await vi.waitFor(() => expect(wrapper.findAll('.market-catalogue-item')).toHaveLength(200))
  expect(requests).toHaveLength(2)
  expect(wrapper.get('[data-selected]').text()).toBe('1')
  expect(wrapper.text()).not.toContain('Items 101–200')
})

test('expanding a large category mounts only a bounded visible subgroup page', async () => {
  const groups = [
    { id: 1, parentId: null, name: 'Ships', iconId: null, directTypeCount: 0 },
    ...Array.from({ length: 2_114 }, (_, index) => ({
      id: index + 2,
      parentId: 1,
      name: `Group ${index}`,
      iconId: null,
      directTypeCount: 0,
    })),
  ]
  const collapseToken = ref(0)
  const Host = defineComponent({
    setup() {
      return () =>
        h('div', [
          h(
            'button',
            {
              'data-collapse': '',
              onClick: () => {
                collapseToken.value += 1
              },
            },
            'Collapse all',
          ),
          h(MarketCatalogueTree, {
            canPinNew: true,
            collapseToken: collapseToken.value,
            groups,
            pinnedIds: [],
            revisionKey: 'revision-a',
            selectedId: null,
          }),
        ])
    },
  })
  const wrapper = await mountSuspended(Host, { attachTo: document.body, route: false })
  mountedWrappers.push(wrapper)
  expect(wrapper.findAll('.market-catalogue-group')).toHaveLength(1)
  const root = wrapper.get('.market-catalogue-group')
  expect(root.attributes('aria-expanded')).toBe('false')
  await root.trigger('click')
  await nextTick()
  expect(root.attributes('aria-expanded')).toBe('true')
  expect(wrapper.findAll('.market-catalogue-group')).toHaveLength(101)
  expect(wrapper.text()).toContain('Subgroups 1–100 of 2114')
  const more = wrapper.findAll('button').find((button) => button.text() === 'More subgroups')
  expect(more).toBeDefined()
  await more?.trigger('click')
  await nextTick()
  expect(wrapper.findAll('.market-catalogue-group')).toHaveLength(101)
  expect(wrapper.text()).toContain('Subgroups 101–200 of 2114')
  await wrapper.get('[data-collapse]').trigger('click')
  await nextTick()
  expect(wrapper.findAll('.market-catalogue-group')).toHaveLength(1)
  expect(root.attributes('aria-expanded')).toBe('false')
})

test('uses SDE icon IDs for local images and a fallback for unavailable icons', async () => {
  const wrapper = await mountSuspended(MarketCatalogueTree, {
    attachTo: document.body,
    route: false,
    props: {
      canPinNew: true,
      collapseToken: 0,
      groups: [
        { id: 1, parentId: null, name: 'Mapped icon', iconId: 2053, directTypeCount: 0 },
        { id: 2, parentId: null, name: 'Missing icon', iconId: 26547, directTypeCount: 0 },
      ],
      pinnedIds: [],
      revisionKey: 'revision-a',
      selectedId: null,
    },
  })
  mountedWrappers.push(wrapper)
  const nodes = wrapper.findAll('.market-catalogue-group')
  expect(nodes[0]?.find('img').attributes('src')).toMatch(/2053.*\.png/)
  expect(nodes[1]?.find('img').exists()).toBe(false)
  expect(nodes[1]?.find('.market-catalogue-group__icon--fallback').exists()).toBe(true)
})

test('sorts category siblings by their English display name', async () => {
  const wrapper = await mountSuspended(MarketCatalogueTree, {
    attachTo: document.body,
    route: false,
    props: {
      canPinNew: true,
      collapseToken: 0,
      groups: [
        { id: 1, parentId: null, name: 'Ships', iconId: null, directTypeCount: 0 },
        { id: 2, parentId: 1, name: 'Frigates', iconId: null, directTypeCount: 0 },
        { id: 3, parentId: null, name: 'Trade Goods', iconId: null, directTypeCount: 0 },
        { id: 4, parentId: 1, name: 'Battleships', iconId: null, directTypeCount: 0 },
        { id: 5, parentId: null, name: 'Ammunition & Charges', iconId: null, directTypeCount: 0 },
        { id: 6, parentId: 1, name: 'Battlecruisers', iconId: null, directTypeCount: 0 },
      ],
      pinnedIds: [],
      revisionKey: 'revision-a',
      selectedId: null,
    },
  })
  mountedWrappers.push(wrapper)
  const roots = wrapper.findAll('.market-catalogue-tree > ul > .market-catalogue-group')
  expect(roots.map((node) => node.attributes('aria-label')?.split(',')[0])).toEqual([
    'Ammunition & Charges',
    'Ships',
    'Trade Goods',
  ])
  await roots[1]?.trigger('click')
  const children = roots[1]?.findAll(':scope > ul > .market-catalogue-group') ?? []
  expect(children.map((node) => node.attributes('aria-label')?.split(',')[0])).toEqual([
    'Battlecruisers',
    'Battleships',
    'Frigates',
  ])
})
