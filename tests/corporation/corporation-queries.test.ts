import { useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { corporationAllianceHistoryQuery, corporationQuery } from '../../app/queries/corporations'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const staleMetadata = {
  cachedUntil: '2026-09-01T10:59:00.000Z',
  validatedAt: '2026-09-01T10:58:00.000Z',
  stale: true,
  retryAt: '2026-09-01T11:07:00.000Z',
  refreshFailureClass: 'esi-unavailable',
}

describe('corporation queries', () => {
  it('preserves corporation stale metadata on the final query DTO', async () => {
    queryServer.use(
      http.get('http://localhost/api/corporations/8', () =>
        HttpResponse.json({
          corporation: { corporationId: 8, name: 'Retained corporation' },
          ...staleMetadata,
        }),
      ),
    )
    const apiClient = createApiClient('http://localhost')
    const Root = defineComponent({
      setup() {
        const result = useQuery(corporationQuery({ apiClient, corporationId: 8 }))
        return () =>
          h(
            'span',
            result.data.value
              ? `${result.data.value.corporation.name}:${result.data.value.stale}:${result.data.value.validatedAt}`
              : 'loading',
          )
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('Retained corporation:true:2026-09-01T10:58:00.000Z')
    wrapper.unmount()
  })

  it('preserves alliance-history stale metadata on the final query DTO', async () => {
    queryServer.use(
      http.get('http://localhost/api/corporations/8/alliance-history', () =>
        HttpResponse.json({
          corporationId: 8,
          history: [{ allianceId: 99, startDate: '2026-01-01T00:00:00.000Z' }],
          ...staleMetadata,
        }),
      ),
    )
    const apiClient = createApiClient('http://localhost')
    const Root = defineComponent({
      setup() {
        const result = useQuery(corporationAllianceHistoryQuery({ apiClient, corporationId: 8 }))
        return () =>
          h(
            'span',
            result.data.value
              ? `${result.data.value.history[0]?.allianceId}:${result.data.value.stale}:${result.data.value.validatedAt}`
              : 'loading',
          )
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('99:true:2026-09-01T10:58:00.000Z')
    wrapper.unmount()
  })
})
