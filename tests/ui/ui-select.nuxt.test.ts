import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import UiSelect from '../../layers/ui/app/components/ui/UiSelect.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('UiSelect', () => {
  it('exposes a controlled accessible selection', async () => {
    const Host = defineComponent({
      setup() {
        const value = ref('all')
        return () =>
          h('div', [
            h('output', { 'data-value': '' }, value.value),
            h(UiSelect, {
              label: 'Type filter',
              modelValue: value.value,
              options: [
                { label: 'All types', value: 'all' },
                { label: 'Tritanium', value: '34' },
              ],
              'onUpdate:modelValue': (next: string) => {
                value.value = next
              },
            }),
          ])
      },
    })
    const wrapper = await mountSuspended(Host, {
      attachTo: document.body,
      route: false,
    })
    mountedWrappers.push(wrapper)

    const trigger = wrapper.get('button[aria-label="Type filter"]')
    expect(trigger.attributes('role')).toBe('combobox')
    expect(trigger.text()).toContain('All types')

    await trigger.trigger('pointerdown', {
      button: 0,
      ctrlKey: false,
      pageX: 0,
      pageY: 0,
      pointerId: 1,
      pointerType: 'mouse',
    })
    await settle()
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((entry) =>
      entry.textContent?.includes('Tritanium'),
    )
    expect(option).toBeDefined()
    option?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }))
    await settle()

    expect(wrapper.get('[data-value]').text()).toBe('34')
    expect(trigger.text()).toContain('Tritanium')
  })
})

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
