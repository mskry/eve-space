import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlatformModuleManifest } from '@eve-space/platform-module-contract/manifest'

const extendInventoryManifest = (manifest: PlatformModuleManifest) => {
  Object.assign(manifest.release, { hostContractRange: '^1.2.0' })
  Object.assign(manifest, {
    sections: [
      { id: 'overview', kind: 'workspace', defaultEnabled: false },
      { id: 'assets', kind: 'sensitive-evidence', defaultEnabled: false, disclosureRevision: 1 },
    ],
    permissions: [
      ...manifest.permissions!,
      {
        key: 'fixture.assets.read',
        label: 'Assets',
        purpose: 'Review assets',
        audiences: ['hr', 'director'],
        sensitivity: 'sensitive',
        reviewAllowed: true,
      },
    ],
  })
  for (const contribution of [
    ...manifest.server.routes,
    ...manifest.server.activityProviders,
    ...manifest.nuxt.pages,
    ...manifest.nuxt.navigation,
  ])
    Object.assign(contribution, { sectionId: 'overview' })
  for (const route of manifest.server.routes)
    Object.assign(route, { target: 'caller', exposure: 'standard' })
  Object.assign(manifest.server, {
    inventoryConsumers: [
      {
        id: 'personal-inventory',
        scope: 'personal',
        contractVersion: 1,
        provider: 'core.character-assets',
        maximumSubjects: 20,
        maximumPageSize: 100,
      },
    ],
    inventoryProviders: [
      {
        id: 'assets-inventory',
        exportName: 'fixtureInventory',
        scope: 'corporation',
        contractVersion: 1,
        sectionId: 'assets',
        requiredPermission: 'fixture.assets.read',
        maximumSubjects: 250,
        maximumPageSize: 100,
        persistenceOperations: [{ operationId: 'read-fixture' }],
      },
    ],
  })
  const graphql = manifest.server.graphql![0]!
  Object.assign(graphql, {
    reads: [
      ...graphql.reads,
      {
        id: 'personal-inventory',
        field: 'FixtureRead.personalInventory',
        strategy: 'personal-inventory',
        inventoryConsumerId: 'personal-inventory',
        requiredScope: 'esi-assets.read_assets.v1',
        cost: 1,
        sourceCost: 20,
        persistenceOperations: [],
        coreDataProducts: [],
      },
    ],
  })
  return manifest
}

export const verifyInventoryReleaseFixture = async (
  consumerRoot: string,
  verify: () => Promise<void>,
) => {
  const manifestPath = join(consumerRoot, 'release/manifest/manifest.json')
  // SAFETY: This is the controlled release fixture copied by the package smoke runner; the installed CLI validates the edited declaration.
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PlatformModuleManifest
  await writeFile(manifestPath, `${JSON.stringify(extendInventoryManifest(manifest), null, 2)}\n`)
  const entryPath = join(consumerRoot, 'release/server/dist/index.js')
  const entry = (await readFile(entryPath, 'utf8'))
    .replace(
      'type FixtureRead { value: String }',
      'type FixtureRead { value: String personalInventory: String }',
    )
    .replace(
      "'Query.fixture': () => ({}),",
      "'Query.fixture': () => ({}),\n    'FixtureRead.personalInventory': async ({ capabilities }) => { await capabilities.inventory.personalInventory({ kind: 'groups', first: 1 }); return null },",
    )
  const factory =
    "\nexport const fixtureInventory = () => async () => { throw new Error('Fixture requires an admitted source') }\n"
  await writeFile(entryPath, entry + factory)
  await verify()
  await writeFile(entryPath, entry + '\nexport const fixtureInventory = {}\n')
  let rejected = false
  try {
    await verify()
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('INVENTORY_PROVIDER_MISMATCH'))
      throw error
    rejected = true
  }
  if (!rejected) throw new Error('Packaged conformance accepted a malformed inventory provider')
  await writeFile(entryPath, entry + factory)
}
