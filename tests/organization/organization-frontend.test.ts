import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  organizationContextQuery,
  organizationRolesQuery,
  organizationRosterCoverageQuery,
} from '../../app/queries/organization'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const readWorkspaceFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('organization authority frontend', () => {
  it('keeps deployment administration separate and identifies the EVE authority character', () => {
    const component = readWorkspaceFile('app/components/settings/SettingsIntegrations.vue')

    expect(component).toContain('Separate security boundary')
    expect(component).toContain('It does not grant organization')
    expect(component).toContain('Authority supplied by')
    expect(component).toContain('claim-organization-owner')
    expect(component).toContain('authorityContext?.isOrganizationOwner')
  })

  it('keeps protected organization reads client-gated', () => {
    const composable = readWorkspaceFile('app/composables/useOrganizationAuthority.ts')

    expect(composable).toContain('import.meta.client && authSession.value.authenticated')
    expect(composable).toContain('contextQuery.data.value?.isOrganizationOwner === true')
    expect(composable).toContain('rolesQuery.error.value')
  })

  it('presents per-corporation source, freshness, and unregistered observations', () => {
    const component = readWorkspaceFile('app/components/settings/SettingsRosterCoverage.vue')
    const composable = readWorkspaceFile('app/composables/useOrganizationRosterCoverage.ts')

    expect(component).toContain('Coverage compares observed corporation rosters')
    expect(component).toContain('corporation.source?.characterId')
    expect(component).toContain('corporation.unregisteredCharacters')
    expect(composable).toContain('import.meta.client')
    expect(composable).toContain('capabilities.viewRosterCoverage === true')
  })

  it('clears the revocation reason whenever the form opens or closes', () => {
    const component = readWorkspaceFile('app/components/settings/SettingsIntegrations.vue')

    expect(component).toContain('@click="openRevocation(grant.grantId)"')
    expect(component).toContain('@click="closeRevocation"')
    expect(component.match(/revokeReason\.value = ''/g)).toHaveLength(2)
  })

  it('loads the private authority context and owner-only role list', async () => {
    queryServer.use(
      http.get('http://localhost/api/organization/context', () =>
        HttpResponse.json({
          organization: {
            organizationType: 'corporation',
            organizationId: 98_000_001,
            organizationName: 'Example Corporation',
            organizationTicker: 'EX',
            organizationVersion: 1,
          },
          isOrganizationOwner: true,
          claimAvailable: false,
          ownerStatus: 'fresh',
          reviewDeadline: null,
          authorityCharacter: null,
        }),
      ),
      http.get('http://localhost/api/organization/roles', () =>
        HttpResponse.json({
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
        }),
      ),
    )
    const apiClient = createApiClient('http://localhost')
    const Root = defineComponent({
      setup() {
        const context = useQuery(organizationContextQuery(apiClient))
        const roles = useQuery(organizationRolesQuery(apiClient))
        return () =>
          h('span', [
            context.data.value?.organization.organizationName ?? 'loading',
            roles.data.value?.grants[0]?.mainCharacterName ?? 'loading',
          ])
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('Example CorporationDirector')
    wrapper.unmount()
  })

  it('loads HR roster coverage through the private API query', async () => {
    queryServer.use(
      http.get('http://localhost/api/organization/roster-coverage', () =>
        HttpResponse.json({
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
        }),
      ),
    )
    const apiClient = createApiClient('http://localhost')
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
