import { mountSuspended } from '@nuxt/test-utils/runtime'
import { TooltipProvider } from 'reka-ui'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import UiMainCharacterMark from '../../layers/ui/app/components/ui/UiMainCharacterMark.vue'

describe('UiMainCharacterMark', () => {
  it('keeps the icon variant accessible without rendering a visible label', async () => {
    const Host = defineComponent({
      setup: () => () =>
        h(TooltipProvider, null, {
          default: () => h(UiMainCharacterMark, { variant: 'icon' }),
        }),
    })
    const wrapper = await mountSuspended(Host, { route: false })
    const mark = wrapper.get('.main-mark--icon')

    expect(mark.attributes('aria-hidden')).toBeUndefined()
    expect(mark.get('svg').attributes('aria-hidden')).toBe('true')
    expect(mark.get('.sr-only').text()).toBe('Main character')
  })
})
