import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import UiRadioGroup from '../../layers/ui/app/components/ui/UiRadioGroup.vue'

const mountedWrappers: { unmount: () => void }[] = []

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('UiRadioGroup', () => {
  it('provides radio semantics, a checked indicator, and arrow-key navigation', async () => {
    const Host = defineComponent({
      setup() {
        const value = ref('white')
        return () =>
          h('div', [
            h('output', { 'data-value': '' }, value.value),
            h(
              UiRadioGroup,
              {
                label: 'Label color',
                modelValue: value.value,
                options: [
                  { label: 'White', value: 'white' },
                  { label: 'Blue', value: 'blue' },
                ],
                'onUpdate:modelValue': (next: string | undefined) => {
                  value.value = next ?? ''
                },
              },
              {
                option: ({ option }: { option: { label: string } }) => h('span', option.label),
              },
            ),
          ])
      },
    })
    const wrapper = await mountSuspended(Host, { attachTo: document.body, route: false })
    mountedWrappers.push(wrapper)
    const group = document.querySelector('[role="radiogroup"]')
    const radios = [...document.querySelectorAll<HTMLElement>('[role="radio"]')]

    expect(group?.getAttribute('aria-label')).toBe('Label color')
    expect(radios).toHaveLength(2)
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true')
    expect(radios[0]?.textContent).toContain(String.fromCharCode(10003))

    radios[0]?.focus()
    radios[0]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    await settle()

    expect(document.activeElement).toBe(radios[1])
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true')
    expect(wrapper.get('[data-value]').text()).toBe('blue')
  })
})
