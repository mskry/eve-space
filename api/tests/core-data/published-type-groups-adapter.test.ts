import { describe, expect, test, vi } from 'vitest'
import { loadPublishedTypeGroupsProduct } from '../../src/core-data/published-type-groups-adapter.js'

const sparseTypeIds: number[] = []
sparseTypeIds.length = 1

describe('published type-groups product validation', () => {
  test.each([
    [undefined, 'must contain a typeIds array'],
    [{ typeIds: sparseTypeIds }, 'positive safe integers'],
    [{ typeIds: [0] }, 'positive safe integers'],
    [{ typeIds: [1.5] }, 'positive safe integers'],
    [{ typeIds: [Number.MAX_SAFE_INTEGER + 1] }, 'positive safe integers'],
    [{ typeIds: Array.from({ length: 501 }, (_, index) => index + 1) }, 'cannot exceed 500'],
  ])('rejects an invalid complete request before source access', (request, message) => {
    const begin = vi.fn()
    const database = { begin }

    expect(() => loadPublishedTypeGroupsProduct(request as never, database)).toThrow(message)
    expect(begin).not.toHaveBeenCalled()
  })
})
