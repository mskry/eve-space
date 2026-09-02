import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQuery } from '@pinia/colada'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import EveItemInformationPopover from '../../app/components/EveItemInformationPopover.vue'
import { publicTypeDetailQuery } from '../../app/queries/universe'
import { createApiClient } from '../../app/utils/api-client'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []
const item = {
  typeId: 34,
  name: 'Tritanium',
  description: 'The main building block in space structures.',
  group: { id: 18, name: 'Mineral' },
  category: { id: 4, name: 'Material' },
  detail: null,
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

describe('EveItemInformationPopover', () => {
  it('gates loading by open state and shares successful public item data', async () => {
    const request = vi.fn()
    queryServer.use(
      http.get('*/api/universe/types/34', () => {
        request()
        return HttpResponse.json(item)
      }),
    )

    const FutureRouteHost = defineComponent({
      setup() {
        const query = useQuery(
          publicTypeDetailQuery({
            apiClient: createApiClient('http://localhost:8788'),
            typeId: item.typeId,
          }),
        )
        return () => h('output', { 'data-future-host': '' }, query.data.value?.name ?? 'loading')
      },
    })
    const Host = defineComponent({
      setup() {
        const showFutureHost = ref(false)
        const popoverOpen = ref(false)
        return () =>
          h('div', [
            h(
              EveItemInformationPopover,
              {
                open: popoverOpen.value,
                typeId: item.typeId,
                'onUpdate:open': (value: boolean) => {
                  popoverOpen.value = value
                },
              },
              {
                trigger: () => h('button', { type: 'button' }, 'View Tritanium'),
              },
            ),
            h('output', { 'data-popover-open': '' }, popoverOpen.value ? 'open' : 'closed'),
            h(
              'button',
              {
                type: 'button',
                onClick: () => {
                  showFutureHost.value = true
                },
              },
              'Mount future route',
            ),
            showFutureHost.value ? h(FutureRouteHost) : null,
          ])
      },
    })
    const wrapper = await mountSuspended(Host, { attachTo: document.body, route: false })
    mountedWrappers.push(wrapper)
    const trigger = wrapper.get('button')

    await trigger.trigger('mouseenter')
    await trigger.trigger('pointerenter')
    await settle()
    expect(request).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    trigger.element.focus()
    await trigger.trigger('click')
    await settle()
    expect(wrapper.get('[data-popover-open]').text()).toBe('open')
    expect(document.querySelector('[role="dialog"] h2')?.textContent).not.toBe(
      'Item information unavailable',
    )
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Tritanium'),
    )

    const close = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Close item information',
    ) as HTMLButtonElement
    close.click()
    await settle()
    expect(document.activeElement).toBe(trigger.element)

    await wrapper.get('button:nth-of-type(2)').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-future-host]').text()).toBe('Tritanium'))
    expect(request).toHaveBeenCalledTimes(1)
  })
})
