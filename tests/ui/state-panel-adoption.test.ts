import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readWorkspaceFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('state panel adoption', () => {
  it('ships the compact and error variant styles the panel selects', () => {
    const css = readWorkspaceFile('layers/ui/app/assets/css/components.css')

    expect(css).toContain('.ui-state-panel--compact {')
    expect(css).toContain('.ui-state-panel--error {')
  })

  it('centralizes character scope authorization presentation', () => {
    const component = readWorkspaceFile('app/components/character/AuthorizationRequired.vue')
    const mail = readWorkspaceFile('app/pages/characters/[characterId]/mail.vue')
    const skills = readWorkspaceFile('app/pages/characters/[characterId]/skills.vue')
    const finance = readWorkspaceFile('app/pages/characters/[characterId]/finance.vue')
    const financeState = readWorkspaceFile('app/components/finance/ServicePanel.vue')

    expect(component).toContain('class="character-authorization-state"')
    expect(component).toContain('<a v-if="authorizeUrl"')
    for (const page of [mail, skills]) {
      expect(page).toContain('<CharacterAuthorizationRequired')
      expect(page).not.toMatch(/mail-access-state|skills-access-state/)
    }
    expect(finance).toContain('<FinanceWorkspace')
    expect(financeState).toContain('state.authorizationAction')
    expect(financeState).not.toContain('CharacterAuthorizationRequired')
  })

  it('uses semantic state panels throughout migrated record pages', () => {
    const pages = [
      'app/pages/characters/[characterId].vue',
      'app/pages/characters/index.vue',
      'app/pages/character/[characterId].vue',
      'app/pages/corporation/[corporationId].vue',
      'app/pages/corporation/[corporationId]/alliance-history.vue',
      'app/pages/characters/[characterId]/index.vue',
      'app/pages/characters/[characterId]/skills.vue',
      'app/pages/characters/[characterId]/history.vue',
      'app/components/finance/ServicePanel.vue',
      'app/components/finance/Journal.vue',
      'app/components/finance/Transactions.vue',
      'app/components/finance/Orders.vue',
      'app/components/finance/Contracts.vue',
      'app/components/finance/ContractDrawer.vue',
    ].map(readWorkspaceFile)

    for (const page of pages) {
      expect(page).toContain('<UiStatePanel')
      expect(page).not.toMatch(/class="[^"]*app-state-panel/)
    }
    expect(pages.some((page) => page.includes('role="status"'))).toBe(true)
    expect(pages.every((page) => !page.includes('app-error-panel'))).toBe(true)
  })

  it('retains failure semantics and feature-owned actions', () => {
    const roster = readWorkspaceFile('app/pages/characters/index.vue')
    const overview = readWorkspaceFile('app/pages/characters/[characterId]/index.vue')
    const skills = readWorkspaceFile('app/pages/characters/[characterId]/skills.vue')
    const history = readWorkspaceFile('app/pages/characters/[characterId]/history.vue')
    const finance = readWorkspaceFile('app/pages/characters/[characterId]/finance.vue')
    const financeState = readWorkspaceFile('app/components/finance/ServicePanel.vue')

    for (const page of [roster, overview, skills, history]) {
      expect(page).toContain('role="alert"')
      expect(page).toContain('tone="error"')
      expect(page).toContain('<template #action>')
    }
    expect(financeState).toContain('role="alert"')
    expect(financeState).toContain('tone="error"')
    expect(financeState).toContain('#action')
    expect(financeState).toContain('state.authorizationAction.href')
    expect(finance).toContain('useCharacterFinanceServices')
    expect(finance).toContain('<FinanceContractDrawer')
  })

  it('keeps generic Finance presentation outside character and transport boundaries', () => {
    const financeComponents = [
      'app/components/finance/ServicePanel.vue',
      'app/components/finance/Summary.vue',
      'app/components/finance/Workspace.vue',
      'app/components/finance/Journal.vue',
      'app/components/finance/Transactions.vue',
      'app/components/finance/Orders.vue',
      'app/components/finance/Contracts.vue',
      'app/components/finance/ContractDrawer.vue',
    ].map(readWorkspaceFile)

    for (const component of financeComponents) {
      expect(component).not.toMatch(/queries\/finance|api-client|ApiQueryError|AppType/)
      expect(component).not.toContain('CharacterAuthorizationRequired')
    }
  })
})
