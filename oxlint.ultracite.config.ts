import { defineConfig } from 'oxlint'
import core from 'ultracite/oxlint/core'
import vitest from 'ultracite/oxlint/vitest'
import vue from 'ultracite/oxlint/vue'

import current from './.oxlintrc.json' with { type: 'json' }

export default defineConfig({
  extends: [core, vue, vitest, current],
  ignorePatterns: [...core.ignorePatterns, ...current.ignorePatterns],
  rules: {
    // Ultracite's rule option is unsupported by the pinned Oxlint 1.81.
    'no-unmodified-loop-condition': 'error',
  },
})
