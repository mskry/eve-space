import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import UiToggleGroup from '../../layers/ui/app/components/ui/UiToggleGroup.vue'

const mountedWrappers: { unmount: () => void }[] = []

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function createHost() {
  return defineComponent({
    setup() {
      const value = ref('week')
      const options = [
        { label: 'Day', value: 'day' },
        { label: 'Week', value: 'week' },
        { label: 'Month', value: 'month' },
      ] as const

      return () =>
        h('div', [
          h('output', { 'data-value': '' }, value.value),
          h(
            UiToggleGroup,
            {
              label: 'Loaded data range',
              modelValue: value.value,
              options,
              'onUpdate:modelValue': (next: string) => {
                value.value = next
              },
            },
            {
              option: ({ option, selected }) =>
                h('span', { 'data-option': option.value, 'data-selected': selected }, option.label),
            },
          ),
        ])
    },
  })
}

async function mountHost() {
  const wrapper = await mountSuspended(createHost(), {
    attachTo: document.body,
    route: false,
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('UiToggleGroup', () => {
  it('keeps one controlled option selected with accessible pressed-button semantics', async () => {
    const wrapper = await mountHost()
    const group = document.querySelector<HTMLElement>('[role="group"]')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]

    expect(group?.getAttribute('aria-label')).toBe('Loaded data range')
    expect(buttons).toHaveLength(3)
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ])
    expect(document.querySelector('[data-option="week"]')?.getAttribute('data-selected')).toBe(
      'true',
    )

    buttons[2]?.click()
    await settle()

    expect(wrapper.get('[data-value]').text()).toBe('month')
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
    ])

    buttons[2]?.click()
    await settle()

    expect(wrapper.get('[data-value]').text()).toBe('month')
    expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(
      1,
    )
  })

  it('moves focus with Arrow, Home, and End keys', async () => {
    await mountHost()
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]

    buttons[1]?.focus()
    buttons[1]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    await settle()
    expect(document.activeElement).toBe(buttons[2])

    buttons[2]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }))
    await settle()
    expect(document.activeElement).toBe(buttons[0])

    buttons[0]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }))
    await settle()
    expect(document.activeElement).toBe(buttons[2])

    buttons[2]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    await settle()
    expect(document.activeElement).toBe(buttons[0])
  })
})
