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
          ownerId: 'core',
          navigationId: 'core-overview',
          label: 'Overview',
          description: 'System and identity summary',
          to: '/',
          icon: 'overview',
          audience: 'public',
        },
        {
          ownerId: 'core',
          navigationId: 'core-characters',
          label: 'Characters',
          description: 'Authorized capsuleer record',
          to: '/characters',
          icon: 'character',
          audience: 'authenticated',
        },
        {
          ownerId: 'core',
          navigationId: 'core-mail',
          label: 'Mail',
          description: 'Main character mailbox',
          to: '/characters/:characterId/mail',
          icon: 'mail',
          audience: 'authenticated',
        },
      ],
    },
  },
}))

mockNuxtImport('useRoute', () => () => currentRoute)
mockNuxtImport('usePlatformNavigation', () => () => platformNavigation)

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

async function mountSidebar(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(AppSidebar, {
    global: {
      stubs: {
        NuxtLink: RouterLinkStub,
        UiTooltip: {
          setup:
            (_, { slots }) =>
            () =>
              h('div', slots.default?.()),
        },
        UiActionMenubar: {
          setup:
            (_, { slots }) =>
            () =>
              h('div', slots.trigger?.()),
        },
      },
    },
    props: {
      authenticated: true,
      adminAuthenticated: false,
      authLoading: false,
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
