import { readFile } from 'node:fs/promises'
import { readCurrentObservationOperation } from '@eve-space/member-audit-server'
import { expect, test } from 'vitest'

test('keeps documented independent observation examples within the attested DTO schema', async () => {
  const guide = await readFile(
    new URL('../../../docs/member-audit-operations.md', import.meta.url),
    'utf8',
  )
  const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)]
  expect(examples).toHaveLength(2)
  for (const [, body] of examples) {
    expect(() =>
      readCurrentObservationOperation.outputSchema.parse(JSON.parse(body!)),
    ).not.toThrow()
  }
})
