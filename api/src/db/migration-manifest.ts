import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Migration } from './migration-validation.js'

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url))
const migrationNamePattern = /^\d{3}_[a-z0-9_]+\.sql$/
const sha256Pattern = /^[0-9a-f]{64}$/
const initialManifestLength = 1
const initialTailSequence = 1
const initialManifestSha256 = '8ea247ed3f0f99633c9778959dd56b38b219adb6bb2f7f2be0876ce01d6d73b1'
const acceptedManifestLength = 8
const acceptedManifestSha256 = 'd268847577a252ba4c94e17b3c1188ad00ce07161702c74f6859c6946f7d9880'

export interface CoreMigrationIdentity {
  readonly name: string
  readonly sha256: string
}

export interface LoadedCoreMigration extends Migration {
  readonly sha256: string
}

export const activeCoreMigrationManifest = defineManifest(`
001_baseline.sql 7338ed545fe1c01087091667ae378e682405f673a9a30503165dfa7239b36c35
002_module_sections.sql 2ef3153d0b0b9fb528bddb79846e671f1dca0a2e1c611e0fd5530f1958866a06
003_reviewer_disclosure_acceptance.sql ec92c55f34ef0736269b00e2b9bbc77633f92760443b6c740f5102c116b94e71
004_managed_member_lifecycles.sql 12677ea8e410d43f731be1528eff0f72f0db4804c5ee14d8e18a94eea2a39955
005_sensitive_access_audit.sql 7b9f010c388a0d156a866ecc5920d9916d4722ff21f59c6e8d9c321cc4b05c19
006_platform_resource_purge_work.sql 9db7150e5368513816fc000937b62245fc753968cdf1d5674ac462dd3688c761
007_permission_bundle_ownership.sql 4b5bb72428043fafeeb002a94646eb2689d92c8572a975e91356588787b79f3b
008_multi_character_authority_sources.sql 599f6c9aeb36b38ebcda1a8317a852c1457e777bfab74dbef309c4e25a7b9bc6
`)

export const latestCoreMigrationName = activeCoreMigrationManifest.at(-1)!.name

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

  const initialManifest = manifest.slice(0, initialManifestLength)
  if (manifestSha256(initialManifest) !== initialManifestSha256)
    throw new Error('Core migrations must preserve the reviewed canonical order')

  let previousSequence = initialTailSequence
  for (const entry of manifest.slice(initialManifestLength)) {
    const sequence = Number(entry.name.slice(0, 3))
    if (sequence <= previousSequence)
      throw new Error(
        `Core migration must append a unique sequence after ${previousSequence}: ${entry.name}`,
      )
    previousSequence = sequence
  }

  if (
    manifest.length !== acceptedManifestLength ||
    manifestSha256(manifest) !== acceptedManifestSha256
  )
    throw new Error('Core migration manifest must match the accepted frozen inventory')
}

export function migrationSha256(contents: Uint8Array | string) {
  return createHash('sha256').update(contents).digest('hex')
}

function defineManifest(source: string): readonly CoreMigrationIdentity[] {
  return source
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [name, sha256] = line.split(' ')
      return { name: name!, sha256: sha256! }
    })
}

function manifestSha256(manifest: readonly CoreMigrationIdentity[]) {
  return migrationSha256(manifest.map(({ name, sha256 }) => `${name}:${sha256}`).join('\n'))
}
