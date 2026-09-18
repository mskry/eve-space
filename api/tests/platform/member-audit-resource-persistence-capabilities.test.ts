import { expect, test, vi } from 'vitest'
import {
  installedModulePersistenceCapabilityFactories,
  installedModulePersistenceOperationCatalog,
} from '../../src/generated/platform/installed-module-persistence.js'

test('keeps the legacy skill writer installed without granting it to active resources', () => {
  expect(
    installedModulePersistenceOperationCatalog['member-audit/write-skill-snapshot'].grants,
  ).toEqual({
    routes: [],
    activityProviders: [],
    resourceProjections: [],
    resourceMaterializations: [],
  })

  for (const resourceId of ['trained-skills', 'skill-queue'] as const) {
    const capability = installedModulePersistenceCapabilityFactories.resourceMaterializations[
      `member-audit/${resourceId}`
    ](vi.fn())
    expect(Object.keys(capability).toSorted()).toEqual([
      'materializeCurrentSnapshot',
      'purgeEvidence',
    ])
    expect(capability).not.toHaveProperty('writeSkillSnapshot')
  }
})
