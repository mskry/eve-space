import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import module from '../src/module.js'

test('exports a Nuxt module for the member-audit package', () => {
  expect(module).toBeTypeOf('function')
})

test('ships an accessible disabled-state runtime surface without registering a page', async () => {
  const source = await readFile(
    fileURLToPath(
      new URL('../src/runtime/app/components/MemberAuditModuleUnavailable.vue', import.meta.url),
    ),
    'utf8',
  )

  expect(source).toContain('aria-labelledby="member-audit-unavailable-title"')
  expect(source).toContain('must enable the module and its evidence sections')
})
