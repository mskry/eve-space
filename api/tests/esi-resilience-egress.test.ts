import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

describe('ESI egress verification', () => {
  test('permits only the resilience transport and layer-owned cache or cooldown state', async () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    await expect(
      execFileAsync('node', ['scripts/verify-esi-egress.mjs'], { cwd: root }),
    ).resolves.toEqual(expect.objectContaining({ stderr: '' }))
  })
})
