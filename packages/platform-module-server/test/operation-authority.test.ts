import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { operationRegistry } from '@evespace/esi-client/operations'
import { resolveOperationRolePredicate } from '@eve-space/platform-module-contract/esi'

const installedOperations = [
  'GetMilitaryCampaignsListing',
  'GetMilitaryCampaignsDetail',
  'GetMilitaryCampaignsObjectivesListing',
  'GetMilitaryCampaignsObjectivesDetail',
  'GetFreelanceJobsListing',
  'GetFreelanceJobsDetail',
  'GetCorporationsFreelanceJobsListing',
  'GetCorporationsProjectsListing',
  'GetCorporationsProjectsDetail',
  'GetCorporationsProjectsContribution',
  'GetCharactersFreelanceJobsListing',
  'GetCharactersFreelanceJobsParticipation',
  'GetCharactersMilitaryCampaignsObjectivesListing',
  'GetCharactersMilitaryCampaignsObjectivesParticipation',
] as const

const industryOperations = [
  ['GetCorporationsCorporationIdIndustryJobs', 'Factory_Manager', 'factory-manager'],
  ['GetCorporationCorporationIdMiningExtractions', 'Station_Manager', 'station-manager'],
  ['GetCorporationCorporationIdMiningObservers', 'Accountant', 'accountant'],
  ['GetCorporationCorporationIdMiningObserversObserverId', 'Accountant', 'accountant'],
] as const

describe('generated operation role inventories', () => {
  it('tracks every installed module operation identity', async () => {
    const source = await readFile(
      new URL('../../../features/organization-activity/server/src/operations.ts', import.meta.url),
      'utf8',
    )
    const declared = [...source.matchAll(/sdkOperationId: '([^']+)'/gu)].map((match) => match[1])
    expect(declared).toEqual(installedOperations)
  })

  it.each([
    [[], null],
    [['Director'], 'director'],
    [['Accountant'], 'accountant'],
    [['Factory_Manager'], 'factory-manager'],
    [['Station_Manager'], 'station-manager'],
    [['Project_Manager'], 'project-manager'],
  ] as const)('maps %j to %s', (roles, expected) => {
    expect(resolveOperationRolePredicate(roles)).toBe(expected)
  })

  it.each([['Other_Role'], ['Accountant', 'Director'], ['Accountant', 'Accountant']])(
    'rejects unsupported inventory %j',
    (...roles) => {
      expect(() => resolveOperationRolePredicate(roles)).toThrow(
        /generated operation role inventory/u,
      )
    },
  )

  it.each(installedOperations)('converts installed %s without role-policy drift', (id) => {
    const descriptor = operationRegistry[id].transport
    const expected = id === 'GetCorporationsFreelanceJobsListing' ? 'project-manager' : null
    expect(resolveOperationRolePredicate(descriptor.requiredRoles)).toBe(expected)
    expect(descriptor.requiredRoles).toEqual(expected ? ['Project_Manager'] : [])
  })

  it.each(industryOperations)(
    'converts reviewed corporation Industry %s',
    (id, role, predicate) => {
      const descriptor = operationRegistry[id].transport
      expect(descriptor.requestSubjectBindings).toEqual(['corporation_id'])
      expect(descriptor.requiredRoles).toEqual([role])
      expect(resolveOperationRolePredicate(descriptor.requiredRoles)).toBe(predicate)
    },
  )
})
