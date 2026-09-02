import { mountSuspended } from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import EveItemInformationContent from '../../app/components/EveItemInformationContent.vue'

const mountedWrappers: { unmount: () => void }[] = []
const item = {
  typeId: 34,
  name: 'Tritanium',
  description: 'Useful <img src=x onerror="globalThis.compromised=true"> material.',
  group: { id: 18, name: 'Mineral' },
  category: { id: 4, name: 'Material' },
  detail: null,
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

describe('EveItemInformationContent', () => {
  it('renders generic item identity, safe description text, and caller-provided details', async () => {
    const wrapper = await mountSuspended(EveItemInformationContent, {
      props: { item, status: 'loaded' },
      route: false,
      slots: {
        details: ({ item: loadedItem }: { item: typeof item }) =>
          h('p', { class: 'caller-extension' }, `Volume for ${loadedItem.name}`),
      },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('h2').text()).toBe('Tritanium')
    expect(wrapper.text()).toContain('Material / Mineral')
    expect(wrapper.text()).not.toContain('TYPE ID')
    expect(wrapper.find('.eve-item-information-identity').exists()).toBe(false)
    expect(wrapper.text()).toContain(item.description)
    expect(wrapper.findAll('img')).toHaveLength(1)
    expect(wrapper.get('.caller-extension').text()).toBe('Volume for Tritanium')
    expect(wrapper.html()).toContain('&lt;img src=x onerror="globalThis.compromised=true"&gt;')
  })

  it('presents loading, unavailable retry, and deterministic no-description states', async () => {
    const loading = await mountSuspended(EveItemInformationContent, {
      props: { status: 'loading' },
      route: false,
    })
    mountedWrappers.push(loading)
    expect(loading.get('output').text()).toContain('Loading item information')

    const unavailable = await mountSuspended(EveItemInformationContent, {
      props: { status: 'unavailable' },
      route: false,
    })
    mountedWrappers.push(unavailable)
    await unavailable.get('button').trigger('click')
    expect(unavailable.get('[role="alert"]').text()).toContain('Item information unavailable')
    expect(unavailable.emitted('retry')).toHaveLength(1)

    const withoutDescription = await mountSuspended(EveItemInformationContent, {
      props: { item: { ...item, description: null }, status: 'loaded' },
      route: false,
    })
    mountedWrappers.push(withoutDescription)
    expect(withoutDescription.text()).toContain('No description is available for this item.')
  })

  it('stays surface-neutral and constrains unbroken content at narrow widths', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'app/components/EveItemInformationContent.vue'),
      'utf8',
    )

    expect(source).toContain('max-width: 100%')
    expect(source).toContain('overflow-wrap: anywhere')
    expect(source).not.toMatch(/UiPopover|useRoute|useQuery|CharacterSkills|Primary attribute|Rank/)
  })
})
