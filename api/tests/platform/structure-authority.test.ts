import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test, vi } from 'vitest'
import { installedModuleOnDemandResources } from '../../src/generated/platform/installed-module-on-demand.js'

const mocks = vi.hoisted(() => ({
  findOwnedCharacter: vi.fn(),
  loadOrganizationSessionContext: vi.fn(),
  authorizeOrganizationContribution: vi.fn(),
  getCharacterAuthorizationForLifecycle: vi.fn(),
}))
vi.mock('../../src/auth/character-lifecycle.js', () => ({
  findOwnedCharacter: mocks.findOwnedCharacter,
}))
vi.mock('../../src/organization/session-context.js', () => ({
  loadOrganizationSessionContext: mocks.loadOrganizationSessionContext,
}))
vi.mock('../../src/organization/module-authorization.js', () => ({
  authorizeOrganizationContribution: mocks.authorizeOrganizationContribution,
}))
vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorizationForLifecycle: mocks.getCharacterAuthorizationForLifecycle,
}))

import { getStructureAuthorization } from '../../src/platform/structure-authority.js'

const descriptor = installedModuleOnDemandResources['market/private-structures']
const authority = {
  userId: randomUUID(),
  characterId: 90000001,
  subjectLifecycleId: randomUUID(),
  organizationVersion: 7,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findOwnedCharacter.mockResolvedValue({
    characterId: authority.characterId,
    subjectLifecycleId: authority.subjectLifecycleId,
  })
  mocks.loadOrganizationSessionContext.mockResolvedValue({ organizationVersion: 7, blocked: false })
  mocks.authorizeOrganizationContribution.mockResolvedValue({
    authorized: true,
    context: { entitlementScope: 'all' },
  })
  mocks.getCharacterAuthorizationForLifecycle.mockResolvedValue({ tokenVersion: 4 })
})

test('never reads credentials for an unowned or unadmitted private structure subject', async () => {
  mocks.findOwnedCharacter.mockResolvedValueOnce(null)
  await expect(getStructureAuthorization(descriptor, authority)).resolves.toBeNull()
  expect(mocks.loadOrganizationSessionContext).not.toHaveBeenCalled()
  expect(mocks.getCharacterAuthorizationForLifecycle).not.toHaveBeenCalled()

  mocks.authorizeOrganizationContribution.mockResolvedValueOnce({
    authorized: false,
    reason: 'permission',
  })
  await expect(getStructureAuthorization(descriptor, authority)).resolves.toBeNull()
  expect(mocks.getCharacterAuthorizationForLifecycle).not.toHaveBeenCalled()
  mocks.loadOrganizationSessionContext.mockResolvedValueOnce({ organizationVersion: 8 })
  await expect(getStructureAuthorization(descriptor, authority)).resolves.toBeNull()
  expect(mocks.getCharacterAuthorizationForLifecycle).not.toHaveBeenCalled()
})

test('binds the generated structure-market scope to the exact lifecycle generation', async () => {
  await expect(getStructureAuthorization(descriptor, authority)).resolves.toMatchObject({
    tokenVersion: 4,
  })
  expect(mocks.getCharacterAuthorizationForLifecycle).toHaveBeenCalledWith(
    90000001,
    authority.subjectLifecycleId,
    'esi-markets.structure_markets.v1',
  )
  expect(mocks.authorizeOrganizationContribution).toHaveBeenCalledWith(
    authority.userId,
    expect.objectContaining({ organizationVersion: 7 }),
    descriptor,
  )
})
