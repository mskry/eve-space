import { expect, test } from 'vitest'
import { marketBreadcrumbs } from '../src/runtime/app/market-breadcrumbs'

test('keeps selected item group context without fetching descendant types', () => {
  const groups = [
    { id: 1, parentId: null, name: 'Ships', iconId: null, directTypeCount: 0 },
    { id: 2, parentId: 1, name: 'Frigates', iconId: null, directTypeCount: 0 },
    { id: 3, parentId: 2, name: 'Minmatar', iconId: null, directTypeCount: 12 },
  ]
  expect(marketBreadcrumbs(groups, 3)).toEqual(['Ships', 'Frigates', 'Minmatar'])
  expect(marketBreadcrumbs(groups, 999)).toEqual([])
})
