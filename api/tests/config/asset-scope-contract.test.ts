import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const assetScope = 'esi-assets.read_assets.v1'
const prohibitedStructureScope = 'esi-universe.read_structures.v1'
const envExample = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')
const compose = readFileSync(new URL('../../../compose.yml', import.meta.url), 'utf8')

describe('character asset startup scope contract', () => {
  test('keeps the example and both process defaults aligned without structure access', () => {
    const exampleScopes = envExample.match(/^EVE_SCOPES=(.+)$/m)?.[1]?.split(/\s+/) ?? []
    const composeScopes = [...compose.matchAll(/EVE_SCOPES: \$\{EVE_SCOPES:-([^}]+)}/g)].map(
      (match) => match[1]!.split(/\s+/),
    )

    expect(composeScopes).toHaveLength(2)
    expect(composeScopes[0]).toEqual(exampleScopes)
    expect(composeScopes[1]).toEqual(exampleScopes)
    expect(exampleScopes).toContain(assetScope)
    expect(exampleScopes).not.toContain(prohibitedStructureScope)
    expect(new Set(exampleScopes).size).toBe(exampleScopes.length)
  })
})
