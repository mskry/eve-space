import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import AppUpstreamNotice from '../../app/components/AppUpstreamNotice.vue'

const mountedWrappers: { unmount: () => void }[] = []
const checkedAt = '2026-09-01T10:58:46.928Z'

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
})

async function mountNotice(props: {
  status: 'operational' | 'degraded' | 'unavailable' | 'partial' | 'stale' | undefined
  checkedAt?: string
  presentation?:
    | { kind: 'fresh' }
    | { kind: 'restored'; originalSuccessAt: string }
    | { kind: 'restored-refresh-failed'; originalSuccessAt: string; retryAt?: string }
    | { kind: 'server-stale'; validatedAt?: string; retryAt?: string }
  vip?: boolean
}) {
  const wrapper = await mountSuspended(AppUpstreamNotice, {
    props: { checkedAt, vip: false, ...props },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

describe('AppUpstreamNotice', () => {
  it('stays out of the document while the upstream is healthy or unknown', async () => {
    expect((await mountNotice({ status: 'operational' })).find('.upstream-notice').exists()).toBe(
      false,
    )
    expect((await mountNotice({ status: undefined })).find('.upstream-notice').exists()).toBe(false)
  })

  it('keeps normal browser restoration quiet while the upstream is healthy', async () => {
    const wrapper = await mountNotice({
      presentation: { kind: 'restored', originalSuccessAt: checkedAt },
      status: 'operational',
    })

    expect(wrapper.find('.upstream-notice').exists()).toBe(false)
  })

  it('distinguishes a restored snapshot whose refresh failed from server-stale data', async () => {
    const retryAt = '2026-09-01T11:05:00.000Z'
    const restored = await mountNotice({
      presentation: { kind: 'restored-refresh-failed', originalSuccessAt: checkedAt, retryAt },
      status: 'operational',
    })
    expect(restored.get('.upstream-notice').attributes('data-status')).toBe(
      'restored-refresh-failed',
    )
    expect(restored.text()).toContain('HISTORICAL DATA / REFRESH FAILED')
    expect(restored.text()).toContain('RETRY AFTER')

    const serverStale = await mountNotice({
      presentation: { kind: 'server-stale', retryAt, validatedAt: checkedAt },
      status: 'operational',
    })
    expect(serverStale.get('.upstream-notice').attributes('data-status')).toBe('server-stale')
    expect(serverStale.text()).toContain('SERVER CACHE DEGRADED')
    expect(serverStale.text()).toContain('LAST VALIDATED')
  })

  it('explains that an unreachable upstream can fall back to previously loaded data', async () => {
    const wrapper = await mountNotice({ status: 'unavailable' })

    expect(wrapper.get('.upstream-notice').attributes('data-status')).toBe('unavailable')
    expect(wrapper.get('.upstream-notice').text()).toContain('TRANQUILITY UNREACHABLE')
    expect(wrapper.get('.upstream-notice').text()).toContain(
      'Previously loaded data may be shown from cache.',
    )
    expect(wrapper.find('.upstream-notice-contact').exists()).toBe(false)
  })

  it('reports a partial character-data outage without declaring Tranquility unreachable', async () => {
    const wrapper = await mountNotice({ status: 'partial' })

    expect(wrapper.get('.upstream-notice').attributes('data-status')).toBe('partial')
    expect(wrapper.get('.upstream-notice').text()).toContain('CHARACTER DATA DEGRADED')
    expect(wrapper.get('.upstream-notice').text()).toContain(
      'Some character data is temporarily unavailable.',
    )
    expect(wrapper.find('.upstream-notice-contact').exists()).toBe(false)
  })

  it('warns that sign-in may fail while Tranquility is in VIP mode', async () => {
    const wrapper = await mountNotice({ status: 'degraded', vip: true })

    expect(wrapper.get('.upstream-notice').text()).toContain('TRANQUILITY DEGRADED')
    expect(wrapper.get('.upstream-notice').text()).toContain('VIP mode')
  })

  it('omits the contact line when the upstream was never reached', async () => {
    const wrapper = await mountNotice({ checkedAt: undefined, status: 'unavailable' })

    expect(wrapper.find('.upstream-notice-contact').exists()).toBe(false)
  })
})
