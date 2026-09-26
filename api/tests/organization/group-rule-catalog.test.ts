import { expect, test } from 'vitest'
import { organizationRuleConditionCatalog } from '../../src/organization/group-rule-store.js'

test('advertises only corporation-role predicates supported by organization-rule persistence', () => {
  expect(organizationRuleConditionCatalog().corporationRoles).toStrictEqual([
    { predicate: 'director', location: 'roles' },
    { predicate: 'accountant', location: 'roles' },
    { predicate: 'factory-manager', location: 'roles' },
  ])
})
