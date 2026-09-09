import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Migration } from './migration-validation.js'

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url))
const migrationNamePattern = /^\d{3}_[a-z0-9_]+\.sql$/
const sha256Pattern = /^[0-9a-f]{64}$/
const frozenManifestLength = 29
const frozenTailSequence = 41
const frozenManifestSha256 = '99a59d7fcd462086fb274c08834b5512f47e5c9d75577065ed5b1b0690300996'

export interface CoreMigrationIdentity {
  readonly name: string
  readonly sha256: string
}

export interface LoadedCoreMigration extends Migration {
  readonly sha256: string
}

const coreMigrationBaseline = identity(
  '001_initial.sql',
  '783a8c49b306138a30466d551be97be8888a0b38ea04313ded60afe9be1060a7',
)

const coreMigrationTail = [
  identity(
    '020_oauth_state_return_path.sql',
    '0212cdd9faec8ba58d5236fd81549ebb2c41029c3e47aa3ee95ea035d5cbe36f',
  ),
  identity(
    '002_extract_platform_validation_functions.sql',
    'cb695d4205680d8f269cc63b3f687e5858bd1b09c238dc5279101ec7ba1368c1',
  ),
  identity(
    '021_organization_policy.sql',
    'ff2d1d835b2263b15386d77d5a5a63b19834b27bac117b733764fadf600b1c76',
  ),
  identity(
    '022_organization_membership_storage.sql',
    '0da49b6ccf77761b64dff412614283a0610387a64946fc45fcd9f3e8d024e7c5',
  ),
  identity(
    '023_organization_compliance_storage.sql',
    '97aeb8bb0f3578b77b187000cfe85be1f6a2751804d849b439e037e7aaf0aa67',
  ),
  identity(
    '024_organization_role_storage.sql',
    'f99628634db64b58bfa6e5122be5a7a53202c70d4779da8c656dbff823280f51',
  ),
  identity(
    '025_organization_audit.sql',
    'af9f1894142b3995f2d7505ae531c97ecfbf74db6e0b922abfc1cda0b48dfec0',
  ),
  identity(
    '026_organization_compliance_authority.sql',
    'b83f0f225595edc893cb3918939ff0f02d7fa6d12ee7345b4b374b8803725d48',
  ),
  identity(
    '027_organization_owner_oauth_intent.sql',
    '328c49a4c8f81175d94b877b5b1ce9b18c6e89fd6d1ad286a9a3b13dabe8d278',
  ),
  identity(
    '028_organization_authority_evidence_detachment.sql',
    '168b645362e75a573d8a258e6521f17afb3264c596403bd70d6a1ba77eba7586',
  ),
  identity(
    '029_organization_groups.sql',
    '8a3ac30197b62fb6250b525fcf9745bc3a7cad0d66dce9e787024ef155012d9e',
  ),
  identity(
    '030_organization_member_blocks.sql',
    '03ae0901e51d1c7387df2358e3e2b499d80d7a3421eefb45a86f8312e736bbaa',
  ),
  identity(
    '031_core_organization_resources.sql',
    'dec8168c16a49c6f36d0faa26457af5a7267033e3c797411081ebb8217e7e4c5',
  ),
  identity(
    '032_detachment_safe_corporation_sources.sql',
    '900c616a35b80603e8dcf0610d563fdb8aac708523cadd0d0d7aaf700dd05c08',
  ),
  identity(
    '021_sde_type_descriptions.sql',
    '17bb100b46520051c8ec3c0008cf1e68f0f1941b9d15547c49fc93fedfa9d570',
  ),
  identity(
    '033_compliance_mutation_lifecycle.sql',
    '1e540742c29b7a7b6fc869e721178543dada4195cdb5064812dff7f4559df5a9',
  ),
  identity(
    '034_compliance_access_validity.sql',
    '1c471f8f1b1cae0800d6302890d9e34c3e732647c5d3a0cd7ce2831072a7a5ad',
  ),
  identity(
    '035_collection_failure_started_at.sql',
    '8dcef825c3a413a767e705d906041566bc27abc0e309eb453e5ed5f2a610a7e8',
  ),
  identity(
    '036_review_period_access.sql',
    'e7196fb7e1325c6d794f7585dea1d0e2fda71437d7ebfc64b5defa7dc46aac61',
  ),
  identity(
    '037_review_permission_allowlist.sql',
    '4f048e986933609920c2151a6ca13e5f41416ec3004412e03637b4926ffda6ed',
  ),
  identity(
    '022_character_finance_navigation.sql',
    'f50e7edb34706cc0f584a60e0ab0ce83a2efbdf14d1e3166f22eaac7f75c4c04',
  ),
  identity(
    '023_character_clones_navigation.sql',
    '5e7f87e1eebf8d1be54d42de32d731ae6bd220f4fed856ba37a35a915e77d492',
  ),
  identity(
    '024_character_assets_navigation.sql',
    '9cf64859d71e930ad1fdf1f0192873d13063b4c12512f8fccc8aaa32efb582b5',
  ),
  identity(
    '025_login_oauth_return_path.sql',
    '7b6d821f469e8d4fbae0f0b148a117807859a49cc5d9b2645f43593aa1210ed5',
  ),
  identity(
    '038_bind_roster_authorization_generation.sql',
    '18b02ed3ec0e163872ad7b6610687dc8bd3e08fc117ccb22d204a61869685a5d',
  ),
  identity(
    '039_refresh_roster_collection_contract.sql',
    '2014900c8a5b98ebdcd9f96d77b052dc224e827e7dfcaf4d205bb0e0ff5d4513',
  ),
  identity(
    '040_platform_deployment_resources.sql',
    '9841e5dadc33b2264782b0b13ed932c62a44e4d84e8de610ba47c620566912ba',
  ),
  identity(
    '041_sde_locations.sql',
    '056ac12603bb4e523aad2a796f8bc86979ecc10c1233b2809f4d1c04762365cd',
  ),
] as const

export const activeCoreMigrationManifest = [coreMigrationBaseline, ...coreMigrationTail] as const

export const latestCoreMigrationName = coreMigrationTail.at(-1)!.name

export async function loadCoreMigrations(
  directory: string = migrationsDirectory,
  manifest: readonly CoreMigrationIdentity[] = activeCoreMigrationManifest,
): Promise<LoadedCoreMigration[]> {
  assertCoreMigrationManifest(manifest)
  const diskNames = (await readdir(directory)).filter((name) => name.endsWith('.sql'))
  assertCoreMigrationInventory(manifest, diskNames)

  return Promise.all(
    manifest.map(async ({ name, sha256 }) => {
      const contents = await readFile(`${directory}/${name}`)
      assertCoreMigrationContent({ name, sha256 }, contents)
      return { name, sha256, sql: contents.toString('utf8') }
    }),
  )
}

export function assertCoreMigrationInventory(
  manifest: readonly CoreMigrationIdentity[],
  diskNames: readonly string[],
) {
  const expectedNames = new Set(manifest.map(({ name }) => name))
  const missing = manifest.find(({ name }) => !diskNames.includes(name))
  if (missing) throw new Error(`Core migration manifest is missing file ${missing.name}`)
  const extra = diskNames.find((name) => !expectedNames.has(name))
  if (extra) throw new Error(`Core migration file is absent from manifest: ${extra}`)
}

export function assertCoreMigrationContent(
  migration: CoreMigrationIdentity,
  contents: Uint8Array | string,
) {
  if (migrationSha256(contents) !== migration.sha256)
    throw new Error(`Core migration content identity mismatch: ${migration.name}`)
}

export function assertCoreMigrationManifest(manifest: readonly CoreMigrationIdentity[]) {
  const names = new Set<string>()
  for (const entry of manifest) {
    if (!migrationNamePattern.test(entry.name))
      throw new Error(`Invalid core migration manifest name: ${entry.name}`)
    if (!sha256Pattern.test(entry.sha256))
      throw new Error(`Invalid core migration content identity: ${entry.name}`)
    if (names.has(entry.name))
      throw new Error(`Duplicate core migration manifest name: ${entry.name}`)
    names.add(entry.name)
  }

  const frozenManifest = manifest.slice(0, frozenManifestLength)
  const actualFrozenManifestSha256 = migrationSha256(
    frozenManifest.map(({ name, sha256 }) => `${name}:${sha256}`).join('\n'),
  )
  if (actualFrozenManifestSha256 !== frozenManifestSha256)
    throw new Error('Core migrations must preserve the reviewed canonical order')

  let previousSequence = frozenTailSequence
  for (const entry of manifest.slice(frozenManifestLength)) {
    const sequence = Number(entry.name.slice(0, 3))
    if (sequence <= previousSequence)
      throw new Error(
        `Core migration must append a unique sequence after ${previousSequence}: ${entry.name}`,
      )
    previousSequence = sequence
  }
}

export function migrationSha256(contents: Uint8Array | string) {
  return createHash('sha256').update(contents).digest('hex')
}

function identity(name: string, sha256: string): CoreMigrationIdentity {
  return { name, sha256 }
}
