import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { computed, defineComponent, h, onMounted, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOrganizationAuthority } from '../../app/composables/useOrganizationAuthority'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')

describe('organization authority', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does not request organization context before deployment setup', async () => {
    let contextRequests = 0
    queryServer.use(
      http.get('http://localhost/api/admin/setup', () =>
        HttpResponse.json({ required: true, available: true }),
      ),
      http.get('http://localhost/api/organization/context', () => {
        contextRequests += 1
        return HttpResponse.json({}, { status: 500 })
      }),
    )
    const initializeAuth = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useAuthSession', () => ({
      authSession: ref({ authenticated: true }),
      initializeAuth,
    }))
    const Root = defineComponent({
      setup() {
        const authority = useOrganizationAuthority(apiClient)
        onMounted(authority.initialize)
        return () => h('span', authority.deploymentConfigured.value ? 'configured' : 'unconfigured')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('unconfigured')
    expect(initializeAuth).toHaveBeenCalledOnce()
    expect(contextRequests).toBe(0)
    wrapper.unmount()
  })
})
