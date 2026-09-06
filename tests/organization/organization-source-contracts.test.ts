import { describe, expect, it } from 'vitest'
import { readWorkspaceFile } from '../support/read-workspace-file'

describe('organization frontend source contracts', () => {
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
})
