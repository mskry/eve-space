import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import AppUpstreamNotice from '../../app/components/AppUpstreamNotice.vue'

const mountedWrappers: { unmount: () => void }[] = []
const checkedAt = '2026-09-01T10:58:46.928Z'

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

async function mountNotice(props: {
  status: 'operational' | 'degraded' | 'unavailable' | 'stale' | undefined
  checkedAt?: string
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

  it('explains that cached data is being served when the upstream stops responding', async () => {
    const wrapper = await mountNotice({ status: 'stale' })

    const notice = wrapper.get('.upstream-notice')
    expect(notice.element.tagName).toBe('OUTPUT')
    expect(notice.attributes('data-status')).toBe('stale')
    expect(notice.text()).toContain('TRANQUILITY NOT RESPONDING')
    expect(notice.text()).toContain('served from cache')
    expect(notice.text()).toContain('LAST CONTACT')
  })

  it('separates an unreachable upstream from a merely stale one', async () => {
    const wrapper = await mountNotice({ status: 'unavailable' })

    expect(wrapper.get('.upstream-notice').attributes('data-status')).toBe('unavailable')
    expect(wrapper.get('.upstream-notice').text()).toContain('TRANQUILITY UNREACHABLE')
    expect(wrapper.get('.upstream-notice').text()).toContain('until EVE Online returns')
    expect(wrapper.find('.upstream-notice-contact').exists()).toBe(false)
  })

  it('warns that sign-in may fail while Tranquility is in VIP mode', async () => {
    const wrapper = await mountNotice({ status: 'degraded', vip: true })

    expect(wrapper.get('.upstream-notice').text()).toContain('TRANQUILITY DEGRADED')
    expect(wrapper.get('.upstream-notice').text()).toContain('VIP mode')
  })

  it('omits the contact line when the upstream was never reached', async () => {
    const wrapper = await mountNotice({ status: 'stale', checkedAt: undefined })

    expect(wrapper.find('.upstream-notice-contact').exists()).toBe(false)
  })
})
