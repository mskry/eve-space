import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import UiStatePanel from '../../layers/ui/app/components/ui/UiStatePanel.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

describe('UiStatePanel', () => {
  it('renders pending content with status semantics', async () => {
    const wrapper = await mountSuspended(UiStatePanel, {
      props: { compact: true, role: 'status' },
      slots: { default: '<p>Loading records...</p>' },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.classes()).toContain('ui-state-panel--compact')
    expect(wrapper.text()).toContain('Loading records...')
  })

  it('renders failure details and actions with alert semantics', async () => {
    const wrapper = await mountSuspended(UiStatePanel, {
      props: {
        code: 'ERR / RECORD',
        role: 'alert',
        title: 'Record unavailable',
        tone: 'error',
      },
      slots: {
        default: '<p>The record could not be loaded.</p>',
        action: '<button type="button">RETRY</button>',
      },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.attributes('role')).toBe('alert')
    expect(wrapper.classes()).toContain('ui-state-panel--error')
    expect(wrapper.get('h2').text()).toBe('Record unavailable')
    expect(wrapper.get('button').text()).toBe('RETRY')
  })
})
