import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  enabled: vi.fn(),
  organization: vi.fn(),
  permissions: vi.fn(),
  catalog: vi.fn(),
  authority: vi.fn(),
  owned: vi.fn(),
  authorization: vi.fn(),
}))
vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: boundary.enabled,
}))
vi.mock('../../src/organization/session-context.js', () => ({
  loadOrganizationSessionContext: boundary.organization,
}))
vi.mock('../../src/organization/group-permissions.js', () => ({
  getOrganizationGroupPermissions: boundary.permissions,
}))
vi.mock('../../src/organization/permission-catalog-store.js', () => ({
  currentCatalogPermission: boundary.catalog,
}))
vi.mock('../../src/organization/effective-authority.js', () => ({
  loadEffectiveOrganizationAuthority: boundary.authority,
}))
vi.mock('../../src/auth/character-lifecycle.js', () => ({ findOwnedCharacter: boundary.owned }))
vi.mock('../../src/auth/character-token-store.js', () => ({
  findCharacterCacheAuthorizationForLifecycle: boundary.authorization,
}))
vi.mock('../../src/auth/tokens.js', () => ({ schedulePendingCharacterTokenRecovery: vi.fn() }))
vi.mock('../../src/db/client.js', () => ({ db: {}, sql: {} }))

import { privateNoStore } from '../../src/http/private-response.js'
import { requireInstalledModuleEnabled } from '../../src/middleware/module-enablement.js'
import {
  requireModuleOrganizationAuthorization,
  type ModuleOrganizationAuthorizationEnv,
} from '../../src/middleware/module-authorization.js'
import {
  admitModuleRead,
  createModuleReadGuard,
  type ModuleReadPolicy,
} from '../../src/platform/read-admission.js'
import { guardReadCapabilities } from '../../src/platform/guarded-read-capabilities.js'
import { ReadAdmissionError } from '../../src/auth/read-policy.js'
import type { ReadAdmissionWork } from '../../src/auth/read-work.js'

const character = {
  characterId: 90_000_001,
  name: 'Owner',
  corporationId: 1,
  allianceId: null,
  isMain: true,
  subjectLifecycleId: 'lifecycle-a',
}
const session = { userId: 'user-a', mainCharacter: character }
const organization = {
  accessValidUntil: new Date(Date.now() + 600_000),
  blocked: false,
  evidenceFreshness: 'fresh' as const,
  organizationVersion: 7,
  reviewDeadline: null,
  state: 'compliant' as const,
}
const declaration = {
  moduleId: 'alpha',
  publisherPackage: '@example/alpha-manifest',
  audience: 'director' as const,
  requiredPermission: 'alpha.view',
  additionalRequiredPermissions: ['alpha.detail'],
}
const policy: ModuleReadPolicy = {
  moduleId: 'alpha',
  contributionId: 'overview',
  readId: 'detail',
  sectionId: 'details',
  strategy: 'organization-member',
  organization: declaration,
}

const honoFixture = () =>
  new Hono<ModuleOrganizationAuthorizationEnv>()
    .use('*', privateNoStore)
    .use('*', requireInstalledModuleEnabled(policy.moduleId, policy.sectionId))
    .use('*', async (context, next) => {
      context.set('session', session)
      context.set('organization', await boundary.organization(session.userId))
      await next()
    })
    .use('*', requireModuleOrganizationAuthorization(declaration))
    .get('/', (context) => context.json(context.var.moduleOrganizationAuthorization, 200))

beforeEach(() => {
  boundary.enabled.mockResolvedValue(true)
  boundary.organization.mockResolvedValue(organization)
  boundary.permissions.mockResolvedValue({ modules: ['alpha.view', 'alpha.detail'], services: [] })
  boundary.catalog.mockImplementation((value) => value)
  boundary.authority.mockResolvedValue({ director: true, organizationOwner: false })
  boundary.owned.mockResolvedValue(character)
  boundary.authorization.mockResolvedValue({ tokenVersion: 3, scopes: ['assets'] })
})

describe('shared module read policy', () => {
  it('uses the acquired slot for real policy rechecks without recursively acquiring a one-slot limiter', async () => {
    const admission = await admitModuleRead(policy, session)
    if (!admission.admitted) throw new Error('Expected admission')
    let active = false
    const runInSlot = vi.fn(async (read) => read(slot))
    const slot: ReadAdmissionWork = { run: runInSlot }
    const work: ReadAdmissionWork = {
      run: async (read) => {
        if (active) throw new Error('Recursive work acquisition')
        active = true
        try {
          return await read(slot)
        } finally {
          active = false
        }
      },
    }
    const load = vi.fn(async () => ({ private: 'current-data' }))
    const guard = createModuleReadGuard(admission.binding, async () => session, work)
    const capability = guardReadCapabilities({ load }, guard, work)
    await expect(capability.load()).resolves.toEqual({ private: 'current-data' })
    expect(load).toHaveBeenCalledOnce()
    expect(runInSlot).toHaveBeenCalled()
    expect(active).toBe(false)
  })
  it('pins the current organization and produces the same Hono admission context', async () => {
    const admission = await admitModuleRead(policy, session)
    if (!admission.admitted) throw new Error('Expected admission')
    const response = await honoFixture().request('/')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(admission.binding.organization)
    expect(admission.binding.organization?.organizationVersion).toBe(7)
    expect(boundary.permissions).toHaveBeenCalledWith('user-a', expect.any(Date), 7)
    expect(
      Object.isFrozen(admission.binding.policy.organization?.additionalRequiredPermissions),
    ).toBe(true)
    expect(Object.isFrozen(admission.binding.organization)).toBe(true)
  })

  it.each([
    'module',
    'section',
    'block',
    'compliance',
    'audience',
    'permission',
    'catalog',
    'context',
  ] as const)('preserves Hono denial and private headers for %s', async (change) => {
    if (change === 'module' || change === 'section') boundary.enabled.mockResolvedValue(false)
    if (change === 'block')
      boundary.organization.mockResolvedValue({ ...organization, blocked: true })
    if (change === 'compliance')
      boundary.organization.mockResolvedValue({
        ...organization,
        state: 'suspended',
        accessValidUntil: null,
      })
    if (change === 'audience')
      boundary.authority.mockResolvedValue({ director: false, organizationOwner: false })
    if (change === 'permission')
      boundary.permissions.mockResolvedValue({ modules: ['alpha.view'], services: [] })
    if (change === 'catalog') boundary.catalog.mockReturnValue(undefined)
    if (change === 'context') boundary.organization.mockResolvedValue(null)
    const admission = await admitModuleRead(policy, session)
    if (admission.admitted) throw new Error('Expected denial')
    const response = await honoFixture().request('/')
    expect(response.status).toBe(admission.status)
    expect(await response.json()).toEqual(admission.body)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toContain('Cookie')
    const disabled = change === 'module' || change === 'section'
    expect(boundary.organization).toHaveBeenCalledTimes(disabled ? 0 : 2)
    expect(boundary.permissions).toHaveBeenCalledTimes(change === 'permission' ? 2 : 0)
  })

  it('keeps anonymous public and core owned strategies independent of organization authority', async () => {
    const publicAdmission = await admitModuleRead(
      { ...policy, strategy: 'public', organization: undefined },
      null,
    )
    expect(publicAdmission).toMatchObject({
      admitted: true,
      binding: { userId: null, organization: null },
    })
    const owned = await admitModuleRead(
      { ...policy, strategy: 'owned-character', organization: undefined, requiredScope: 'assets' },
      session,
      character.characterId,
    )
    expect(owned).toMatchObject({
      admitted: true,
      binding: { owned: { authorizationRevision: 3 }, organization: null },
    })
    expect(boundary.organization).not.toHaveBeenCalled()
    expect(boundary.permissions).not.toHaveBeenCalled()
  })

  it.each([
    'version',
    'permission',
    'block',
    'compliance',
    'audience',
    'module',
    'section',
    'owner',
    'scope',
    'transfer',
    'lifecycle',
    'revision',
  ] as const)(
    'cannot reuse or release a delayed private capability after a %s change',
    async (change) => {
      const admission = await admitModuleRead(
        { ...policy, strategy: 'owned-character', requiredScope: 'assets' },
        session,
        character.characterId,
      )
      if (!admission.admitted) throw new Error('Expected admission')
      let currentSession = session
      const mutate = () => {
        if (change === 'version')
          boundary.organization.mockResolvedValue({ ...organization, organizationVersion: 8 })
        if (change === 'permission')
          boundary.permissions.mockResolvedValue({ modules: [], services: [] })
        if (change === 'block')
          boundary.organization.mockResolvedValue({ ...organization, blocked: true })
        if (change === 'compliance')
          boundary.organization.mockResolvedValue({
            ...organization,
            state: 'suspended',
            accessValidUntil: null,
          })
        if (change === 'audience')
          boundary.authority.mockResolvedValue({ director: false, organizationOwner: false })
        if (change === 'module' || change === 'section') boundary.enabled.mockResolvedValue(false)
        if (change === 'owner') currentSession = { ...session, userId: 'other' }
        if (change === 'scope')
          boundary.authorization.mockResolvedValue({ tokenVersion: 3, scopes: [] })
        if (change === 'transfer') boundary.owned.mockResolvedValue(null)
        if (change === 'lifecycle')
          boundary.owned.mockResolvedValue({ ...character, subjectLifecycleId: 'new' })
        if (change === 'revision')
          boundary.authorization.mockResolvedValue({ tokenVersion: 4, scopes: ['assets'] })
      }
      const load = vi.fn(async () => {
        mutate()
        return { private: 'old-data' }
      })
      const guard = createModuleReadGuard(admission.binding, async () => currentSession)
      const capabilities = guardReadCapabilities({ load }, guard)
      await expect(capabilities.load()).rejects.toBeInstanceOf(ReadAdmissionError)
      await expect(capabilities.load()).rejects.toBeInstanceOf(ReadAdmissionError)
      expect(load).toHaveBeenCalledOnce()
      expect(Object.isFrozen(capabilities)).toBe(true)
    },
  )

  it('does not broaden a captured declaration when its original permission array changes', async () => {
    const permissions = ['alpha.detail']
    const admission = await admitModuleRead(
      { ...policy, organization: { ...declaration, additionalRequiredPermissions: permissions } },
      session,
    )
    if (!admission.admitted) throw new Error('Expected admission')
    permissions.splice(0)
    boundary.permissions.mockResolvedValue({ modules: ['alpha.view'], services: [] })
    await expect(
      createModuleReadGuard(admission.binding, async () => session).assertCurrent(),
    ).rejects.toBeInstanceOf(ReadAdmissionError)
  })
})
