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

afterEach(async () => {
  await settle()
  document.body.replaceChildren()
})

describe('UiContextMenu', () => {
  it('separates its visible heading from its accessible target label', async () => {
    const Host = defineComponent({
      setup: () => () =>
        h(
          UiContextMenu,
          {
            accessibleLabel: 'Character actions for Roster Pilot',
            label: 'Character actions',
          },
          {
            default: () => h(UiContextMenuItem, null, { default: () => 'Set as main' }),
            trigger: () => h('button', { type: 'button' }, 'Roster Pilot'),
          },
        ),
    })
    const wrapper = await mountSuspended(Host, { attachTo: document.body, route: false })

    wrapper.get('button').element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        button: 2,
        cancelable: true,
      }),
    )
    await settle()

    const menu = document.querySelector<HTMLElement>('[role="menu"]')
    expect(menu?.getAttribute('aria-label')).toBe('Character actions for Roster Pilot')
    expect(menu?.textContent).toContain('Character actions')
    expect(menu?.textContent).not.toContain('Roster Pilot')
  })
})
