import { describe, expect, it } from 'vitest'
import { readWorkspaceFile as source } from '../support/read-workspace-file'

describe('corporation record route ownership', () => {
  const parent = source('app/pages/corporation/[corporationId].vue')
  const overview = source('app/pages/corporation/[corporationId]/index.vue')
  const allianceHistory = source('app/pages/corporation/[corporationId]/alliance-history.vue')

  it('keeps the detail query and persistent section shell in the parent', () => {
    expect(parent).toContain('corporationQuery({')
    expect(parent).toContain('enabled: import.meta.client')
    expect(parent).toContain('<RecordSectionNavigation')
    expect(parent).toContain('<NuxtPage />')
    expect(parent).toContain('to: `${overviewPath}/alliance-history`')
    expect(parent).toContain("corporation.value?.type !== 'player_owned'")
  })

  it('keeps overview presentation free of alliance-history requests and local tabs', () => {
    expect(overview).toContain('useCorporationRecord()')
    expect(overview).not.toContain('corporationAllianceHistoryQuery')
    expect(overview).not.toContain('activeTab')
    expect(overview).not.toContain('<button')
  })

  it('loads alliance history only from its routed child and preserves cached data', () => {
    expect(allianceHistory).toContain('corporationAllianceHistoryQuery({')
    expect(allianceHistory).toContain('import.meta.client &&')
    expect(allianceHistory).toContain("corporation.value?.type === 'player_owned'")
    expect(allianceHistory).toContain("value?.type !== 'npc_owned'")
    expect(allianceHistory).toContain("if (historyQuery.data.value) return 'idle'")
    expect(allianceHistory).toContain('historyQuery.refetch()')
    expect(allianceHistory).toContain('title="No alliance history"')
  })
})
