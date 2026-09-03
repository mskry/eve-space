import { mountSuspended } from '@nuxt/test-utils/runtime'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ImplantInformationPopover from '../../app/components/character/clones/ImplantInformationPopover.vue'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []
const implant = {
  typeId: 10208,
  name: 'Memory Augmentation - Basic',
  description: 'A neural implant that improves memory.',
  group: { id: 300, name: 'Cyberimplant' },
  category: { id: 20, name: 'Implant' },
  detail: {
    kind: 'implant' as const,
    slot: 1,
    bonuses: [
      { attribute: 'memory' as const, value: 3 },
      { attribute: 'perception' as const, value: -1 },
    ],
  },
}

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

afterEach(async () => {
  queryServer.resetHandlers()
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  await settle()
  document.body.replaceChildren()
})

describe('character clone implant information', () => {
  it('loads public implant details only after keyboard activation and restores focus', async () => {
    const requestedUrls: string[] = []
    queryServer.use(
      http.get(`*/api/universe/types/${implant.typeId}`, ({ request }) => {
        requestedUrls.push(request.url)
        return HttpResponse.json(implant)
      }),
    )
    const wrapper = await mountSuspended(ImplantInformationPopover, {
      attachTo: document.body,
      props: { name: implant.name, typeId: implant.typeId },
      route: false,
      slots: { default: () => 'Open implant' },
    })
    mountedWrappers.push(wrapper)
    const trigger = wrapper.get('button')

    expect(trigger.attributes('aria-label')).toBe(`View item information for ${implant.name}`)
    expect(requestedUrls).toHaveLength(0)

    trigger.element.focus()
    trigger.element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    trigger.element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }))
    await trigger.trigger('click')
    await vi.waitFor(() => expect(requestedUrls).toHaveLength(1))
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(implant.name),
    )

    const detailsTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Implant details',
    ) as HTMLButtonElement
    detailsTab.click()
    await settle()
    expect(document.querySelector('.character-clones-implant-details')?.textContent).toContain(
      'Implant slot1',
    )
    expect(document.querySelector('.character-clones-implant-details')?.textContent).toContain(
      'Memory+3',
    )
    expect(document.querySelector('.character-clones-implant-details')?.textContent).toContain(
      'Perception-1',
    )

    const requested = new URL(requestedUrls[0]!)
    expect(requested.pathname).toBe(`/api/universe/types/${implant.typeId}`)
    expect(`${requested.search}${requested.hash}`).not.toMatch(
      /clone|character|location|placement/i,
    )

    const close = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Close item information',
    ) as HTMLButtonElement
    close.click()
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
  })

  it('keeps the implant trigger usable when public details are unavailable', async () => {
    const unavailableTypeId = implant.typeId + 1
    queryServer.use(
      http.get(`*/api/universe/types/${unavailableTypeId}`, () =>
        HttpResponse.json({ code: 'TYPE_NOT_FOUND', message: 'Type not found.' }, { status: 404 }),
      ),
    )
    const wrapper = await mountSuspended(ImplantInformationPopover, {
      attachTo: document.body,
      props: { name: implant.name, typeId: unavailableTypeId },
      route: false,
    })
    mountedWrappers.push(wrapper)

    await wrapper.get('button').trigger('click')
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        'Item information unavailable',
      ),
    )
    expect(wrapper.get('button').attributes('aria-label')).toContain(implant.name)
  })
})
