import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

describe('packed package graph', () => {
  it('contains only the dependency-free ESM contract', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>
    const declaration = await readFile(new URL('../dist/index.d.ts', import.meta.url), 'utf8')

    expect(packageRoot).toContain('packages/core-data-contract')
    expect(packageJson.type).toBe('module')
    expect(packageJson.files).toEqual(['dist'])
    expect(packageJson).not.toHaveProperty('dependencies')
    expect(packageJson).not.toHaveProperty('peerDependencies')
    expect(declaration).not.toMatch(
      /(?:hono|vue|nuxt|postgres|drizzle|redis|bullmq|@evespace\/esi-client)/,
    )
  })
})
