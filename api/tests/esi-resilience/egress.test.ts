import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

describe('ESI egress verification', () => {
  test('permits only the resilience transport and layer-owned cache or cooldown state', async () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url))
    await expect(
      execFileAsync('node', ['scripts/verify-esi-egress.mjs'], { cwd: root }),
    ).resolves.toEqual(expect.objectContaining({ stderr: '' }))
  })

  test('rejects registered character operations that bypass their read or mutation executor', async () => {
    const fixture = await createEgressFixture({
      'api/src/esi-resilience/catalog.ts': characterExecutorCatalog(),
      'api/src/mail/bypass.ts': `
        import { createMailClient } from '@evespace/esi-client/domains/mail'
        import { createEsiTransport } from '../../esi-resilience/transport.js'

        export const read = (layer, authority) => layer.executeCharacterMutation({
          operation: 'mail-headers',
          characterId: 1,
          load: () => createMailClient({
            fetch: createEsiTransport('mail-headers', authority.principal),
          }).withMetadata().listHeaders(1),
        })
        export const mutate = (layer, authority) => layer.getCharacter({
          operation: 'mail-send',
          inputs: { characterId: 1 },
          load: () => createMailClient({
            fetch: createEsiTransport('mail-send', authority.principal),
          }).withMetadata().send(1, { body: {} }),
        })
      `,
    })

    try {
      const stderr = await verifierFailure(fixture)
      expect(stderr).toContain(
        'api/src/mail/bypass.ts: ESI operation mail-headers bypasses getCharacter executor/cache policy',
      )
      expect(stderr).toContain(
        'api/src/mail/bypass.ts: ESI operation mail-send bypasses executeCharacterMutation executor/cache policy',
      )
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  test('accepts registered character operations nested in their required executors', async () => {
    const fixture = await createEgressFixture({
      'api/src/esi-resilience/catalog.ts': characterExecutorCatalog(),
      'api/src/mail/valid.ts': `
        import { createMailClient } from '@evespace/esi-client/domains/mail'
        import { createEsiTransport } from '../../esi-resilience/transport.js'

        export const read = (layer) => layer.getCharacter({
          operation: 'mail-headers',
          inputs: { characterId: 1 },
          load: (authority) => createMailClient({
            fetch: createEsiTransport('mail-headers', authority.principal),
          }).withMetadata().listHeaders(1),
        })
        export const mutate = (layer) => layer.executeCharacterMutation({
          operation: 'mail-send',
          characterId: 1,
          load: (authority) => createMailClient({
            fetch: createEsiTransport('mail-send', authority.principal),
          }).withMetadata().send(1, { body: {} }),
        })
      `,
    })

    try {
      await expect(runVerifier(fixture)).resolves.toEqual(expect.objectContaining({ stderr: '' }))
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  test('checks every installed feature server source against shared ESI egress policy', async () => {
    const fixture = await createEgressFixture({
      'features/alpha/server/src/unregistered.ts':
        "import { createStatusClient } from '@evespace/esi-client/domains/status'\nexport const resource = { operation: 'missing-operation', createStatusClient }",
      'features/alpha/server/src/direct.tsx':
        "export const load = () => fetch('https://esi.evetech.net/latest/status')",
      'features/alpha/server/src/transport.mts':
        'export function createEsiTransport() { return async () => new Response() }',
      'features/alpha/server/src/cache.js': 'export const esiCache = new Map()',
      'features/alpha/server/src/cooldown.mjs': 'export const esiCooldown = new Map()',
      'features/alpha/server/src/sdk.ts':
        "import { createStatusClient } from '@evespace/esi-client/domains/status'\nexport const client = createStatusClient",
      'features/alpha/server/src/bypass.ts':
        "import { createStatusClient } from '@evespace/esi-client/domains/status'\nexport const resource = { operation: 'alpha-operation', load: () => createStatusClient({}) }",
      'features/alpha/server/src/no-options.ts':
        "import { createStatusClient } from '@evespace/esi-client/domains/status'\nexport const resource = { operation: 'alpha-operation', load: () => createStatusClient() }",
      'features/alpha/server/src/aliased.ts': `
        import { createStatusClient as importedFactory } from '@evespace/esi-client/domains/status'
        const localFactory = importedFactory
        export const resource = { operation: 'alpha-operation', load: () => localFactory() }
      `,
      'features/alpha/server/src/transitive-alias.ts': `
        import { createStatusClient as importedFactory } from '@evespace/esi-client/domains/status'
        const firstAlias = importedFactory
        const secondAlias = firstAlias
        export const resource = { operation: 'alpha-operation', load: () => secondAlias() }
      `,
      'features/alpha/server/src/namespaced.ts': `
        import * as statusSdk from '@evespace/esi-client/domains/status'
        export const resource = {
          operation: 'alpha-operation',
          load: () => statusSdk.createStatusClient(),
        }
      `,
      'features/alpha/server/src/destructured.ts': `
        import * as statusSdk from '@evespace/esi-client/domains/status'
        const { createStatusClient: localFactory } = statusSdk
        export const resource = { operation: 'alpha-operation', load: () => localFactory() }
      `,
      'features/alpha/server/src/raw-capabilities.ts': `
        import { definePlatformResourceOperation } from '@eve-space/platform-module-contract'
        const transport = fetch
        export const resource = definePlatformResourceOperation({
          operation: 'alpha-operation', request: () => ({}), map: ({ data }) => data,
          materialize: async () => transport,
        })
      `,
      'features/alpha/server/src/independent-identity.ts': `
        import { definePlatformResourceOperation } from '@eve-space/platform-module-contract'
        export const resource = definePlatformResourceOperation({
          operation: 'alpha-operation', identity: ({ characterId }) => String(characterId),
          request: () => ({}), map: ({ data }) => data, materialize: async () => {},
        })
      `,
    })

    try {
      const stderr = await verifierFailure(fixture)
      for (const fragment of [
        'features/alpha/server/src/unregistered.ts: unregistered ESI operation missing-operation',
        'feature server code performs direct fetch',
        'feature server code defines or imports a duplicate ESI transport',
        'feature server code defines module-local ESI cache or cooldown state',
        'ESI SDK usage is not associated with a registered operation',
        'feature server code imports the ESI SDK at runtime instead of using platform dispatch',
        'feature resource code accesses raw ESI authorization or transport',
        'feature resource code defines an independent ESI identity',
        'features/alpha/server/src/bypass.ts: feature server code constructs an ESI SDK client instead of platform dispatch',
        'features/alpha/server/src/no-options.ts: feature server code constructs an ESI SDK client instead of platform dispatch',
        'features/alpha/server/src/aliased.ts: feature server code constructs an ESI SDK client instead of platform dispatch',
        'features/alpha/server/src/transitive-alias.ts: feature server code constructs an ESI SDK client instead of platform dispatch',
        'features/alpha/server/src/namespaced.ts: feature server code constructs an ESI SDK client instead of platform dispatch',
        'features/alpha/server/src/destructured.ts: feature server code constructs an ESI SDK client instead of platform dispatch',
      ])
        expect(stderr).toContain(fragment)
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  test('accepts pure resource projections without module-owned SDK egress', async () => {
    const fixture = await createEgressFixture({
      'features/alpha/server/src/resource.ts': `
        import type { EsiResponseMetadata } from '@evespace/esi-client'
        import { definePlatformResourceOperation } from '@eve-space/platform-module-contract'

        export const resource = definePlatformResourceOperation({
          operation: 'alpha-operation',
          request: ({ characterId }) => ({ path: { character_id: characterId } }),
          map: ({ data }) => data,
          materialize: async () => {},
        })
        export type Metadata = EsiResponseMetadata
      `,
      'features/alpha/server/src/types.ts': `
        import { localValue } from '../local.js'
        import type { EsiResponseMetadata } from '@evespace/esi-client'
        export type Metadata = EsiResponseMetadata
        export { localValue }
      `,
    })

    try {
      await expect(runVerifier(fixture)).resolves.toEqual(expect.objectContaining({ stderr: '' }))
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })
})

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

function characterExecutorCatalog() {
  return `
    defineContract('mail-headers', {
      resourceRevision: { kind: 'character', namespace: 'mailbox' },
      cache: sharedPrivateCache(),
    })
    defineContract('mail-send', {
      resourceRevision: { kind: 'character', namespace: 'mailbox' },
      cache: { kind: 'none' },
    })
  `
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
