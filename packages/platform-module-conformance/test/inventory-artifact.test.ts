import { describe, expect, it } from 'vitest'
import { validateInventoryProviderArtifacts } from '../src/inventory-artifact.js'
import { platformModuleSourceIssues } from '../src/source-policy.js'
import {
  definePlatformInventoryProvider,
  type PlatformInventoryProviderDeclaration,
} from '@eve-space/platform-module-contract/inventory'

const provider: PlatformInventoryProviderDeclaration = {
  id: 'assets-inventory',
  exportName: 'inventoryProvider',
  scope: 'corporation',
  contractVersion: 1,
  sectionId: 'assets',
  requiredPermission: 'source.assets.read',
  maximumSubjects: 250,
  maximumPageSize: 100,
  persistenceOperations: [],
}
const inspect = (source: string) =>
  validateInventoryProviderArtifacts({ read: async () => source }, 'dist/provider.js', [provider])

describe('inventory package boundary', () => {
  it.each([
    'export const inventoryProvider = () => async () => null',
    'export function inventoryProvider() { return async () => null }',
    "import { definePlatformInventoryProvider as defineProvider } from '@eve-space/platform-module-contract/inventory'; export const inventoryProvider = defineProvider(() => async () => null)",
  ])('inspects callable factories without executing package code', async (source) => {
    await expect(inspect(`throw new Error('must not run'); ${source}`)).resolves.toBeUndefined()
  })

  it.each([
    'export const inventoryProvider = {}',
    'export const inventoryProvider = undefined',
    'export let inventoryProvider = () => null',
    'const definePlatformInventoryProvider = () => null; export const inventoryProvider = definePlatformInventoryProvider(() => null)',
    "import { definePlatformInventoryProvider } from '@eve-space/platform-module-contract/inventory'; export const inventoryProvider = definePlatformInventoryProvider({})",
    'const first = second; const second = first; export const inventoryProvider = first',
  ])('rejects invalid factory artifacts', async (source) => {
    await expect(inspect(source)).rejects.toThrow('static callable factory')
  })

  it('follows packaged re-exports and refuses missing or escaping factories', async () => {
    const files = new Map([
      ['dist/index.js', "export { inventoryProvider } from './provider.js'"],
      ['dist/provider.js', 'export const inventoryProvider = () => async () => null'],
    ])
    await expect(
      validateInventoryProviderArtifacts(
        { read: async (path) => files.get(path) },
        'dist/index.js',
        [provider],
      ),
    ).resolves.toBeUndefined()
    files.set('dist/provider.js', "export * from './index.js'")
    await expect(
      validateInventoryProviderArtifacts(
        { read: async (path) => files.get(path) },
        'dist/index.js',
        [provider],
      ),
    ).rejects.toThrow('cycle or limit')
    await expect(inspect("export * from '../../outside.js'")).rejects.toThrow('escapes package')
    await expect(inspect('export const unrelated = true')).rejects.toThrow(
      'Missing inventory provider',
    )
  })

  it('refuses a non-callable factory result at runtime', () => {
    // @ts-expect-error An untyped external package can still supply a malformed factory.
    const malformed = definePlatformInventoryProvider(() => ({ dispatch: true }))
    expect(() => malformed({ persistence: {}, signal: new AbortController().signal })).toThrow(
      'read function',
    )
  })

  it('permits the server contract while rejecting feature implementations and Nuxt imports', () => {
    const input = {
      moduleId: 'consumer',
      environment: 'server',
      scope: 'source',
      boundaryRoot: 'features/consumer/server',
      path: 'features/consumer/server/src/inventory.ts',
    } as const
    const dependencies = new Set(['@eve-space/platform-module-contract'])
    expect(
      platformModuleSourceIssues(
        {
          ...input,
          source:
            "import type { PlatformPersonalInventoryCapabilities } from '@eve-space/platform-module-contract/inventory'",
        },
        dependencies,
      ),
    ).toEqual([])
    expect(
      platformModuleSourceIssues(
        { ...input, source: "import { provider } from '@eve-space/member-audit-server'" },
        new Set(['@eve-space/member-audit-server']),
      ),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'IMPORT_NOT_ALLOWED' })]))
    expect(
      platformModuleSourceIssues(
        {
          ...input,
          environment: 'nuxt',
          source:
            "import type { PlatformInventoryProvider } from '@eve-space/platform-module-contract/inventory'",
        },
        dependencies,
      ),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'IMPORT_NOT_ALLOWED' })]))
  })
})
