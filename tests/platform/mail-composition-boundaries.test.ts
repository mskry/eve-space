import { describe, expect, it } from 'vitest'
import {
  mailCompositionImportViolations,
  type MailCompositionSource,
} from '../../scripts/mail-composition/boundaries'

describe('mail composition boundaries', () => {
  it('allows the facade to compose draft and submission modules', () => {
    expect(
      mailCompositionImportViolations(
        declaredSources({
          'app/components/mail/MailComposeDialog.vue':
            '<script setup lang="ts">\nimport { useMailComposition } from "../../composables/useMailComposition"\n</script>',
        }),
      ),
    ).toEqual([])
  })

  it('rejects reverse imports and callers that bypass the facade', () => {
    expect(
      mailCompositionImportViolations(
        declaredSources({
          'app/composables/mail-composition-draft.ts': "import './mail-composition-submission'",
          'app/pages/mail-helper.ts': "import '../composables/mail-composition-submission'",
        }),
      ),
    ).toEqual([
      'app/composables/mail-composition-draft.ts: cannot import mail composition module app/composables/mail-composition-submission.ts',
      'app/pages/mail-helper.ts: cannot import mail composition module app/composables/mail-composition-submission.ts',
    ])
  })

  it('rejects Vue callers that bypass the facade', () => {
    expect(
      mailCompositionImportViolations(
        declaredSources({
          'app/pages/mail.vue':
            '<script setup lang="ts">\nimport "../composables/mail-composition-submission"\n</script>\n<template><main></main></template>',
        }),
      ),
    ).toEqual([
      'app/pages/mail.vue: cannot import mail composition module app/composables/mail-composition-submission.ts',
    ])
  })

  it('rejects a missing seam owner', () => {
    expect(
      mailCompositionImportViolations(
        declaredSources({}, ['app/composables/mail-composition-submission.ts']),
      ),
    ).toEqual(['Mail composition module app/composables/mail-composition-submission.ts is missing'])
  })
})

function declaredSources(
  overrides: Record<string, string> = {},
  omitted: readonly string[] = [],
): MailCompositionSource[] {
  const defaults = {
    'app/composables/mail-composition-draft.ts': "import '../utils/mail-composition'",
    'app/composables/mail-composition-submission.ts':
      "import './mail-composition-draft'\nimport '../utils/mail-composition'",
    'app/composables/useMailComposition.ts':
      "import './mail-composition-draft'\nimport './mail-composition-submission'\nimport '../utils/mail-composition'",
    'app/utils/mail-composition.ts': '',
  }
  return Object.entries({ ...defaults, ...overrides })
    .filter(([path]) => !omitted.includes(path))
    .map(([path, source]) => ({ path, source }))
}
