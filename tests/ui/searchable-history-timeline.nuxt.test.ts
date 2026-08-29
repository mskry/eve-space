import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SearchableHistoryTimeline from '../../app/components/SearchableHistoryTimeline.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

describe('SearchableHistoryTimeline', () => {
  it('searches normalized names and IDs without hiding non-matches', async () => {
    const wrapper = await mountSuspended(SearchableHistoryTimeline, {
      props: {
        entries: [
          {
            recordId: 2,
            startDate: '2024-01-01T00:00:00Z',
            endDate: undefined,
            isDeleted: false,
            entityId: 98_000_002,
            entityName: 'Second Alliance',
          },
          {
            recordId: 1,
            startDate: '2020-01-01T00:00:00Z',
            endDate: '2024-01-01T00:00:00Z',
            isDeleted: false,
            entityId: 98_000_001,
            entityName: 'First Alliance',
          },
        ],
        entityKind: 'alliance',
        entityLabel: 'alliance',
      },
    })
    mountedWrappers.push(wrapper)

    await wrapper.get('input[type="search"]').setValue('second')
    await nextTick()

    expect(wrapper.get('.app-search-status').text()).toBe('1 / 2 MATCHED')
    expect(wrapper.get('[data-record-id="2"]').classes()).toContain('is-match')
    expect(wrapper.get('[data-record-id="1"]').classes()).toContain('is-muted')
    expect(wrapper.findAll('.employment-timeline li')).toHaveLength(2)

    await wrapper.get('input[type="search"]').setValue('98000001')
    await nextTick()

    expect(wrapper.get('[data-record-id="1"]').classes()).toContain('is-match')

    await wrapper.get('input[type="search"]').setValue('missing')
    await nextTick()

    expect(wrapper.get('.app-search-status').text()).toBe('NO MATCHES')
  })
})
