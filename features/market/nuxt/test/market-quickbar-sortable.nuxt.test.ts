import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, expect, test, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import MarketQuickbarPanel from '../src/runtime/app/components/MarketQuickbarPanel.vue'
import { marketQuickbarStorageKey, rootQuickbarFolderId } from '../src/runtime/app/market-quickbar'
import { useMarketQuickbar } from '../src/runtime/app/useMarketQuickbar'

const types = [
  { id: 587, groupId: 1, name: 'Rifter' },
  { id: 34, groupId: 3, name: 'Tritanium' },
]
const saved = JSON.stringify({
  __root__: { name: '__root__', types: [587, 34], childFolders: ['ships'] },
  ships: { name: 'Ships', types: [], childFolders: [] },
})
const wrappers: { unmount: () => void }[] = []

const mountPanel = async (values = new Map([[marketQuickbarStorageKey, saved]])) => {
  const Harness = defineComponent({
    setup() {
      const quickbar = useMarketQuickbar(ref(types), ref(null), {
        storage: {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => {
            values.set(key, value)
          },
        },
        clipboard: { readText: async () => '', writeText: async () => {} },
        createId: () => 'new-folder',
      })
      return () =>
        h(MarketQuickbarPanel, {
          groups: [],
          indexReady: true,
          indexUnavailable: false,
          quickbar,
          selectedId: null,
        })
    },
  })
  const wrapper = await mountSuspended(Harness, { attachTo: document.body })
  wrappers.push(wrapper)
  await vi.waitFor(() => expect(wrapper.find('[role="tree"]').exists()).toBe(true))
  return { wrapper, values }
}

afterEach(() => {
  window.dispatchEvent(new MouseEvent('dragend', { bubbles: true }))
  vi.restoreAllMocks()
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
})

test('keyboard sorting and nesting preserve focus and saved order after remount', async () => {
  const { wrapper, values } = await mountPanel()
  const item = wrapper.get<HTMLElement>('[data-sortable-key="item:587"]')
  item.element.focus()
  await item.trigger('keydown', { key: 'ArrowUp', altKey: true })
  expect(
    wrapper.findAll('[role="treeitem"]').map((node) => node.attributes('data-sortable-key')),
  ).toEqual(['item:587', 'folder:ships', 'item:34'])
  expect(document.activeElement).toBe(wrapper.get('[data-sortable-key="item:587"]').element)
  await wrapper
    .get('[data-sortable-key="item:34"]')
    .trigger('keydown', { key: 'ArrowRight', altKey: true })
  expect(wrapper.get('[data-sortable-key="item:34"]').attributes('aria-level')).toBe('2')
  expect(wrapper.get('[data-sortable-key="folder:ships"]').attributes('aria-expanded')).toBe('true')
  expect(wrapper.get('output[aria-live="polite"]').text()).toContain('Tritanium moved in Ships')
  wrapper.unmount()
  wrappers.splice(wrappers.indexOf(wrapper), 1)
  const restored = await mountPanel(values)
  expect(
    restored.wrapper
      .findAll('[role="treeitem"]')
      .map((node) => node.attributes('data-sortable-key')),
  ).toEqual(['item:587', 'folder:ships'])
  await restored.wrapper
    .get('[data-sortable-key="folder:ships"]')
    .trigger('keydown', { key: 'ArrowRight' })
  await restored.wrapper
    .get('[data-sortable-key="item:34"]')
    .trigger('keydown', { key: 'ArrowLeft', altKey: true })
  expect(restored.wrapper.get('[data-sortable-key="item:34"]').attributes('aria-level')).toBe('1')
})

test('native drag uses hitbox insertion feedback and commits a single persisted reorder', async () => {
  const { wrapper, values } = await mountPanel()
  const source = wrapper.get('[data-sortable-key="item:34"]')
  const target = wrapper.get('[data-sortable-key="folder:ships"]')
  await vi.waitFor(() => expect(source.attributes('draggable')).toBe('true'))
  vi.spyOn(target.element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 300,
    bottom: 40,
    width: 300,
    height: 40,
    toJSON: () => ({}),
  })
  const dataTransfer = new DataTransfer()
  vi.spyOn(dataTransfer, 'setDragImage').mockImplementation(() => {})
  const dispatchDrag = (element: Element, type: string) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 2,
    })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    element.dispatchEvent(event)
  }
  dispatchDrag(source.element, 'dragstart')
  await vi.waitFor(() => expect(source.attributes('data-dragging')).toBeDefined())
  dispatchDrag(target.element, 'dragenter')
  dispatchDrag(target.element, 'dragover')
  await vi.waitFor(() =>
    expect(wrapper.find('[data-instruction="reorder-above"]').exists()).toBe(true),
  )
  dispatchDrag(target.element, 'drop')
  await vi.waitFor(() =>
    expect(
      wrapper.findAll('[role="treeitem"]').map((node) => node.attributes('data-sortable-key')),
    ).toEqual(['item:34', 'folder:ships', 'item:587']),
  )
  expect(JSON.parse(values.get(marketQuickbarStorageKey)!)[rootQuickbarFolderId].order).toEqual([
    'item:34',
    'folder:ships',
    'item:587',
  ])
  expect(wrapper.find('[data-instruction]').exists()).toBe(false)
  const nestedSource = wrapper.get('[data-sortable-key="item:587"]')
  const dragIntoFolder = (type: string, element: Element) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 20,
    })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    element.dispatchEvent(event)
  }
  dragIntoFolder('dragstart', nestedSource.element)
  await vi.waitFor(() => expect(nestedSource.attributes('data-dragging')).toBeDefined())
  dragIntoFolder('dragenter', target.element)
  await vi.waitFor(() =>
    expect(wrapper.find('[data-instruction="make-child"]').exists()).toBe(true),
  )
  dragIntoFolder('drop', target.element)
  await vi.waitFor(() =>
    expect(wrapper.get('[data-sortable-key="item:587"]').attributes('aria-level')).toBe('2'),
  )
  const beforeCancel = values.get(marketQuickbarStorageKey)
  dragIntoFolder('dragstart', target.element)
  await vi.waitFor(() => expect(target.attributes('aria-expanded')).toBe('false'))
  dragIntoFolder('dragend', target.element)
  await vi.waitFor(() => expect(target.attributes('aria-expanded')).toBe('true'))
  expect(values.get(marketQuickbarStorageKey)).toBe(beforeCancel)
})
