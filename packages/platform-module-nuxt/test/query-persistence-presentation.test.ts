import type { EntryKey } from '@pinia/colada'
import { renderToString } from '@vue/server-renderer'
import {
  computed,
  createSSRApp,
  defineComponent,
  h,
  ref,
  toValue,
  type MaybeRefOrGetter,
} from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  providePlatformQueryPersistence,
  usePlatformQueryPersistence,
  type EsiQueryPersistencePresentation,
} from '../src/runtime/query-persistence-presentation.js'

describe('platform query persistence presentation', () => {
  it('reads the current dynamic key through the host injection seam', async () => {
    const key = ref<EntryKey>(['private', 'first'])
    const presentations = new Map<string, ReturnType<typeof ref<EsiQueryPersistencePresentation>>>([
      [JSON.stringify(['private', 'first']), ref({ kind: 'fresh' })],
      [
        JSON.stringify(['private', 'second']),
        ref({ kind: 'restored', originalSuccessAt: '2026-09-15T01:00:00.000Z' }),
      ],
    ])
    const reader = vi.fn((queryKey: MaybeRefOrGetter<EntryKey>) =>
      computed<EsiQueryPersistencePresentation>(
        () => presentations.get(JSON.stringify(toValue(queryKey)))?.value ?? { kind: 'fresh' },
      ),
    )
    const Consumer = defineComponent({
      setup() {
        const presentation = usePlatformQueryPersistence(key)
        key.value = ['private', 'second']
        return () => h('span', { 'data-kind': presentation.value.kind }, presentation.value.kind)
      },
    })
    const Host = defineComponent({
      setup() {
        providePlatformQueryPersistence(reader)
        return () => h(Consumer)
      },
    })

    const html = await renderToString(createSSRApp(Host))

    expect(html).toContain('data-kind="restored"')
    expect(reader).toHaveBeenLastCalledWith(key)
  })
})
