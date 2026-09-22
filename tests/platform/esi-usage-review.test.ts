// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { indexEsiCatalogEvidence } from '../../scripts/esi-usage-review/catalog-evidence'
import { classifyEsiUsage } from '../../scripts/esi-usage-review/findings'
import type { EsiUsageJudgment, EsiUsageState } from '../../scripts/esi-usage-review/judgments'
import { collectEsiUsageSites } from '../../scripts/esi-usage-review/sites'

const source = `
import { createCharacterEsiRead as registerRead } from '../esi-gateway/feature-execution.js'

const walletRead = registerRead({
  operation: 'wallet-balance',
  name: 'wallet-balance-core',
  descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
  cacheSchema: operationRegistry.GetCharactersCharacterIdWallet.responseSchema,
  encodeRequest: (input) => ({ path: { character_id: input.characterId } }),
  map: (response) => response.data,
})
`

const state = (): EsiUsageState => ({
  site: {
    id: 'api/src/characters/wallet.ts:4:wallet-balance-core',
    file: 'api/src/characters/wallet.ts',
    line: 4,
    factory: 'createCharacterEsiRead',
    operation: 'wallet-balance',
    name: 'wallet-balance-core',
    definition: 'createCharacterEsiRead({...})',
    context: 'wallet balance representation',
    previousDefinition: 'createCharacterEsiRead({...})',
  },
  catalog: {
    contract: "defineContract('wallet-balance', { identity: { fields: ['characterId'] } })",
    cacheKind: 'private',
    metadata: "'wallet-balance': { esiOperationId: 'GetCharactersCharacterIdWallet' }",
    previousContract: null,
    previousMetadata: null,
  },
})

const judgment = (overrides: Partial<EsiUsageJudgment> = {}): EsiUsageJudgment => ({
  operationFit: { choice: 'aligned', confidence: 0.95 },
  identityFit: { choice: 'complete', confidence: 0.95 },
  cacheFit: { choice: 'aligned', confidence: 0.95 },
  versionFit: { choice: 'not_applicable', confidence: 0.95 },
  ...overrides,
})

describe('ESI usage site discovery', () => {
  it('finds aliased registered representations and their previous definition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-esi-usage-'))
    const file = 'api/src/characters/wallet.ts'

    try {
      await mkdir(join(root, 'api/src/characters'), { recursive: true })
      await writeFile(join(root, file), source)
      const sites = await collectEsiUsageSites(
        pathToFileURL(`${root}/`),
        [file],
        new Map([[file, source.replace('response.data', 'Number(response.data)')]]),
      )

      expect(sites).toHaveLength(1)
      expect(sites[0]).toMatchObject({
        factory: 'createCharacterEsiRead',
        operation: 'wallet-balance',
        name: 'wallet-balance-core',
      })
      expect(sites[0].previousDefinition).toContain('Number(response.data)')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('ESI catalog evidence', () => {
  it('indexes matching contract and operation metadata snippets', () => {
    const evidence = indexEsiCatalogEvidence(
      `const catalog = { wallet: defineContract('wallet-balance', { cache: sharedPrivateCache() }) }`,
      `const metadata = defineOperationMetadata({ 'wallet-balance': { esiOperationId: 'GetCharactersCharacterIdWallet' } })`,
    ).get('wallet-balance')

    expect(evidence?.contract).toContain('sharedPrivateCache')
    expect(evidence?.cacheKind).toBe('private')
    expect(evidence?.metadata).toContain('GetCharactersCharacterIdWallet')
  })
})

describe('ESI usage finding classification', () => {
  it('passes a confident aligned representation', () => {
    expect(classifyEsiUsage(state(), judgment()).verdict).toBe('pass')
  })

  it.each([
    ['operationFit', { choice: 'mismatch', confidence: 0.96 }],
    ['identityFit', { choice: 'incomplete', confidence: 0.96 }],
    ['cacheFit', { choice: 'unsafe', confidence: 0.96 }],
    ['versionFit', { choice: 'bump_missing', confidence: 0.96 }],
  ] as const)('reports a confident %s defect', (signal, value) => {
    expect(classifyEsiUsage(state(), judgment({ [signal]: value })).verdict).toBe('report')
  })

  it('routes uncertain and questionable judgments to review', () => {
    const finding = classifyEsiUsage(
      state(),
      judgment({ cacheFit: { choice: 'questionable', confidence: 0.7 } }),
    )

    expect(finding.verdict).toBe('review')
    expect(finding.location).toContain('wallet-balance')
  })

  it('does not report cache concerns for an uncached contract', () => {
    const current = state()
    const uncached = { ...current, catalog: { ...current.catalog, cacheKind: 'none' as const } }

    expect(
      classifyEsiUsage(
        uncached,
        judgment({
          cacheFit: { choice: 'unsafe', confidence: 0.99 },
          versionFit: { choice: 'bump_missing', confidence: 0.99 },
        }),
      ).verdict,
    ).toBe('pass')
  })
})
