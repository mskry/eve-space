import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQueryCache } from '@pinia/colada'
import { flushPromises, RouterLinkStub } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import SettingsIntegrations from '../../app/components/settings/SettingsIntegrations.vue'
import type { OrganizationContext, OrganizationRoles } from '../../app/queries/organization'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []
const grantRequests: unknown[] = []
const revokeRequests: unknown[] = []
let context = ownerContext()
let grantFails = false
let revokeFails = false

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

beforeEach(() => {
  context = ownerContext()
  grantFails = false
  revokeFails = false
  grantRequests.length = 0
  revokeRequests.length = 0
  installHandlers()
})

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  queryServer.resetHandlers()
  await flushPromises()
})

describe('SettingsIntegrations', () => {
  it('renders owner authority and submits trimmed role changes', async () => {
    const wrapper = await mountSettingsIntegrations()

    expect(wrapper.text()).toContain('Authority supplied by')
    expect(wrapper.text()).toContain('Authority Pilot')
    expect(wrapper.text()).toContain('Director')
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
})

async function mountSettingsIntegrations() {
  const Host = defineComponent({
    setup() {
      const queryCache = useQueryCache()
      queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationContext(), context)
      queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationRoles(), { grants: [roleGrant()] })
      return () => h(SettingsIntegrations)
    },
  })
  const wrapper = await mountSuspended(Host, {
    global: { stubs: { NuxtLink: RouterLinkStub } },
    route: false,
  })
  mountedWrappers.push(wrapper)
  await vi.waitFor(() => expect(wrapper.text()).toContain('Example Corporation'))
  await vi.waitFor(() => expect(wrapper.text()).toContain('Authority Pilot'))
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
      HttpResponse.json({
        authenticated: true,
        account: {
          userId: 'owner-user',
          mainCharacter: { characterId: 1_404_328_063, name: 'Authority Pilot' },
        },
      }),
    ),
    http.get('http://localhost:8788/api/admin/setup', () =>
      HttpResponse.json({ required: false, available: true }),
    ),
    http.get('http://localhost:8788/api/organization/context', () => HttpResponse.json(context)),
    http.get('http://localhost:8788/api/organization/roles', () =>
      HttpResponse.json({ grants: [roleGrant()] } satisfies OrganizationRoles),
    ),
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
            location: { solarSystemId: 30_000_142, solarSystemName: 'Jita' },
            ship: { typeId: 670, typeName: 'Capsule', name: 'Authority' },
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
    capabilities: { reviewRegistration: true, viewRosterCoverage: true },
    claimAvailable: false,
    ownerStatus: 'fresh',
    reviewDeadline: null,
    authorityCharacter: {
      characterId: 1_404_328_063,
      corporationId: 98_000_001,
      name: 'Authority Pilot',
      lastCheckedAt: '2026-09-01T12:00:00.000Z',
    },
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
