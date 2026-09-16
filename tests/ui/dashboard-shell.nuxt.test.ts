import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQuery, useQueryCache } from '@pinia/colada'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import DashboardShell from '../../app/components/DashboardShell.vue'
import { PUBLIC_QUERY_KEYS } from '../../app/queries/query-keys'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []
const EmptyStub = defineComponent({ setup: () => () => h('div') })
const StatusPopoverStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()])
  },
})
const telemetry = {
  status: 'operational',
  checkedAt: '2026-08-20T12:30:00.000Z',
  cachedUntil: '2026-08-20T12:30:15.000Z',
  services: {
    api: { status: 'operational', uptimeSeconds: 100 },
    database: { status: 'operational', latencyMs: 8 },
    sde: {
      status: 'operational',
      latencyMs: 4,
      checkedAt: '2026-08-20T12:30:00.000Z',
      buildNumber: 3_503_375,
      ingestVersion: 4,
      ingestedAt: '2026-08-20T12:00:00.000Z',
    },
    esi: {
      status: 'operational',
      latencyMs: 210,
      checkedAt: '2026-08-20T12:30:00.000Z',
      players: 20_000,
      serverVersion: 'test',
      startedAt: null,
      vip: false,
      errorBudgetRemaining: 100,
      errorBudgetResetSeconds: 10,
    },
  },
}

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

afterEach(async () => {
  queryServer.resetHandlers()
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  await settle()
  document.body.replaceChildren()
})

describe('DashboardShell system status', () => {
  it('renders compact loading, success, and refresh-error states', async () => {
    let releaseInitial!: () => void
    let releaseRefresh!: () => void
    const initialGate = new Promise<void>((resolve) => {
      releaseInitial = resolve
    })
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let statusMode: 'initial-error' | 'refresh-error' | 'success' = 'initial-error'

    queryServer.use(
      http.get('*/auth/config', () =>
        HttpResponse.json({ configured: true, loginUrl: '/login', attachUrl: '/attach' }),
      ),
      http.get('*/auth/session', () => HttpResponse.json({ authenticated: false })),
      http.get('*/api/admin/session', () => HttpResponse.json({ authenticated: false })),
      http.get('*/api/status', async () => {
        if (statusMode === 'initial-error') {
          await initialGate
          return HttpResponse.json({ code: 'STATUS_UNAVAILABLE' }, { status: 503 })
        }
        if (statusMode === 'success') return HttpResponse.json(telemetry)

        await refreshGate
        return HttpResponse.json({ code: 'STATUS_UNAVAILABLE' }, { status: 503 })
      }),
    )

    const Host = defineComponent({
      setup() {
        const queryCache = useQueryCache()
        return () =>
          h('div', [
            h(DashboardShell, null, { default: () => h('p', 'Page content') }),
            h(
              'button',
              {
                'data-invalidate-status': '',
                type: 'button',
                onClick: () =>
                  void queryCache
                    .invalidateQueries({
                      exact: true,
                      key: PUBLIC_QUERY_KEYS.systemStatus(),
                    })
                    .catch(() => undefined),
              },
              'Refresh status',
            ),
          ])
      },
    })
    const wrapper = await mountSuspended(Host, {
      attachTo: document.body,
      global: {
        stubs: {
          AppSidebar: EmptyStub,
          AppUpstreamNotice: EmptyStub,
          UiDrawer: EmptyStub,
          UiStatusPopover: StatusPopoverStub,
          UiThemeSwitcher: EmptyStub,
        },
      },
      route: false,
    })
    mountedWrappers.push(wrapper)

    await vi.waitFor(() =>
      expect(wrapper.get('.service-status').text()).toContain('CHECKING STATUS'),
    )

    releaseInitial()
    await vi.waitFor(
      () => {
        const text = wrapper.get('.service-status').text()
        expect(text).toContain('STATUS UNAVAILABLE')
        expect(text).toContain('NO STATUS AVAILABLE')
      },
      { timeout: 4_000 },
    )

    statusMode = 'success'
    await wrapper.get('.service-status-notice button').trigger('click')
    await vi.waitFor(() => {
      const text = wrapper.get('.service-status').text()
      expect(text).toMatch(/API\d+ ms/)
      expect(text).toContain('Database8 ms')
      expect(text).toContain('Tranquility210 ms')
      expect(text).toContain('Pilots20,000')
      expect(text).toContain('SDE3503375')
      expect(text).not.toContain('ERROR BUDGET')
    })

    statusMode = 'refresh-error'
    await wrapper.get('[data-invalidate-status]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('.service-status').text()).toContain('REFRESHING'))
    releaseRefresh()
    await vi.waitFor(
      () => expect(wrapper.get('.service-status').text()).toContain('LATEST CHECK FAILED'),
      { timeout: 4_000 },
    )
  })

  it('aggregates active server-stale ESI presentation without replacing operational status', async () => {
    const validatedAt = new Date().toISOString()
    queryServer.use(
      http.get('*/auth/config', () =>
        HttpResponse.json({ configured: true, loginUrl: '/login', attachUrl: '/attach' }),
      ),
      http.get('*/auth/session', () => HttpResponse.json({ authenticated: false })),
      http.get('*/api/admin/session', () => HttpResponse.json({ authenticated: false })),
      http.get('*/api/status', () => HttpResponse.json(telemetry)),
    )

    const Host = defineComponent({
      setup() {
        useQuery({
          key: ['public', 'dashboard-presentation-test'],
          query: async () => ({
            stale: true as const,
            validatedAt,
            refreshFailureClass: 'esi-unavailable',
          }),
          meta: { esiPersistence: { kind: 'public-esi' } },
        })
        return () => h(DashboardShell, null, { default: () => h('p', 'Page content') })
      },
    })
    const wrapper = await mountSuspended(Host, {
      attachTo: document.body,
      global: {
        stubs: {
          AppSidebar: EmptyStub,
          UiDrawer: EmptyStub,
          UiStatusPopover: StatusPopoverStub,
          UiThemeSwitcher: EmptyStub,
        },
      },
      route: false,
    })
    mountedWrappers.push(wrapper)

    await vi.waitFor(() => {
      const notice = wrapper.get('[data-persistence-state="server-stale"]')
      expect(notice.text()).toContain('SERVER CACHE DEGRADED')
      expect(notice.get('time').attributes('datetime')).toBe(validatedAt)
    })
    expect(wrapper.get('.service-status-badge').text()).toContain('OPERATIONAL')
  })
})
