import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import UiContextMenu from '../../layers/ui/app/components/ui/UiContextMenu.vue'
import UiContextMenuItem from '../../layers/ui/app/components/ui/UiContextMenuItem.vue'

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

const mountedWrappers: { unmount: () => void }[] = []

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  await settle()
  document.body.replaceChildren()
})

const openMenu = async (props: { accessibleLabel?: string; label: string }) => {
  const Host = defineComponent({
    setup: () => () =>
      h(UiContextMenu, props, {
        default: () => h(UiContextMenuItem, null, { default: () => 'Set as main' }),
        trigger: () => h('button', { type: 'button' }, 'Roster Pilot'),
      }),
  })
  const wrapper = await mountSuspended(Host, { attachTo: document.body, route: false })
  mountedWrappers.push(wrapper)

  wrapper.get('button').element.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      button: 2,
      cancelable: true,
    }),
  )
  await settle()

  return document.querySelector<HTMLElement>('[role="menu"]')
}

describe('UiContextMenu', () => {
  it('separates its visible heading from its accessible target label', async () => {
    const menu = await openMenu({
      accessibleLabel: 'Character actions for Roster Pilot',
      label: 'Character actions',
    })

    expect(menu?.getAttribute('aria-label')).toBe('Character actions for Roster Pilot')
    expect(menu?.textContent).toContain('Character actions')
    expect(menu?.textContent).not.toContain('Roster Pilot')
  })

  it('falls back to its visible heading as the accessible label', async () => {
    const menu = await openMenu({ label: 'Character actions' })

    expect(menu?.getAttribute('aria-label')).toBe('Character actions')
  })
})
