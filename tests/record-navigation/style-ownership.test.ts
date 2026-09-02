import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('record page style ownership', () => {
  it('keeps routed navigation styles with RecordSectionNavigation', () => {
    const component = source('app/components/RecordSectionNavigation.vue')
    const record = source('app/assets/css/features/character-record.css')
    const responsiveRecord = source('app/assets/css/responsive/record.css')

    expect(component).toContain('.record-section-navigation')
    expect(component).toContain('overflow-x: auto')
    expect(component).toContain('overflow-y: hidden')
    expect(component).toContain('focus-visible')
    expect(component).not.toContain('25%')
    expect(record).not.toContain('.character-tabs')
    expect(responsiveRecord).not.toContain('.character-tabs')
  })

  it('separates summary-card and Finance service styles', () => {
    const summary = source('app/components/AppSummaryCard.vue')
    const finance = source('app/pages/characters/[characterId]/finance.vue')
    const summaryCss = source('app/assets/css/features/character-summary.css')
    const financeCss = source('app/assets/css/features/finance.css')

    expect(summary).toContain('features/character-summary.css')
    expect(summary).not.toContain('features/finance.css')
    expect(finance).toContain('features/finance.css')
    expect(finance).toContain('responsive/finance.css')
    expect(finance).not.toContain('features/skills.css')
    expect(summaryCss).toContain('.character-summary-card')
    expect(summaryCss).not.toContain('.finance-ledger')
    expect(financeCss).toContain('.finance-ledger')
    expect(financeCss).not.toContain('.character-summary-card')
  })

  it('separates reusable timelines from character-only history controls', () => {
    const timeline = source('app/components/SearchableHistoryTimeline.vue')
    const characterHistory = source('app/pages/characters/[characterId]/history.vue')
    const timelineCss = source('app/assets/css/features/history-timeline.css')
    const characterCss = source('app/assets/css/features/history.css')

    expect(timeline).toContain('features/history-timeline.css')
    expect(timeline).not.toContain("features/history.css');")
    expect(characterHistory).toContain('features/history.css')
    expect(timelineCss).toContain('.employment-timeline')
    expect(timelineCss).not.toContain('.history-npc-toggle')
    expect(characterCss).toContain('.history-npc-toggle')
    expect(characterCss).not.toContain('.employment-timeline')
  })

  it('keeps attribute and queue styles with the skills route', () => {
    const page = source('app/pages/characters/[characterId]/skills.vue')
    const skills = source('app/assets/css/features/skills.css')
    const record = source('app/assets/css/features/character-record.css')

    expect(page).toContain('features/skills.css')
    expect(skills).toContain('.skill-attribute-cells')
    expect(skills).toContain('.skill-queue-list')
    expect(record).not.toContain('.skill-attribute-cells')
  })

  it('removes unrelated route imports and obsolete feature selectors', () => {
    const shell = source('app/pages/characters/[characterId].vue')
    const roster = source('app/pages/characters/index.vue')
    const dossier = source('app/assets/css/features/record-dossier.css')
    const skills = source('app/assets/css/features/skills.css')

    expect(shell).not.toContain('pages/settings.css')
    expect(roster).not.toContain('pages/settings.css')
    expect(shell).toContain('features/character-access.css')
    expect(roster).toContain('features/character-access.css')
    expect(dossier).not.toContain('.wallet-panel')
    expect(skills).not.toContain('.skills-empty')
  })
})
