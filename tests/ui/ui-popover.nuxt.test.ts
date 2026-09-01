import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import UiPopover from '../../layers/ui/app/components/ui/UiPopover.vue'

const mountedWrappers: { unmount: () => void }[] = []

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function createHost(arrow = true) {
  return defineComponent({
    setup() {
      const open = ref(false)
      return () =>
        h('div', [
          h('output', { 'data-open-state': '' }, open.value ? 'open' : 'closed'),
          h(
            UiPopover,
            {
              'aria-describedby': 'popover-description',
              'aria-label': 'Item information',
              arrow,
              'data-surface': 'item-information',
              open: open.value,
              'onUpdate:open': (value: boolean) => {
                open.value = value
              },
            },
            {
              default: () => [
                h('h2', { id: 'popover-title' }, 'Item information'),
                h('p', { id: 'popover-description' }, 'Static item details.'),
                h('a', { href: '#details' }, 'Read details'),
              ],
              trigger: () => h('button', { type: 'button' }, 'Open item information'),
            },
          ),
        ])
    },
  })
}

function getButton(name: string) {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
  expect(button, `button ${name} was not rendered`).toBeDefined()
  return button as HTMLButtonElement
}

async function mountHost(arrow = true) {
  const wrapper = await mountSuspended(createHost(arrow), {
    attachTo: document.body,
    route: false,
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

async function dismissWithClose(trigger: HTMLButtonElement) {
  getButton('X').click()
  await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
}

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  await settle()
  document.body.replaceChildren()
})

describe('UiPopover', () => {
  it('opens by click and tap-equivalent pointer activation with forwarded accessible attributes', async () => {
    const wrapper = await mountHost()
    const trigger = getButton('Open item information')

    trigger.focus()
    trigger.click()
    await settle()

    const popover = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(popover?.getAttribute('aria-label')).toBe('Item information')
    expect(popover?.getAttribute('aria-describedby')).toBe('popover-description')
    expect(popover?.getAttribute('data-surface')).toBe('item-information')
    expect(popover?.getAttribute('aria-labelledby')).toBe(trigger.id)
    expect(popover?.contains(document.activeElement)).toBe(true)
    expect(wrapper.get('[data-open-state]').text()).toBe('open')
    expect(document.querySelector('.ui-popover-arrow')).not.toBeNull()
    await dismissWithClose(trigger)

    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    trigger.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
    trigger.click()
    await settle()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('opens with Enter and Space and restores trigger focus after Escape', async () => {
    await mountHost()
    const trigger = getButton('Open item information')

    for (const key of ['Enter', ' ']) {
      trigger.focus()
      trigger.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
      trigger.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key }))
      trigger.click()
      await settle()
      expect(document.querySelector('[role="dialog"]')).not.toBeNull()

      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
      await settle()
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    }
  })

  it('dismisses from outside and supports omitting the arrow', async () => {
    const wrapper = await mountHost(false)
    const trigger = getButton('Open item information')
    trigger.focus()
    trigger.click()
    await settle()

    expect(document.querySelector('.ui-popover-arrow')).toBeNull()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.get('[data-open-state]').text()).toBe('closed')
    expect(document.activeElement).toBe(trigger)
  })
})
