import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

describe('ESI egress verification', () => {
  test('accepts the repository final-state execution boundary', async () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url))
    await expect(
      execFileAsync('node', ['scripts/verify-esi-egress.mjs'], { cwd: root }),
    ).resolves.toEqual(expect.objectContaining({ stderr: '' }))
  })

  test('rejects production feature access to executor-owned ESI capabilities', async () => {
    const fixture = await createEgressFixture({
      'api/src/characters/sdk.ts':
        "import { EsiClient } from '@evespace/esi-client'\nexport const client = new EsiClient({})",
      'api/src/characters/layer.ts':
        "import { esiExecutionLayer } from '../esi-resilience/layer.js'\nvoid esiExecutionLayer",
      'api/src/characters/transport.ts':
        "import { createEsiTransport } from '../esi-resilience/request-transport.js'\nvoid createEsiTransport",
      'api/src/characters/executor-reexport.ts':
        "export { esiExecutionLayer } from '../esi-resilience/layer.js'",
      'api/src/characters/sdk-reexport.ts': "export { EsiClient } from '@evespace/esi-client'",
      'api/src/characters/computed-import.ts':
        "const sdkPath = '@evespace/esi-client'\nexport const load = () => import(sdkPath)",
      'api/src/characters/sdk-template-import.ts':
        'export const load = () => import(`@evespace/esi-client`)',
      'api/src/characters/executor-template-import.ts':
        'export const load = () => import(`../esi-resilience/layer.js`)',
      'api/src/characters/credentials.ts': representationSource(
        'credentials',
        "{ accessToken: 'secret', principal: 'character-1' }",
      ),
      'api/src/characters/revalidation.ts': representationSource(
        'revalidation',
        "{ headers: { 'If-None-Match': 'etag' } }",
      ),
      'api/src/characters/duplicate-one.ts': representationSource('duplicate'),
      'api/src/characters/duplicate-two.ts': indirectRepresentationSource('duplicate'),
      'api/src/characters/repeated-registration.ts': repeatedRegistrationSource(),
      'api/src/characters/mutation.ts':
        'export const mutation = { allowGenericMutations: true, confirmMutation: true }',
      'api/src/characters/raw.ts':
        "export const load = () => fetch('https://esi.evetech.net/latest/status')",
    })

    try {
      const stderr = await verifierFailure(fixture)
      for (const fragment of [
        'generic ESI SDK client construction is reserved for shared executors',
        'runtime ESI SDK imports are reserved for the registered execution owner',
        'production code imports ESI resilience execution internals',
        'production code uses a dynamic import that cannot be verified',
        'feature ESI code supplies credentials or principals',
        'feature ESI code supplies conditional revalidation headers',
        'ESI representation duplicate duplicates its registration',
        'ESI representation repeated duplicates its registration',
        'generic mutation approval is reserved for the registered execution owner',
        'direct ESI fetch bypasses the shared transport',
      ])
        expect(stderr).toContain(fragment)
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  test('reserves SDK construction and generic mutation gates for the execution owner', async () => {
    const fixture = await createEgressFixture({
      'api/src/esi-resilience/layer.ts': `
        import { EsiClient } from '@evespace/esi-client'
        class Layer {
          #createTransport() { return fetch }
          execute() {
            return new EsiClient({
              fetch: this.#createTransport(),
              allowGenericMutations: true,
            }).callOperation('declared', {}, { confirmMutation: true })
          }
        }
      `,
    })

    try {
      await expect(runVerifier(fixture)).resolves.toEqual(expect.objectContaining({ stderr: '' }))
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  test('checks every installed feature server source against shared ESI policy', async () => {
    const fixture = await createEgressFixture({
      'features/alpha/server/src/unregistered.ts':
        "export const resource = { operation: 'missing-operation' }",
      'features/alpha/server/src/unregistered-shorthand.ts':
        "const operation = 'missing-shorthand-operation'\nexport const resource = { operation }",
      'features/alpha/server/src/sdk.ts':
        "import { createStatusClient } from '@evespace/esi-client/domains/status'\nexport const client = createStatusClient()",
      'features/alpha/server/src/sdk-reexport.ts':
        "export { createStatusClient } from '@evespace/esi-client/domains/status'",
      'features/alpha/server/src/computed-import.ts':
        "const sdkPath = '@evespace/esi-client/domains/status'\nexport const load = () => import(sdkPath)",
      'features/alpha/server/src/sdk-template-import.ts':
        'export const load = () => import(`@evespace/esi-client/domains/status`)',
      'features/alpha/server/src/direct.tsx':
        "export const load = () => fetch('https://esi.evetech.net/latest/status')",
      'features/alpha/server/src/transport.mts':
        'export function createEsiTransport() { return async () => new Response() }',
      'features/alpha/server/src/cache.js': 'export const esiCache = new Map()',
      'features/alpha/server/src/raw-capabilities.ts': `
        import { definePlatformResourceOperation } from '@eve-space/platform-module-contract'
        import { esiExecutionLayer } from '../../../../api/src/esi-resilience/layer.js'
        export const resource = definePlatformResourceOperation({
          operation: 'alpha-operation', request: () => ({
            accessToken: 'secret', principal: 'character-1',
            headers: { 'If-Modified-Since': 'yesterday' },
          }),
          map: ({ data }) => data, materialize: async () => esiExecutionLayer,
        })
        export const mutation = { confirmMutation: true }
      `,
    })

    try {
      const stderr = await verifierFailure(fixture)
      for (const fragment of [
        'unregistered ESI operation missing-operation',
        'unregistered ESI operation missing-shorthand-operation',
        'feature server code imports the ESI SDK at runtime instead of using platform dispatch',
        'feature server code constructs an ESI SDK client instead of platform dispatch',
        'feature server code uses a dynamic import that cannot be verified',
        'feature server code performs direct fetch instead of shared ESI egress',
        'feature server code defines or imports a duplicate ESI transport',
        'feature server code defines module-local ESI cache or cooldown state',
        'feature resource code accesses raw ESI authorization or transport',
        'feature server code supplies conditional ESI revalidation headers',
        'feature server code imports ESI resilience execution internals',
        'feature server code attempts generic ESI mutation execution',
      ])
        expect(stderr).toContain(fragment)
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  test('accepts pure declared feature projections and type-only SDK imports', async () => {
    const fixture = await createEgressFixture({
      'features/alpha/server/src/resource.ts': `
        import type { EsiResponseMetadata } from '@evespace/esi-client'
        export type { EsiResponse } from '@evespace/esi-client'
        import { definePlatformResourceOperation } from '@eve-space/platform-module-contract'
        export const resource = definePlatformResourceOperation({
          operation: 'alpha-operation', request: ({ characterId }) => ({
            path: { character_id: characterId },
          }),
          map: ({ data }) => data, materialize: async () => {},
        })
        export const verifierWordsAreData = 'confirmMutation If-None-Match accessToken'
        export type Metadata = EsiResponseMetadata
      `,
    })

    try {
      await expect(runVerifier(fixture)).resolves.toEqual(expect.objectContaining({ stderr: '' }))
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })
})

function representationSource(name: string, extra = '') {
  return `
    import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
    import { definePublicEsiRepresentation } from '../esi-resilience/representations.js'
    export const value = registerEsiRepresentation(definePublicEsiRepresentation({
      operation: 'status', name: '${name}', descriptor: {}, encodeRequest: () => (${extra || '{}'}),
      map: ({ data }) => data,
    }))
  `
}

function indirectRepresentationSource(value: string) {
  return `
    import { registerEsiRepresentation as register } from '../esi-resilience/representation-registry.js'
    import { definePublicEsiRepresentation as define } from '../esi-resilience/representations.js'
    const name = '${value}'
    const nameKey = 'na' + 'me'
    const options = {
      operation: 'status', [nameKey]: name, descriptor: {}, encodeRequest: () => ({}),
      map: ({ data }) => data,
    }
    const representation = define(options)
    export const registered = register(representation)
  `
}

function repeatedRegistrationSource() {
  return `
    import { registerEsiRepresentation as register } from '../esi-resilience/representation-registry.js'
    import { definePublicEsiRepresentation as define } from '../esi-resilience/representations.js'
    const representation = define({
      operation: 'status', name: 'repeated', descriptor: {}, encodeRequest: () => ({}),
      map: ({ data }) => data,
    })
    export const first = register(representation)
    export const second = register(representation)
  `
}

async function createEgressFixture(files: Readonly<Record<string, string>>) {
  const root = await mkdtemp(join(tmpdir(), 'eve-space-esi-egress-'))
  const required = {
    'features/installed-modules.json': JSON.stringify({ modules: ['alpha'] }),
    'api/src/esi-resilience/catalog.ts': "defineContract('status', {})",
    'api/src/generated/platform/installed-module-esi.ts': `
      export const installedModuleEsiOperationCatalog = {
        'alpha-operation': module0EsiOperation0,
      } as const
    `,
    ...files,
  }
  await Promise.all(
    Object.entries(required).map(async ([path, source]) => {
      const output = join(root, path)
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, source)
    }),
  )
  return root
}

function runVerifier(root: string) {
  const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
  return execFileAsync('node', ['scripts/verify-esi-egress.mjs', '--root', root], {
    cwd: repositoryRoot,
  })
}

async function verifierFailure(root: string) {
  try {
    await runVerifier(root)
    throw new Error('Expected ESI egress verification to fail')
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'stderr' in error &&
      typeof error.stderr === 'string'
    )
      return error.stderr
    throw error
  }
}
