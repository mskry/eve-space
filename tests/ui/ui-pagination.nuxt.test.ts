import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import UiPagination from '../../layers/ui/app/components/ui/UiPagination.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

describe('UiPagination', () => {
  it('exposes current and total page semantics and emits adjacent pages', async () => {
    const wrapper = await mountSuspended(UiPagination, {
      props: {
        currentPage: 2,
        label: 'Journal pages',
        totalPages: 4,
      },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.attributes('aria-label')).toBe('Journal pages')
    expect(wrapper.get('[aria-current="page"]').text()).toBe('Page 2 of 4')

    const previous = wrapper.get('button[aria-label="Previous page"]')
    const next = wrapper.get('button[aria-label="Next page"]')
    expect(previous.attributes('disabled')).toBeUndefined()
    expect(next.attributes('disabled')).toBeUndefined()

    await previous.trigger('click')
    await next.trigger('click')

    expect(wrapper.emitted('change-page')).toEqual([[1], [3]])
  })

  it('disables boundary controls and never emits an out-of-range page', async () => {
    const firstPage = await mountSuspended(UiPagination, {
      props: {
        currentPage: 1,
        label: 'Contract pages',
        totalPages: 3,
      },
      route: false,
    })
    mountedWrappers.push(firstPage)

    const firstPrevious = firstPage.get('button[aria-label="Previous page"]')
    expect(firstPrevious.attributes()).toHaveProperty('disabled')
    await firstPrevious.trigger('click')
    await firstPage.get('button[aria-label="Next page"]').trigger('click')
    expect(firstPage.emitted('change-page')).toEqual([[2]])

    const lastPage = await mountSuspended(UiPagination, {
      props: {
        currentPage: 3,
        label: 'Contract pages',
        totalPages: 3,
      },
      route: false,
    })
    mountedWrappers.push(lastPage)

    const lastNext = lastPage.get('button[aria-label="Next page"]')
    expect(lastNext.attributes()).toHaveProperty('disabled')
    await lastNext.trigger('click')
    await lastPage.get('button[aria-label="Previous page"]').trigger('click')
    expect(lastPage.emitted('change-page')).toEqual([[2]])
  })
})
