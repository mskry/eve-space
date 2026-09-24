import type { NuxtPage } from '@nuxt/schema'
import { describe, expect, it } from 'vitest'
import { composePlatformPages, type ResolvedContributionPage } from '../src/pages.js'

const contribution: ResolvedContributionPage = {
  file: '/features/alpha/nuxt/src/runtime/app/pages/RecordPage.vue',
  moduleId: 'alpha',
  page: {
    audience: 'authenticated',
    extensionPoint: 'character-shell',
    file: 'src/runtime/app/pages/RecordPage.vue',
    id: 'record',
    name: 'alpha-record',
    path: '/characters/:characterId/alpha',
    sectionId: 'skills',
  },
}

describe('platform page composition', () => {
  it('attaches a relative child with module and audience metadata', () => {
    const pages: NuxtPage[] = [
      { file: '/app/CharacterPage.vue', name: 'character', path: '/characters/:characterId' },
    ]
    composePlatformPages(pages, [contribution])
    expect(pages[0]?.children).toStrictEqual([
      {
        file: contribution.file,
        meta: {
          platformAudience: 'authenticated',
          platformModuleId: 'alpha',
          platformModuleSectionId: 'skills',
        },
        name: 'alpha-record',
        path: 'alpha',
      },
    ])
  })

  it.each([
    { name: 'alpha-record', path: '/different' },
    { name: 'different', path: '/characters/:id/alpha/' },
  ])('rejects conflicting existing routes: %o', (page) => {
    expect(() => composePlatformPages([page], [contribution])).toThrow('already registered')
  })

  it('rejects duplicate contributed routes', () => {
    const pages: NuxtPage[] = [{ path: '/characters/:characterId' }]
    expect(() => composePlatformPages(pages, [contribution, contribution])).toThrow(
      'already registered',
    )
  })

  it('rejects missing or ambiguous character shells', () => {
    expect(() => composePlatformPages([], [contribution])).toThrow(
      'Expected one character-shell page',
    )
    expect(() =>
      composePlatformPages(
        [{ path: '/characters/:id' }, { path: '/characters/:characterId' }],
        [contribution],
      ),
    ).toThrow('Expected one character-shell page')
  })
})
