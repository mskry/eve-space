import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, expect, test, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import {
  emptyMarketQuickbar,
  marketQuickbarStorageKey,
  rootQuickbarFolderId,
} from '../src/runtime/app/market-quickbar'
import {
  useMarketQuickbar,
  type MarketQuickbarAdapters,
} from '../src/runtime/app/useMarketQuickbar'

const item = { id: 101, groupId: 19, name: 'New Market Item' }
const mountedWrappers: { unmount: () => void }[] = []

const mountQuickbar = async (
  options: {
    stored?: string
    readText?: () => Promise<string>
    failStorage?: boolean
  } = {},
) => {
  const values = new Map<string, string>()
  if (options.stored) values.set(marketQuickbarStorageKey, options.stored)
  const adapters: MarketQuickbarAdapters = {
    storage: {
      getItem: vi.fn((key) => {
        if (options.failStorage) throw new Error('Storage unavailable')
        return values.get(key) ?? null
      }),
      setItem: vi.fn((key, value) => {
        if (options.failStorage) throw new Error('Storage unavailable')
        values.set(key, value)
      }),
    },
    clipboard: {
      readText: options.readText ?? vi.fn(async () => item.name),
      writeText: vi.fn(async () => {}),
    },
    createId: vi.fn(() => 'folder-1'),
  }
  const types = ref([item])
  const selectedId = ref<number | null>(item.id)
  let quickbar!: ReturnType<typeof useMarketQuickbar>
  const Harness = defineComponent({
    name: 'MarketQuickbarHarness',
    setup() {
      quickbar = useMarketQuickbar(types, selectedId, adapters)
      return () => h('div')
    },
  })
  const wrapper = await mountSuspended(Harness)
  mountedWrappers.push(wrapper)
  return { adapters, quickbar, selectedId, values }
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

test('rejects an over-bound import without claiming success or changing saved state', async () => {
  const saved = emptyMarketQuickbar()
  saved[rootQuickbarFolderId].types = Array.from({ length: 100 }, (_, index) => index + 1)
  const { adapters, quickbar } = await mountQuickbar({ stored: JSON.stringify(saved) })
  expect(await quickbar.importQuickbar()).toEqual({ status: 'rejected', reason: 'item-limit' })
  expect(quickbar.state.value[rootQuickbarFolderId].types).toHaveLength(100)
  expect(quickbar.message.value).toContain('100-item limit')
  expect(adapters.storage.setItem).not.toHaveBeenCalled()
})

test('keeps applied changes in memory when storage fails and reports the outcome', async () => {
  const { quickbar } = await mountQuickbar({ failStorage: true })
  expect(quickbar.persistent.value).toBe(false)
  expect(await quickbar.importQuickbar()).toEqual({ status: 'applied', persisted: false })
  expect(quickbar.pinnedTypeIds.value).toEqual([item.id])
  expect(quickbar.message.value).toContain('browser storage is unavailable')
  expect(await quickbar.importQuickbar()).toEqual({ status: 'unchanged' })
  expect(quickbar.message.value).toContain('already contains')
})

test('owns folder operations, derived nodes, transfer and clipboard rejection', async () => {
  const { adapters, quickbar } = await mountQuickbar()
  expect(quickbar.toggleSelectedPin()).toMatchObject({ status: 'applied', persisted: true })
  expect(quickbar.selectedIsPinned.value).toBe(true)
  expect(quickbar.createRootFolder('Ships')).toMatchObject({ status: 'applied' })
  expect(quickbar.moveItem(item.id, 'folder-1')).toMatchObject({ status: 'applied' })
  expect(quickbar.nodes.value).toMatchObject([
    { kind: 'folder', name: 'Ships', children: [{ id: item.id }] },
  ])
  expect(quickbar.folderOptions.value).toContainEqual({ id: 'folder-1', label: 'Ships' })
  expect(await quickbar.exportQuickbar()).toEqual({ status: 'applied' })
  expect(adapters.clipboard.writeText).toHaveBeenCalledWith('+ Ships\n- New Market Item')
  expect(quickbar.moveFolder('folder-1', 'folder-1')).toEqual({ status: 'unchanged' })
  expect(quickbar.clear()).toMatchObject({ status: 'applied' })
  expect(quickbar.empty.value).toBe(true)
})

test('returns a clipboard rejection through the same import interface', async () => {
  const { quickbar } = await mountQuickbar({
    readText: async () => {
      throw new Error('Clipboard denied')
    },
  })
  expect(await quickbar.importQuickbar()).toEqual({
    status: 'rejected',
    reason: 'clipboard-unavailable',
  })
  expect(quickbar.message.value).toBe('Clipboard access is unavailable.')
})
