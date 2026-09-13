import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import MailBodyText from '../../app/components/mail/MailBodyText.vue'
import MailHeaderList from '../../app/components/mail/MailHeaderList.vue'
import MailLabelSidebar from '../../app/components/mail/MailLabelSidebar.vue'
import MailReader from '../../app/components/mail/MailReader.vue'
import type { MailLabel } from '../../app/queries/mail'
import { createKeyedMailLabels } from '../../app/utils/mail-view'
import UiEveImage from '../../layers/ui/app/components/ui/UiEveImage.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('accessible image and repeated-list behavior', () => {
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
      attrs: { 'aria-hidden': 'true', class: 'caller-image' },
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

  it('retains paragraph DOM identity through duplicate insertion and reordering', async () => {
    const wrapper = await mountSuspended(MailBodyText, {
      props: { body: 'Repeated\n\nUnique\n\nRepeated' },
      route: false,
    })
    mountedWrappers.push(wrapper)
    const originalParagraphs = wrapper.findAll('p').map((paragraph) => paragraph.element)

    await wrapper.setProps({ body: 'Repeated\n\nRepeated\n\nUnique\n\nRepeated' })
    const withDuplicate = wrapper.findAll('p').map((paragraph) => paragraph.element)

    expect(withDuplicate).toHaveLength(4)
    expect(originalParagraphs.every((paragraph) => withDuplicate.includes(paragraph))).toBe(true)

    await wrapper.setProps({ body: 'Unique\n\nRepeated\n\nRepeated\n\nRepeated' })
    const reorderedParagraphs = wrapper.findAll('p').map((paragraph) => paragraph.element)

    expect(reorderedParagraphs[0]).toBe(originalParagraphs[1])
    expect(originalParagraphs.every((paragraph) => reorderedParagraphs.includes(paragraph))).toBe(
      true,
    )
  })

  it('renders hostile mail body markup as inert text', async () => {
    const wrapper = await mountSuspended(MailBodyText, {
      props: { body: '<img src=x onerror=alert(1)>\n\n<a href="javascript:x">link</a>' },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.text()).toContain('<a href="javascript:x">link</a>')
  })

  it('assigns unique, stable identities to duplicate and null mail labels', () => {
    const labels: MailLabel[] = [
      { color: null, labelId: null, name: null, unreadCount: null },
      { color: '#ffffff', labelId: 7, name: 'Operations', unreadCount: 2 },
      { color: '#999999', labelId: 7, name: 'Duplicate provider row', unreadCount: 0 },
      { color: null, labelId: null, name: null, unreadCount: null },
    ]
    const keyedMailLabels = createKeyedMailLabels()
    const entries = keyedMailLabels(labels)
    const reorderedLabels = [
      { color: '#fe0000', labelId: 7, name: 'Inserted duplicate', unreadCount: 0 },
      { ...labels[2]! },
      { ...labels[0]! },
      { ...labels[1]! },
      { ...labels[3]! },
    ]
    const reorderedEntries = keyedMailLabels(reorderedLabels)

    expect(new Set(entries.map(({ key }) => key)).size).toBe(labels.length)
    expect(new Set(reorderedEntries.map(({ key }) => key)).size).toBe(reorderedLabels.length)
    expect(reorderedEntries.find(({ item }) => item.name === 'Operations')?.key).toBe(
      entries.find(({ item }) => item.name === 'Operations')?.key,
    )
    expect(reorderedEntries.find(({ item }) => item.name === 'Duplicate provider row')?.key).toBe(
      entries.find(({ item }) => item.name === 'Duplicate provider row')?.key,
    )
    expect(
      reorderedEntries.filter(({ item }) => item.labelId === null).map(({ key }) => key),
    ).toEqual(entries.filter(({ item }) => item.labelId === null).map(({ key }) => key))
  })

  it('retains rendered duplicate label rows when a duplicate is inserted and reordered', async () => {
    const red: MailLabel = { color: '#fe0000', labelId: 7, name: 'Red', unreadCount: 1 }
    const blue: MailLabel = { color: '#0000fe', labelId: 7, name: 'Blue', unreadCount: 2 }
    const wrapper = await mountSuspended(MailLabelSidebar, {
      props: {
        activeLabelId: null,
        labels: [red, blue],
        mailingLists: [],
        selectedMailingListId: null,
        totalUnreadCount: 3,
      },
      route: false,
    })
    mountedWrappers.push(wrapper)
    const redRow = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Red'))?.element
    const blueRow = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Blue'))?.element

    await wrapper.setProps({
      labels: [
        { color: '#00fe00', labelId: 7, name: 'Green', unreadCount: 0 },
        { ...blue },
        { ...red },
      ],
    })

    expect(wrapper.findAll('button').find((button) => button.text().includes('Red'))?.element).toBe(
      redRow,
    )
    expect(
      wrapper.findAll('button').find((button) => button.text().includes('Blue'))?.element,
    ).toBe(blueRow)
  })

  it('renders fixed semantic skeleton identities instead of index-keyed placeholders', async () => {
    const headers = await mountSuspended(MailHeaderList, {
      props: {
        canLoadOlder: false,
        emptyMessage: 'No mail.',
        filteredHeaders: [],
        filtersActive: false,
        labels: [],
        loadedCount: 0,
        loading: true,
        loadingOlder: false,
        olderError: '',
        search: '',
        selectedMailId: null,
        unreadOnly: false,
      },
      route: false,
    })
    mountedWrappers.push(headers)
    expect(headers.findAll('.mail-header-skeleton')).toHaveLength(6)

    const reader = await mountSuspended(MailReader, {
      props: {
        labels: [],
        loading: true,
        mutationPending: false,
        canReply: false,
        readState: null,
        selected: true,
      },
      route: false,
    })
    mountedWrappers.push(reader)
    expect(reader.findAll('.mail-reader-skeleton-actions .mail-skeleton-block')).toHaveLength(6)
  })
})
