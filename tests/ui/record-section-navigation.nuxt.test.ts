import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { RouterLinkStub } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RecordSectionNavigation from '../../app/components/RecordSectionNavigation.vue'

const { currentRoute } = vi.hoisted(() => ({ currentRoute: { path: '/' } }))

mockNuxtImport('useRoute', () => () => currentRoute)

const mountedWrappers: { unmount: () => void }[] = []
const entries = [
  { id: 'overview', label: 'OVERVIEW', to: '/characters/42', exact: true },
  {
    id: 'history',
    label: 'HISTORY',
    to: '/characters/42/history',
  },
]

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

describe('RecordSectionNavigation', () => {
  it('marks only the matching section current', async () => {
    currentRoute.path = '/characters/42/history'
    const wrapper = await mountSuspended(RecordSectionNavigation, {
      global: { stubs: { NuxtLink: RouterLinkStub } },
      props: { entries, label: 'Corporation record sections' },
      route: false,
    })
    mountedWrappers.push(wrapper)

    const links = wrapper.findAll('a')
    expect(links).toHaveLength(2)
    expect(links[0]?.attributes('aria-current')).toBeUndefined()
    expect(links[0]?.classes()).not.toContain('is-current')
    expect(links[1]?.attributes('aria-current')).toBe('page')
    expect(links[1]?.classes()).toContain('is-current')
  })

  it('keeps entries keyboard focusable and emits focus intent', async () => {
    currentRoute.path = '/characters/42'
    const wrapper = await mountSuspended(RecordSectionNavigation, {
      attachTo: document.body,
      global: { stubs: { NuxtLink: RouterLinkStub } },
      props: { entries, label: 'Corporation record sections' },
      route: false,
    })
    mountedWrappers.push(wrapper)

    const historyLink = wrapper.findAll('a')[1]
    expect(wrapper.findAllComponents(RouterLinkStub)[1]?.props('to')).toBe('/characters/42/history')

    historyLink?.element.focus()
    await historyLink?.trigger('focus')

    expect(document.activeElement).toBe(historyLink?.element)
    expect(wrapper.emitted('intent')?.[0]?.[0]).toEqual(entries[1])
  })

  it('renders additional contributed sections without assuming a fixed count', async () => {
    currentRoute.path = '/characters/42/intelligence'
    const extendedEntries = [
      ...entries,
      { id: 'skills', label: 'SKILLS', to: '/characters/42/skills' },
      { id: 'finance', label: 'FINANCE', to: '/characters/42/finance' },
      { id: 'mail', label: 'MAIL', to: '/characters/42/mail' },
      {
        id: 'module-intelligence',
        label: 'INTELLIGENCE',
        to: '/characters/42/intelligence',
      },
    ]
    const wrapper = await mountSuspended(RecordSectionNavigation, {
      global: { stubs: { NuxtLink: RouterLinkStub } },
      props: { entries: extendedEntries, label: 'Character record sections' },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.findAll('a')).toHaveLength(6)
    expect(wrapper.get('[aria-current="page"]').text()).toBe('INTELLIGENCE')
  })
})
