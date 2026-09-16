import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, test } from 'vitest'
import EveFormattedText from '../../app/components/EveFormattedText.vue'

describe('EVE formatted text', () => {
  test('renders canonical color runs as escaped text on an EVE-dark surface', async () => {
    const wrapper = await mountSuspended(EveFormattedText, {
      props: {
        value: {
          plainText: '<flag>',
          runs: [
            { color: '#ff000080', start: 0, text: '<' },
            { color: '#ffff00ff', start: 1, text: 'flag' },
            { start: 5, text: '>' },
          ],
        },
      },
      route: false,
    })

    expect(wrapper.text()).toBe('<flag>')
    expect(wrapper.get('.eve-formatted-text').classes()).toContain('eve-formatted-text--colored')
    expect(wrapper.findAll('.eve-formatted-text__line > span')).toHaveLength(3)
    expect(wrapper.html()).toContain('&lt;')
    expect(wrapper.html()).not.toContain('<flag>')
  })

  test('does not add the color surface to plain runs', async () => {
    const wrapper = await mountSuspended(EveFormattedText, {
      props: {
        value: {
          plainText: 'Plain biography',
          runs: [{ start: 0, text: 'Plain biography' }],
        },
      },
      route: false,
    })

    expect(wrapper.get('.eve-formatted-text').classes()).not.toContain(
      'eve-formatted-text--colored',
    )
  })

  test('uses compact line boxes only for Unicode block art', async () => {
    const wrapper = await mountSuspended(EveFormattedText, {
      props: {
        value: {
          plainText: '████\n████\n\nFly safe',
          runs: [
            { color: '#0000ffff', start: 0, text: '████\n' },
            { color: '#ffff00ff', start: 5, text: '████\n\n' },
            { start: 11, text: 'Fly safe' },
          ],
        },
      },
      route: false,
    })

    const lines = wrapper.findAll('.eve-formatted-text__line')
    expect(lines).toHaveLength(4)
    expect(lines[0]!.classes()).toContain('eve-formatted-text__line--compact')
    expect(lines[1]!.classes()).toContain('eve-formatted-text__line--compact')
    expect(lines[2]!.classes()).not.toContain('eve-formatted-text__line--compact')
    expect(lines[3]!.classes()).not.toContain('eve-formatted-text__line--compact')
  })
})
