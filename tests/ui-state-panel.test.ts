import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readWorkspaceFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('state panels', () => {
  it('exposes reusable state content and action slots', () => {
    const component = readWorkspaceFile('layers/ui/app/components/ui/UiStatePanel.vue')
    const css = readWorkspaceFile('layers/ui/app/assets/css/components.css')

    expect(component).toContain("tone?: 'default' | 'error'")
    expect(component).toContain('class="ui-state-panel"')
    expect(component).toContain('<slot name="icon" />')
    expect(component).toContain('<slot name="action" />')
    expect(css).toContain('.ui-state-panel--compact {')
    expect(css).toContain('.ui-state-panel--error {')
  })

  it('centralizes character scope authorization presentation', () => {
    const component = readWorkspaceFile('app/components/character/AuthorizationRequired.vue')
    const mail = readWorkspaceFile('app/pages/characters/[characterId]/mail.vue')
    const skills = readWorkspaceFile('app/pages/characters/[characterId]/skills.vue')
    const wallet = readWorkspaceFile('app/pages/characters/[characterId]/wallet.vue')

    expect(component).toContain('class="character-authorization-state"')
    expect(component).toContain('<a v-if="authorizeUrl"')
    for (const page of [mail, skills, wallet]) {
      expect(page).toContain('<CharacterAuthorizationRequired')
      expect(page).not.toMatch(/mail-access-state|skills-access-state/)
    }
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
      'app/pages/characters/[characterId]/wallet.vue',
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
    const wallet = readWorkspaceFile('app/pages/characters/[characterId]/wallet.vue')

    for (const page of [roster, overview, skills, history, wallet]) {
      expect(page).toContain('role="alert"')
      expect(page).toContain('tone="error"')
      expect(page).toContain('<template #action>')
    }
    expect(wallet).toContain('transactionError?.authorizeUrl')
    expect(wallet).toContain('if (transactionsRequested.value)')
  })
})
