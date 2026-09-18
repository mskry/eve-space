import { expect, test, vi } from 'vitest'
import {
  installedModulePersistenceCapabilityFactories,
  installedModulePersistenceOperationCatalog,
} from '../../src/generated/platform/installed-module-persistence.js'
import { installedModuleResources } from '../../src/generated/platform/installed-module-worker.js'

test('keeps the legacy skill writer installed without granting it to active resources', () => {
  expect(
    installedModulePersistenceOperationCatalog['member-audit/write-skill-snapshot'].grants,
  ).toEqual({
    routes: [],
    activityProviders: [],
    resourceProjections: [],
    resourceMaterializations: [],
  })

  const capability = installedModulePersistenceCapabilityFactories.resourceMaterializations[
    'member-audit/trained-skills'
  ](vi.fn())
  expect(Object.keys(capability).toSorted()).toEqual([
    'materializeCurrentSnapshot',
    'purgeEvidence',
  ])
  expect(capability).not.toHaveProperty('writeSkillSnapshot')
  expect(installedModulePersistenceCapabilityFactories.resourceMaterializations).not.toHaveProperty(
    'member-audit/skill-queue',
  )
})

test('registers only independent audit evidence resources with managed-member gates', () => {
  const resources = installedModuleResources.filter(({ moduleId }) => moduleId === 'member-audit')
  expect(resources.map(({ resourceId }) => resourceId)).toEqual([
    'trained-skills',
    'assets',
    'wallet-balance',
    'wallet-journal',
    'wallet-transactions',
    'mail-headers',
    'mail-details',
  ])
  expect(
    resources.every(({ eligibility }) => eligibility.kind === 'current-managed-member-character'),
  ).toBe(true)
  expect(
    resources.some(({ resourceId }) =>
      ['skill-queue', 'affiliation', 'compliance', 'groups', 'blocks'].includes(resourceId),
    ),
  ).toBe(false)
})
