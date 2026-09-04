import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import UiAutocomplete from '../../layers/ui/app/components/ui/UiAutocomplete.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('UiAutocomplete', () => {
  it('supports free-form text and keyboard-selectable suggestions', async () => {
    const Host = defineComponent({
      setup() {
        const value = ref('')
        return () =>
          h('div', [
            h('output', { 'data-value': '' }, value.value),
            h(UiAutocomplete, {
              inputId: 'inventory-search',
              label: 'Search inventory',
              modelValue: value.value,
              options: ['Cargo vault', 'Deep scanner'],
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

    const input = wrapper.get('#inventory-search')
    expect(input.attributes('role')).toBe('combobox')
    await input.setValue('Deep')
    expect(wrapper.get('[data-value]').text()).toBe('Deep')

    await input.trigger('keydown', { key: 'ArrowDown' })
    await settle()
    await input.trigger('keydown', { key: 'Enter' })
    await settle()
    expect(wrapper.get('[data-value]').text()).toBe('Deep scanner')
  })
})

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
