import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveFeaturePage } from '../src/page-resolution.js'

let root: string
const pageFile = 'src/runtime/app/pages/FeaturePage.vue'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'eve-feature-page-'))
  await mkdir(join(root, 'src/runtime/app/pages'), { recursive: true })
  await writeFile(join(root, pageFile), '<template><div>Feature</div></template>')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Nuxt feature page resolution', () => {
  it('resolves an existing page through Nuxt Kit', async () => {
    await expect(resolveFeaturePage(root, pageFile, 'alpha/page')).resolves.toBe(
      await realpath(join(root, pageFile)),
    )
  })

  it.each(['src/runtime/app/pages', 'src/runtime/app/pages/Missing.vue'])(
    'rejects missing files and directories: %s',
    async (file) => {
      await expect(resolveFeaturePage(root, file, 'alpha/page')).rejects.toThrow(
        'Nuxt page alpha/page',
      )
    },
  )

  it('rejects a sibling directory sharing the pages prefix', async () => {
    await expect(
      resolveFeaturePage(root, 'src/runtime/app/pages-other/Page.vue', 'alpha/page'),
    ).rejects.toThrow('must remain under src/runtime/app/pages')
  })

  it('rejects a page symlink escaping the pages directory', async () => {
    const outside = join(root, 'Outside.vue')
    await writeFile(outside, '<template><div>Outside</div></template>')
    await symlink(outside, join(root, 'src/runtime/app/pages/Escape.vue'))

    await expect(
      resolveFeaturePage(root, 'src/runtime/app/pages/Escape.vue', 'alpha/page'),
    ).rejects.toThrow('must remain under src/runtime/app/pages')
  })
})
