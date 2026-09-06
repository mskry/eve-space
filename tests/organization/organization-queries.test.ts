import { useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  organizationContextQuery,
  organizationRolesQuery,
  organizationRosterCoverageQuery,
  type OrganizationContext,
  type OrganizationRoles,
  type OrganizationRosterCoverage,
} from '../../app/queries/organization'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')

describe('organization queries', () => {
  it('loads the private authority context', async () => {
    const response = {
      organization: {
        organizationType: 'corporation',
        organizationId: 98_000_001,
        organizationName: 'Example Corporation',
        organizationTicker: 'EX',
        organizationVersion: 1,
      },
      isOrganizationOwner: true,
      isBlocked: false,
      capabilities: { viewRosterCoverage: true },
      claimAvailable: false,
      ownerStatus: 'fresh',
      reviewDeadline: null,
      authorityCharacter: null,
    } satisfies OrganizationContext
    queryServer.use(
      http.get('http://localhost/api/organization/context', () => HttpResponse.json(response)),
    )
    const Root = defineComponent({
      setup() {
        const context = useQuery(organizationContextQuery(apiClient))
        return () => h('span', context.data.value?.organization.organizationName ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('Example Corporation')
    wrapper.unmount()
  })

  it('loads the owner-only role list', async () => {
    const response = {
      grants: [
        {
          grantId: '35acd527-9539-44ad-aacf-9f8e45232267',
          userId: '98a782d2-e042-47d7-9659-03b218121a1a',
          role: 'director',
          reason: 'Leadership duty.',
          grantedByUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
          grantedAt: '2026-08-31T12:00:00.000Z',
          mainCharacterId: 1_404_328_063,
          mainCharacterName: 'Director',
        },
      ],
    } satisfies OrganizationRoles
    queryServer.use(
      http.get('http://localhost/api/organization/roles', () => HttpResponse.json(response)),
    )
    const Root = defineComponent({
      setup() {
        const roles = useQuery(organizationRolesQuery(apiClient))
        return () => h('span', roles.data.value?.grants[0]?.mainCharacterName ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('Director')
    wrapper.unmount()
  })

  it('loads HR roster coverage through the private API query', async () => {
    const response = {
      managedCorporations: {
        status: 'current',
        validatedAt: '2026-09-01T10:00:00.000Z',
        attemptedAt: '2026-09-01T10:00:00.000Z',
        lastFailureClass: null,
      },
      corporations: [
        {
          organizationVersion: 1,
          corporationId: 98_000_001,
          managedLastObservedAt: '2026-09-01T10:00:00.000Z',
          source: {
            sourceId: 'd33bc7a7-d258-4057-bd86-b50a546d0680',
            characterId: 1_404_328_063,
          },
          status: 'current',
          validatedAt: '2026-09-01T10:00:00.000Z',
          attemptedAt: '2026-09-01T10:00:00.000Z',
          lastFailureClass: null,
          unregisteredCharacters: [
            { characterId: 90_000_001, observedAt: '2026-09-01T10:00:00.000Z' },
          ],
        },
      ],
    } satisfies OrganizationRosterCoverage
    queryServer.use(
      http.get('http://localhost/api/organization/roster-coverage', () =>
        HttpResponse.json(response),
      ),
    )
    const Root = defineComponent({
      setup() {
        const coverage = useQuery(organizationRosterCoverageQuery(apiClient))
        return () => h('span', coverage.data.value?.corporations[0]?.unregisteredCharacters.length)
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('1')
    wrapper.unmount()
  })
})
