import { defineConfig } from 'oxfmt'
import ultracite from 'ultracite/oxfmt'

import current from './.oxfmtrc.json' with { type: 'json' }

export default defineConfig({
  ...ultracite,
  ...current,
  ignorePatterns: [...ultracite.ignorePatterns, ...current.ignorePatterns],
  sortImports: undefined,
  sortTailwindcss: undefined,
})
