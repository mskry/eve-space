import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQueryCache } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { defineComponent, h } from 'vue'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminPage from '../../app/pages/admin/index.vue'
import { ADMIN_QUERY_KEYS, PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { clearQueryCache } from '../support/clear-query-cache'
import { queryServer } from '../support/query-server'

const { transition } = vi.hoisted(() => ({ transition: vi.fn(async () => true) }))
vi.mock('../../app/query-persistence/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../app/query-persistence/runtime')>()),
  transitionOrganizationQueries: transition,
}))

const originalOrganization = {
  id: 98_000_001,
  name: 'Original Corporation',
  ticker: 'OLD',
  type: 'corporation' as const,
}
const mountedWrappers: { unmount: () => void }[] = []
let resultOrganization = { ...originalOrganization }
let updateRejected = false

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())
beforeEach(() => {
  clearQueryCache()
  transition.mockClear()
  resultOrganization = { ...originalOrganization }
  updateRejected = false
  queryServer.use(
    http.get('http://localhost:8788/api/admin/session', () =>
      HttpResponse.json({
        authenticated: true,
        account: { email: 'owner@example.test', organization: originalOrganization },
      }),
    ),
    http.put('http://localhost:8788/api/admin/organization', () =>
      updateRejected
        ? HttpResponse.json({ message: 'Update rejected.' }, { status: 422 })
        : HttpResponse.json({ organization: resultOrganization }),
    ),
  )
})
afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  clearQueryCache()
  queryServer.resetHandlers()
  await flushPromises()
})

const mountAdmin = async () => {
  const Host = defineComponent({
    setup() {
      const cache = useQueryCache()
      cache.setQueryData(ADMIN_QUERY_KEYS.session, {
        authenticated: true,
        account: { email: 'owner@example.test', organization: originalOrganization },
      })
      cache.setQueryData(PRIVATE_QUERY_KEYS.session(), {
        authenticated: true,
        account: { userId: 'member-1', mainCharacter: { characterId: 7, name: 'Pilot' } },
      })
      cache.setQueryData(PRIVATE_QUERY_KEYS.characterOverview(7), { name: 'Pilot overview' })
      return () => h(AdminPage)
    },
  })
  const wrapper = await mountSuspended(Host, { route: false })
  mountedWrappers.push(wrapper)
  await flushPromises()
  return { wrapper, queryCache: useQueryCache() }
}

describe('deployment organization update', () => {
  it.each([
    [
      'identity replacement',
      {
        id: 98_000_002,
        name: 'Replacement Corporation',
        ticker: 'NEW',
        type: 'corporation' as const,
      },
    ],
    [
      'name and ticker update',
      { ...originalOrganization, name: 'Renamed Corporation', ticker: 'RE' },
    ],
  ])(
    'clears organization scope on successful %s and preserves sessions and characters',
    async (_case, organization) => {
      resultOrganization = organization
      const { wrapper, queryCache } = await mountAdmin()
      await wrapper.get('input[type="number"]').setValue(String(organization.id))
      await wrapper.get('.admin-form').trigger('submit')
      await flushPromises()

      expect(transition).toHaveBeenCalledOnce()
      expect(transition).toHaveBeenCalledWith(queryCache)
      expect(queryCache.getQueryData(ADMIN_QUERY_KEYS.session)).toMatchObject({
        authenticated: true,
        account: { organization },
      })
      expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toMatchObject({
        authenticated: true,
        account: { userId: 'member-1' },
      })
      expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterOverview(7))).toStrictEqual({
        name: 'Pilot overview',
      })
      expect(wrapper.text()).toContain('Deployment organization updated.')
    },
  )

  it('leaves current admission and query state untouched after a rejected update', async () => {
    updateRejected = true
    const { wrapper, queryCache } = await mountAdmin()
    await wrapper.get('.admin-form').trigger('submit')
    await flushPromises()

    expect(transition).not.toHaveBeenCalled()
    expect(queryCache.getQueryData(ADMIN_QUERY_KEYS.session)).toMatchObject({
      account: { organization: originalOrganization },
    })
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterOverview(7))).toStrictEqual({
      name: 'Pilot overview',
    })
    expect(wrapper.text()).toContain('Update rejected.')
  })
})
