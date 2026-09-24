import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { EsiQueryPersistencePresentation } from '@eve-space/platform-module-nuxt/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import EsiResourceBoundary from '../../app/components/esi/ResourceBoundary.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  document.body.replaceChildren()
})

describe('EsiResourceBoundary', () => {
  it('renders loading and retryable error defaults', async () => {
    const wrapper = await mountSuspended(EsiResourceBoundary, {
      props: {
        state: { message: 'Connecting...', status: 'loading', title: 'Loading resource' },
      },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('[role="status"]').text()).toContain('Connecting...')

    await wrapper.setProps({
      state: {
        code: 'ERR / TEST',
        message: 'The request failed.',
        retryLabel: 'TRY AGAIN',
        status: 'error',
        title: 'Resource unavailable',
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
          action: { href: '/reauthorize', label: 'AUTHORIZE' },
          code: 'ESI 403 / TEST',
          message: 'Grant the required scope.',
          status: 'authorization-required',
          title: 'Authorization required',
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
          retryLabel: 'RETRY',
          status: 'authorization-required',
          title: 'Authorization unavailable',
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
          action: { href: '/reauthorize', label: 'AUTHORIZE' },
          status: 'authorization-required',
          title: 'Refresh authorization required',
        },
      },
      slots: { default: '<p data-retained>Retained resource</p>' },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('[data-retained]').text()).toBe('Retained resource')
    expect(wrapper.get('[role="alert"]').text()).toContain('Refresh authorization required')
  })

  it.each(['fresh', 'restored', 'restored-refresh-failed', 'server-stale'] as const)(
    'keeps %s data visible without a per-resource persistence notice',
    async (kind) => {
      const wrapper = await mountSuspended(EsiResourceBoundary, {
        props: {
          hasData: true,
          presentation: persistencePresentation(kind),
          state: { status: 'ready' },
        },
        slots: { default: '<p data-retained>Retained resource</p>' },
      })
      mountedWrappers.push(wrapper)

      expect(wrapper.get('[data-retained]').text()).toBe('Retained resource')
      expect(wrapper.find('.platform-query-persistence').exists()).toBe(false)
    },
  )

  it('allows feature-owned loading and error presentation', async () => {
    const wrapper = await mountSuspended(EsiResourceBoundary, {
      props: {
        state: { message: null, status: 'loading', title: '' },
      },
      slots: {
        error: '<p data-error>Feature error</p>',
        loading: '<p data-loading>Feature skeleton</p>',
      },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('[data-loading]').text()).toBe('Feature skeleton')

    await wrapper.setProps({
      state: { message: 'Failed.', status: 'error', title: 'Unavailable' },
    })
    expect(wrapper.get('[data-error]').text()).toBe('Feature error')
  })
})

function persistencePresentation(
  kind: EsiQueryPersistencePresentation['kind'],
): EsiQueryPersistencePresentation {
  if (kind === 'restored-refresh-failed') {
    return {
      kind,
      originalSuccessAt: '2026-09-15T01:00:00.000Z',
      refreshFailureCode: 'ESI_UNAVAILABLE',
    }
  }
  if (kind === 'server-stale') {
    return {
      kind,
      refreshFailureClass: 'esi-cooldown',
      validatedAt: '2026-09-15T00:45:00.000Z',
    }
  }
  if (kind === 'restored') {
    return { kind, originalSuccessAt: '2026-09-15T01:00:00.000Z' }
  }
  return { kind }
}
