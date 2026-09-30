import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { RouterLinkStub } from '@vue/test-utils'
import { h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppSidebar from '../../app/components/AppSidebar.vue'

const { currentRoute, platformNavigation } = vi.hoisted(() => ({
  currentRoute: { path: '/' },
  platformNavigation: {
    navigation: {
      value: [
        {
          audience: 'public',
          description: 'System and identity summary',
          icon: 'overview',
          label: 'Overview',
          navigationId: 'core-overview',
          ownerId: 'core',
          to: '/',
        },
        {
          audience: 'authenticated',
          description: 'Authorized capsuleer record',
          icon: 'character',
          label: 'Characters',
          navigationId: 'core-characters',
          ownerId: 'core',
          to: '/characters',
        },
        {
          audience: 'authenticated',
          description: 'Main character mailbox',
          icon: 'mail',
          label: 'Mail',
          navigationId: 'core-mail',
          ownerId: 'core',
          to: '/characters/:characterId/mail',
        },
      ],
    },
  },
}))

mockNuxtImport('useRoute', () => () => currentRoute)
mockNuxtImport('usePlatformNavigation', () => () => platformNavigation)

const mountedWrappers: { unmount: () => void }[] = []
const sidebarOrderKey = 'eve-space-dashboard-sidebar-order'

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  localStorage.removeItem(sidebarOrderKey)
})

async function mountSidebar(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(AppSidebar, {
    global: {
      stubs: {
        NuxtLink: RouterLinkStub,
        UiActionMenubar: {
          setup:
            (_, { slots }) =>
            () =>
              h('div', slots.trigger?.()),
        },
        UiTooltip: {
          setup:
            (_, { slots }) =>
            () =>
              h('div', slots.default?.()),
        },
      },
    },
    props: {
      adminAuthenticated: false,
      authLoading: false,
      authenticated: true,
      characterId: 7,
      characterName: 'Bandera Primary',
      ...props,
    },
    route: false,
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

function mailLink(wrapper: Awaited<ReturnType<typeof mountSidebar>>) {
  return wrapper.findAll('.sidebar-link').find((link) => link.text().includes('Mail'))
}

describe('AppSidebar mail entry', () => {
  it('points the shell mail entry at the authorized character mailbox', async () => {
    const wrapper = await mountSidebar()

    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links.map((link) => link.props('to'))).toContain('/characters/7/mail')
    expect(mailLink(wrapper)?.find('path[d="m3.5 6.5 8.5 6.5 8.5-6.5"]').exists()).toBe(true)
  })

  it('falls back to the roster when no character is authorized', async () => {
    currentRoute.path = '/characters'
    const wrapper = await mountSidebar({ authenticated: false, characterId: undefined })

    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links.map((link) => link.props('to')).filter((to) => to === '/characters')).toHaveLength(
      2,
    )
    expect(wrapper.find('.sidebar-badge').exists()).toBe(false)

    const active = wrapper.findAll('.sidebar-link--active')
    expect(active).toHaveLength(1)
    expect(active[0]?.text()).toContain('Characters')
    currentRoute.path = '/'
  })

  it('presents an unavailable identity without offering sign-in as an anonymous verdict', async () => {
    const wrapper = await mountSidebar({
      authUnavailable: true,
      authenticated: false,
      characterId: undefined,
    })

    expect(wrapper.text()).toContain('IDENTITY UNAVAILABLE')
    expect(wrapper.find('.sidebar-auth-link').exists()).toBe(false)
  })

  it('renders no badge without a positive unread count', async () => {
    for (const mailUnreadCount of [undefined, 0]) {
      const wrapper = await mountSidebar({ mailUnreadCount })
      expect(wrapper.find('.sidebar-badge').exists()).toBe(false)
    }
  })

  it('badges only the mail entry with the exact count and an accessible label', async () => {
    const wrapper = await mountSidebar({ mailUnreadCount: 12 })

    const badges = wrapper.findAll('.sidebar-badge')
    expect(badges).toHaveLength(1)
    expect(mailLink(wrapper)?.find('.sidebar-badge').exists()).toBe(true)
    expect(badges[0]?.get('[aria-hidden="true"]').text()).toBe('12')
    expect(badges[0]?.get('.sr-only').text()).toBe('12 unread mails')
  })

  it('caps the visible count at 99+ while keeping the actual count accessible', async () => {
    const wrapper = await mountSidebar({ mailUnreadCount: 247 })

    const badge = wrapper.get('.sidebar-badge')
    expect(badge.get('[aria-hidden="true"]').text()).toBe('99+')
    expect(badge.get('.sr-only').text()).toBe('247 unread mails')
  })

  it('marks only the most specific matching section as current', async () => {
    currentRoute.path = '/characters/7/mail'
    const wrapper = await mountSidebar()

    const active = wrapper.findAll('.sidebar-link--active')
    expect(active).toHaveLength(1)
    expect(active[0]?.text()).toContain('Mail')

    currentRoute.path = '/characters'
    const rosterWrapper = await mountSidebar()
    const rosterActive = rosterWrapper.findAll('.sidebar-link--active')
    expect(rosterActive).toHaveLength(1)
    expect(rosterActive[0]?.text()).toContain('Characters')
    currentRoute.path = '/'
  })
})

const sectionLabels = (wrapper: Awaited<ReturnType<typeof mountSidebar>>) =>
  wrapper.findAll('.sidebar-nav-item .sidebar-label strong').map((label) => label.text())

describe('AppSidebar persistent section order', () => {
  it('reorders on drop and restores the order from local storage on remount', async () => {
    const wrapper = await mountSidebar()
    const items = wrapper.findAll('.sidebar-nav-item')
    expect(sectionLabels(wrapper)).toEqual(['Overview', 'Characters', 'Mail'])

    await items[2]!.trigger('dragstart', { dataTransfer: { setData: vi.fn() } })
    await items[0]!.trigger('dragover')
    await items[0]!.trigger('drop', { clientY: 0 })

    expect(sectionLabels(wrapper)).toEqual(['Mail', 'Overview', 'Characters'])
    expect(JSON.parse(localStorage.getItem(sidebarOrderKey)!)).toEqual([
      'core/core-mail',
      'core/core-overview',
      'core/core-characters',
    ])
    const restored = await mountSidebar()
    expect(sectionLabels(restored)).toEqual(['Mail', 'Overview', 'Characters'])
  })

  it('moves focused links with Alt+Arrow keys and keeps the drawer in default order', async () => {
    const wrapper = await mountSidebar()
    await wrapper.findAll('.sidebar-nav-item .sidebar-link')[0]!.trigger('keydown', {
      altKey: true,
      key: 'ArrowDown',
    })
    expect(sectionLabels(wrapper)).toEqual(['Characters', 'Overview', 'Mail'])
    expect(wrapper.get('output').text()).toContain('Overview moved to position 2')

    const drawer = await mountSidebar({ variant: 'drawer' })
    expect(sectionLabels(drawer)).toEqual(['Overview', 'Characters', 'Mail'])
    expect(drawer.find('.sidebar-nav-item').attributes('draggable')).toBe('false')
  })

  it('ignores malformed preferences and places newly available sections after saved entries', async () => {
    localStorage.setItem(sidebarOrderKey, '{bad json')
    const fallback = await mountSidebar()
    expect(sectionLabels(fallback)).toEqual(['Overview', 'Characters', 'Mail'])

    localStorage.setItem(sidebarOrderKey, JSON.stringify(['core/core-mail', 'core/core-overview']))
    const restored = await mountSidebar()
    expect(sectionLabels(restored)).toEqual(['Mail', 'Overview', 'Characters'])
  })
})
