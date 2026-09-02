import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const routePages = [
  'app/pages/character/[characterId].vue',
  'app/pages/characters/[characterId].vue',
  'app/pages/characters/[characterId]/index.vue',
  'app/pages/characters/[characterId]/skills.vue',
  'app/pages/characters/[characterId]/history.vue',
  'app/pages/characters/[characterId]/finance.vue',
  'app/pages/characters/[characterId]/mail.vue',
  'app/pages/corporation/[corporationId].vue',
]

describe('record route page ID gates', () => {
  it('exposes the titled Finance route without retaining a Wallet route file', () => {
    const financePath = resolve(process.cwd(), 'app/pages/characters/[characterId]/finance.vue')
    const walletPath = resolve(process.cwd(), 'app/pages/characters/[characterId]/wallet.vue')
    const finance = readFileSync(financePath, 'utf8')

    expect(existsSync(financePath)).toBe(true)
    expect(existsSync(walletPath)).toBe(false)
    expect(finance).toContain("definePageMeta({ title: 'Character Finance'")
  })

  it.each(routePages)('%s parses the raw route parameter without coercion', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8')

    expect(source).toMatch(/parseRouteId\(route\.params\.(?:characterId|corporationId)\)/)
    expect(source).not.toMatch(/Number\(.*route\.params/)
    expect(source).not.toContain('Array.isArray(route.params')
  })

  it.each(['app/pages/character/[characterId].vue', 'app/pages/corporation/[corporationId].vue'])(
    '%s does not enable its request for an invalid ID',
    (path) => {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')

      expect(source).toMatch(/enabled: import\.meta\.client && \w+Id\.value !== undefined/)
    },
  )
})
