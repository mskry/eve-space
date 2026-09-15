import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import EsiResourceBoundary from '../../app/components/esi/ResourceBoundary.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('EsiResourceBoundary', () => {
  it('renders loading and retryable error defaults', async () => {
    const wrapper = await mountSuspended(EsiResourceBoundary, {
      props: {
        state: { status: 'loading', title: 'Loading resource', message: 'Connecting...' },
      },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('[role="status"]').text()).toContain('Connecting...')

    await wrapper.setProps({
      state: {
        status: 'error',
        code: 'ERR / TEST',
        title: 'Resource unavailable',
        message: 'The request failed.',
        retryLabel: 'TRY AGAIN',
      },
    })
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('The request failed.')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('renders authorization as a native link', async () => {
    const wrapper = await mountSuspended(EsiResourceBoundary, {
      props: {
        state: {
          status: 'authorization-required',
          code: 'ESI 403 / TEST',
          title: 'Authorization required',
          message: 'Grant the required scope.',
          action: { href: '/reauthorize', label: 'AUTHORIZE' },
        },
      },
    })
    mountedWrappers.push(wrapper)

    const link = wrapper.get('a')
    expect(link.attributes('href')).toBe('/reauthorize')
    expect(link.text()).toBe('AUTHORIZE')
  })

  it('falls back to retry when authorization has no URL', async () => {
    const wrapper = await mountSuspended(EsiResourceBoundary, {
      props: {
        state: {
          status: 'authorization-required',
          title: 'Authorization unavailable',
          retryLabel: 'RETRY',
        },
      },
    })
    mountedWrappers.push(wrapper)

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('preserves retained content while presenting authorization', async () => {
    const wrapper = await mountSuspended(EsiResourceBoundary, {
      props: {
        hasData: true,
        state: {
          status: 'authorization-required',
          title: 'Refresh authorization required',
          action: { href: '/reauthorize', label: 'AUTHORIZE' },
        },
      },
      slots: { default: '<p data-retained>Retained resource</p>' },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('[data-retained]').text()).toBe('Retained resource')
    expect(wrapper.get('[role="alert"]').text()).toContain('Refresh authorization required')
  })

  it.each(['fresh', 'restored'] as const)(
    'keeps %s data visible without a persistence notice',
    async (kind) => {
      const wrapper = await mountSuspended(EsiResourceBoundary, {
        props: {
          hasData: true,
          presentation: { kind, originalSuccessAt: '2026-09-15T01:00:00.000Z' },
          state: { status: 'ready' },
        },
        slots: { default: '<p data-retained>Retained resource</p>' },
      })
      mountedWrappers.push(wrapper)

      expect(wrapper.get('[data-retained]').text()).toBe('Retained resource')
      expect(wrapper.find('.platform-query-persistence').exists()).toBe(false)
    },
  )

  it('keeps retained data visible and identifies failed restored refreshes accessibly', async () => {
    const originalSuccessAt = '2026-09-15T01:00:00.000Z'
    const retryAt = '2026-09-15T01:05:00.000Z'
    const wrapper = await mountSuspended(EsiResourceBoundary, {
      props: {
        hasData: true,
        presentation: {
          kind: 'restored-refresh-failed',
          originalSuccessAt,
          retryAt,
          refreshFailureCode: 'ESI_UNAVAILABLE',
          refreshFailureStatus: 503,
        },
        state: {
          status: 'error',
          title: 'Refresh unavailable',
          message: 'The latest refresh failed.',
        },
      },
      slots: { default: '<p data-retained>Retained resource</p>' },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('[data-retained]').text()).toBe('Retained resource')
    const presentation = wrapper.get('[data-persistence-state="restored-refresh-failed"]')
    expect(presentation.text()).toContain('Historical data, refresh failed.')
    expect(presentation.text()).toContain('ESI_UNAVAILABLE')
    expect(presentation.get(`time[datetime="${originalSuccessAt}"]`).text()).toBe(originalSuccessAt)
    expect(presentation.get(`time[datetime="${retryAt}"]`).text()).toBe(retryAt)
    expect(wrapper.get('[role="alert"]').text()).toContain('The latest refresh failed.')
  })

  it('distinguishes authoritative server-stale metadata from browser restoration', async () => {
    const validatedAt = '2026-09-15T00:45:00.000Z'
    const wrapper = await mountSuspended(EsiResourceBoundary, {
      props: {
        hasData: true,
        presentation: {
          kind: 'server-stale',
          validatedAt,
          refreshFailureClass: 'esi-cooldown',
        },
        state: { status: 'ready' },
      },
      slots: { default: '<p>Server representation</p>' },
    })
    mountedWrappers.push(wrapper)

    const presentation = wrapper.get('[data-persistence-state="server-stale"]')
    expect(presentation.text()).toContain('Server-stale data.')
    expect(presentation.text()).toContain('esi-cooldown')
    expect(presentation.get('time').attributes('datetime')).toBe(validatedAt)
  })

  it('allows feature-owned loading and error presentation', async () => {
    const wrapper = await mountSuspended(EsiResourceBoundary, {
      props: {
        state: { status: 'loading', title: '', message: null },
      },
      slots: {
        error: '<p data-error>Feature error</p>',
        loading: '<p data-loading>Feature skeleton</p>',
      },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('[data-loading]').text()).toBe('Feature skeleton')

    await wrapper.setProps({
      state: { status: 'error', title: 'Unavailable', message: 'Failed.' },
    })
    expect(wrapper.get('[data-error]').text()).toBe('Feature error')
  })
})
