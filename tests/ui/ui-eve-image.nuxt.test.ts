import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import UiEveImage from '../../layers/ui/app/components/ui/UiEveImage.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  document.body.replaceChildren()
})

describe('UiEveImage', () => {
  it('preserves EVE image URLs while exposing typed rendering controls and intrinsic dimensions', async () => {
    const defaultImage = await mountSuspended(UiEveImage, {
      props: { alt: 'Test portrait', dimension: 42, id: 7, kind: 'character' },
      route: false,
    })
    mountedWrappers.push(defaultImage)
    const defaultAttributes = defaultImage.get('img').attributes()

    expect(defaultAttributes).toMatchObject({
      alt: 'Test portrait',
      decoding: 'auto',
      fetchpriority: 'auto',
      height: '42',
      loading: 'eager',
      width: '42',
    })
    expect(defaultAttributes.src).toContain('/characters/7/portrait?size=64&tenant=tranquility')
    expect(defaultAttributes.srcset).toContain(
      '/characters/7/portrait?size=128&tenant=tranquility 2x',
    )

    const controlledImage = await mountSuspended(UiEveImage, {
      attrs: { 'aria-hidden': 'true', class: 'caller-image' },
      props: {
        alt: '',
        decoding: 'async',
        dimension: 42,
        fetchPriority: 'high',
        height: 48,
        id: 7,
        kind: 'character',
        loading: 'lazy',
        width: 96,
      },
      route: false,
    })
    mountedWrappers.push(controlledImage)
    const controlledAttributes = controlledImage.get('img').attributes()

    expect(controlledAttributes).toMatchObject({
      'aria-hidden': 'true',
      decoding: 'async',
      fetchpriority: 'high',
      height: '48',
      loading: 'lazy',
      width: '96',
    })
    expect(controlledAttributes.class).toContain('caller-image')
    expect(controlledAttributes.src).toBe(defaultAttributes.src)
    expect(controlledAttributes.srcset).toBe(defaultAttributes.srcset)
  })
})
