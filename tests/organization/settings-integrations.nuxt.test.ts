import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQueryCache } from '@pinia/colada'
import { flushPromises, RouterLinkStub } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import SettingsIntegrations from '../../app/components/settings/SettingsIntegrations.vue'
import { useAuthSession } from '../../app/composables/useAuthSession'
import type { OrganizationContext, OrganizationRoles } from '../../app/queries/organization'
import { refreshPrivateAuthorization } from '../../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { createApiClient } from '../../app/utils/api-client'
import { cacheAdmissionForOrganization } from '../support/cache-admission'
import { clearQueryCache } from '../support/clear-query-cache'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []
const grantRequests: unknown[] = []
const revokeRequests: unknown[] = []
const ownerReplacementRequests: unknown[] = []
const corporationReplacementRequests: unknown[] = []
let permissionReadCount = 0
let sessionAuthenticated = true
let context = ownerContext()
let rolesResponse = emptyRoles()
let grantFails = false
let revokeFails = false

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

beforeEach(() => {
  clearQueryCache()
  context = ownerContext()
  rolesResponse = emptyRoles()
  sessionAuthenticated = true
  grantFails = false
  revokeFails = false
  grantRequests.length = 0
  revokeRequests.length = 0
  ownerReplacementRequests.length = 0
  corporationReplacementRequests.length = 0
  permissionReadCount = 0
  installHandlers()
})

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  clearQueryCache()
  queryServer.resetHandlers()
  await flushPromises()
})

describe('SettingsIntegrations', () => {
  it('renders owner authority and submits trimmed role changes', async () => {
    const wrapper = await mountSettingsIntegrations()

    expect(wrapper.text()).toContain('Authority supplied by')
    expect(wrapper.text()).toContain('Authority Pilot')
    expect(wrapper.text()).toContain('Director')
    expect(wrapper.text()).toContain('Organization access')
    expect(wrapper.findAll('.integration-row')).toHaveLength(3)

    await wrapper.get('#role-user-id').setValue('  target-user  ')
    await wrapper.get('#organization-role').setValue('hr_auditor')
    await wrapper.get('#grant-reason').setValue('  Required for audits  ')
    await wrapper.get('.role-grant-form').trigger('submit')
    await flushPromises()

    expect(grantRequests).toEqual([
      { userId: 'target-user', role: 'hr_auditor', reason: 'Required for audits' },
    ])
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Organization role granted.')
    expect(wrapper.get('#role-user-id').element).toHaveProperty('value', '')

    await wrapper.get('.role-grant-row > button').trigger('click')
    await wrapper.get('.role-revoke-form textarea').setValue('  Access changed  ')
    await wrapper.get('.role-revoke-form').trigger('submit')
    await flushPromises()

    expect(revokeRequests).toEqual([{ reason: 'Access changed' }])
    expect(wrapper.find('.role-revoke-form').exists()).toBe(false)
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Organization role revoked.')
  })

  it.each([
    ['anonymous', false, ownerContext()],
    ['non-owner', true, { ...ownerContext(), isOrganizationOwner: false }],
    ['blocked owner', true, { ...ownerContext(), isBlocked: true }],
    ['noncompliant owner', true, { ...ownerContext(), memberAccess: false }],
  ])(
    'does not render or request owner access for %s context',
    async (_name, authenticated, nextContext) => {
      sessionAuthenticated = authenticated
      context = nextContext
      const wrapper = await mountSettingsIntegrations()

      expect(wrapper.text()).not.toContain('Organization access')
      expect(permissionReadCount).toBe(0)
    },
  )

  it('selects the main character when an owner claim is available', async () => {
    context = {
      ...ownerContext(),
      authorityCharacter: null,
      claimAvailable: true,
      isOrganizationOwner: false,
    }
    const wrapper = await mountSettingsIntegrations()

    expect(wrapper.get('#authority-character').element).toHaveProperty('value', '1404328063')
    expect(wrapper.get('.authority-claim-form button').attributes('disabled')).toBeUndefined()
  })

  it('offers any attached character when an existing owner source is invalid', async () => {
    context = {
      ...ownerContext(),
      isOrganizationOwner: false,
      claimAvailable: true,
      ownerStatus: 'invalid',
      ownerFailureClass: 'strict:not-director',
      freshUntil: '2026-09-01T11:00:00.000Z',
    }
    const wrapper = await mountSettingsIntegrations()

    await vi.waitFor(() =>
      expect(wrapper.get('#authority-recovery-character').element).toHaveProperty(
        'value',
        '1404328063',
      ),
    )
    expect(wrapper.get('.authority-evidence-card .ui-action-primary').text()).toBe(
      'REVERIFY OR REPLACE SOURCE',
    )
  })

  it('keeps action feedback empty when role changes fail', async () => {
    grantFails = true
    revokeFails = true
    const wrapper = await mountSettingsIntegrations()

    await wrapper.get('#role-user-id').setValue('target-user')
    await wrapper.get('#grant-reason').setValue('Required for audits')
    await wrapper.get('.role-grant-form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[aria-live="polite"]').text()).toBe('')
    expect(wrapper.get('[role="alert"]').text()).toContain('Grant failed.')

    await wrapper.get('.role-grant-row > button').trigger('click')
    await wrapper.get('.role-revoke-form textarea').setValue('Access changed')
    await wrapper.get('.role-revoke-form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[aria-live="polite"]').text()).toBe('')
    expect(wrapper.find('.role-revoke-form').exists()).toBe(true)
  })

  it('clears role forms on same-route organization invalidation', async () => {
    const wrapper = await mountSettingsIntegrations()
    await wrapper.get('#role-user-id').setValue('private-user')
    await wrapper.get('#organization-role').setValue('director')
    await wrapper.get('#grant-reason').setValue('Private grant reason')
    await wrapper.get('.role-grant-row > button').trigger('click')
    await wrapper.get('.role-revoke-form textarea').setValue('Private revocation reason')

    await refreshPrivateAuthorization(useQueryCache(), { kind: 'organization' })
    await vi.waitFor(() => expect(wrapper.find('#role-user-id').exists()).toBe(true))

    expect(wrapper.get('#role-user-id').element).toHaveProperty('value', '')
    expect(wrapper.get('#organization-role').element).toHaveProperty('value', 'hr_auditor')
    expect(wrapper.get('#grant-reason').element).toHaveProperty('value', '')
    expect(wrapper.find('.role-revoke-form').exists()).toBe(false)
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('')
  })

  it('renders authority provenance and submits explicit source replacements', async () => {
    const wrapper = await mountSettingsIntegrations(authorityRoles())

    expect(wrapper.text()).toContain('DESIGNATED OWNER')
    expect(wrapper.text()).toContain('DERIVED DIRECTOR')
    expect(wrapper.text()).toContain('CORPORATION 98000001')
    expect(wrapper.text()).toContain('ESI unavailable')

    await wrapper.get('.authority-source-row button').trigger('click')
    await wrapper.get('#owner-replacement-reason').setValue(' Restore verified authority ')
    await wrapper.get('.authority-source-remediation').trigger('submit')
    await flushPromises()

    expect(ownerReplacementRequests).toEqual([
      { characterId: 1_404_328_063, reason: 'Restore verified authority' },
    ])

    const corporationButton = wrapper.findAll('.authority-source-row button').at(-1)!
    await corporationButton.trigger('click')
    await wrapper.get('#corporation-replacement-character').setValue('1404328063')
    await wrapper.findAll('.authority-source-remediation').at(-1)!.trigger('submit')
    await flushPromises()

    expect(corporationReplacementRequests).toEqual([
      { corporationId: 98_000_001, characterId: 1_404_328_063 },
    ])
  })
})

async function mountSettingsIntegrations(roles: OrganizationRoles = emptyRoles()) {
  rolesResponse = roles
  const Host = defineComponent({
    async setup() {
      const queryCache = useQueryCache()
      await useAuthSession(createApiClient('http://localhost:8788')).initializeAuth(true)
      queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationContext(), context)
      queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationRoles(), roles)
      return () => h(SettingsIntegrations)
    },
  })
  const wrapper = await mountSuspended(Host, {
    global: { stubs: { NuxtLink: RouterLinkStub } },
    route: false,
  })
  mountedWrappers.push(wrapper)
  if (sessionAuthenticated) {
    await vi.waitUntil(() => wrapper.text().includes('Example Corporation'))
    await vi.waitUntil(() => wrapper.text().includes('Authority Pilot'))
  }
  return wrapper
}

function installHandlers() {
  queryServer.use(
    http.get('http://localhost:8788/auth/config', () =>
      HttpResponse.json({
        configured: true,
        loginUrl: '/auth/eve/login',
        attachUrl: '/auth/eve/attach',
      }),
    ),
    http.get('http://localhost:8788/auth/session', () =>
      HttpResponse.json(
        sessionAuthenticated
          ? {
              authenticated: true,
              account: {
                userId: 'owner-user',
                mainCharacter: { characterId: 1_404_328_063, name: 'Authority Pilot' },
              },
            }
          : { authenticated: false },
      ),
    ),
    http.get('http://localhost:8788/api/me/cache-admission', () =>
      HttpResponse.json(cacheAdmissionForOrganization('owner-user', 1_404_328_063)),
    ),
    http.get('http://localhost:8788/api/admin/setup', () =>
      HttpResponse.json({ required: false, available: true }),
    ),
    http.get('http://localhost:8788/api/organization/context', () => HttpResponse.json(context)),
    http.get('http://localhost:8788/api/organization/roles', () =>
      HttpResponse.json(rolesResponse satisfies OrganizationRoles),
    ),
    http.get('http://localhost:8788/api/organization/permission-catalog', () => {
      permissionReadCount += 1
      return HttpResponse.json({ permissions: [], profiles: [] })
    }),
    http.get('http://localhost:8788/api/organization/permission-bundles', () => {
      permissionReadCount += 1
      return HttpResponse.json({ bundles: [] })
    }),
    http.post('http://localhost:8788/api/organization/roles', async ({ request }) => {
      grantRequests.push(await request.json())
      if (grantFails) {
        return HttpResponse.json(
          { code: 'INVALID_ROLE', message: 'Grant failed.' },
          { status: 400 },
        )
      }
      return HttpResponse.json({ grant: roleGrant() }, { status: 201 })
    }),
    http.post(
      'http://localhost:8788/api/organization/roles/:grantId/revoke',
      async ({ request }) => {
        revokeRequests.push(await request.json())
        if (revokeFails) {
          return HttpResponse.json(
            { code: 'INVALID_REVOCATION', message: 'Revocation failed.' },
            { status: 400 },
          )
        }
        return HttpResponse.json({ grant: roleGrant() })
      },
    ),
    http.put('http://localhost:8788/api/organization/owner-source', async ({ request }) => {
      ownerReplacementRequests.push(await request.json())
      return HttpResponse.json({ source: authorityRoles().ownerSources[0] })
    }),
    http.put(
      'http://localhost:8788/api/organization/corporations/:corporationId/source',
      async ({ params, request }) => {
        const body = (await request.json()) as { characterId: number }
        corporationReplacementRequests.push({
          corporationId: Number(params.corporationId),
          characterId: body.characterId,
        })
        return HttpResponse.json({ source: authorityRoles().corporationSources[0] })
      },
    ),
    http.get('http://localhost:8788/api/me/characters', () => {
      return HttpResponse.json({
        characters: [
          {
            characterId: 1_404_328_063,
            name: 'Authority Pilot',
            corporationId: 98_000_001,
            allianceId: null,
            isMain: true,
            birthday: '2020-01-01T00:00:00.000Z',
            securityStatus: 1.2,
            raceFactionId: 500_001,
            location: {
              solarSystemId: 30_000_142,
              solarSystemName: 'Jita',
              locationType: 'space',
            },
            ship: { typeId: 670, typeName: 'Capsule', groupId: 29, name: 'Authority' },
            walletBalance: 1_000,
            totalSp: 5_000_000,
            corporation: { id: 98_000_001, name: 'Example Corporation' },
            alliance: null,
          },
        ],
      })
    }),
  )
}

function ownerContext(): OrganizationContext {
  return {
    organization: {
      organizationType: 'corporation',
      organizationId: 98_000_001,
      organizationName: 'Example Corporation',
      organizationTicker: 'EX',
      organizationVersion: 1,
    },
    isOrganizationOwner: true,
    isBlocked: false,
    memberAccess: true,
    capabilities: { reviewRegistration: true, viewRosterCoverage: true },
    claimAvailable: false,
    ownerStatus: 'fresh',
    ownerFailureClass: null,
    freshUntil: '2026-09-01T13:00:00.000Z',
    graceUntil: null,
    reviewDeadline: null,
    authorityCharacter: {
      characterId: 1_404_328_063,
      corporationId: 98_000_001,
      name: 'Authority Pilot',
      sourceType: 'designated-owner',
      observedAt: '2026-09-01T12:00:00.000Z',
      freshUntil: '2026-09-01T13:00:00.000Z',
      graceUntil: null,
      lastCheckedAt: '2026-09-01T12:00:00.000Z',
    },
  }
}

function emptyRoles(): OrganizationRoles {
  return {
    grants: [roleGrant()],
    ownerSources: [],
    derivedSources: [],
    corporationSources: [],
  }
}

function authorityRoles(): OrganizationRoles {
  const shared = {
    userId: 'owner-user',
    characterId: 1_404_328_063,
    characterName: 'Authority Pilot',
    sourceSubjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
    authorizationGeneration: 3,
    observedCorporationId: 98_000_001,
    observedAllianceId: null,
    requiredScope: 'esi-characters.read_corporation_roles.v1',
    roleEvidenceRevision: '2026-09-01T12:00:00.000Z',
    observedAt: '2026-09-01T12:00:00.000Z',
    freshUntil: '2026-09-01T13:00:00.000Z',
    graceUntil: '2026-09-01T14:00:00.000Z',
    failureClass: 'transient:esi-unavailable',
    invalidatedAt: null,
    invalidationOutcome: null,
  }
  return {
    grants: [roleGrant()],
    ownerSources: [
      {
        ...shared,
        sourceId: '98a782d2-e042-47d7-9659-03b218121a1a',
        grantId: '35acd527-9539-44ad-aacf-9f8e45232267',
        role: 'organization_owner',
        origin: 'designated-owner',
        authorityCorporationId: 98_000_001,
        status: 'degraded',
        grantRevokedAt: null,
        remediationAction: 'replace-or-reauthorize-owner-source',
      },
    ],
    derivedSources: [
      {
        ...shared,
        sourceId: '66503848-72b8-4fa3-8af5-de056001a37e',
        role: 'director',
        origin: 'eve-derived',
        authorityCorporationId: 98_000_001,
        status: 'degraded',
        remediationAction: null,
      },
    ],
    corporationSources: [
      {
        ...shared,
        sourceId: '72f03848-72b8-4fa3-8af5-de056001a37e',
        corporationId: 98_000_001,
        origin: 'designated-corporation',
        status: 'degraded',
        registeredAt: '2026-09-01T12:00:00.000Z',
        revokedAt: null,
        remediationAction: 'replace-corporation-source',
      },
    ],
  }
}

function roleGrant(): OrganizationRoles['grants'][number] {
  return {
    grantId: 'grant-1',
    userId: 'role-user',
    role: 'director',
    reason: 'Leadership duty.',
    grantedByUserId: 'owner-user',
    grantedAt: '2026-08-31T12:00:00.000Z',
    mainCharacterId: 1_404_328_063,
    mainCharacterName: 'Director Pilot',
  }
}
