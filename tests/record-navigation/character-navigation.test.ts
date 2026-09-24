import { describe, expect, it } from 'vitest'
import { platformCoreNavigation } from '@eve-space/platform-module-contract/nuxt'
import {
  CORE_CHARACTER_DATA_PREFETCH_IDS,
  findActiveCharacterNavigationEntry,
  hasCoreCharacterDataPrefetch,
  resolveCharacterNavigation,
} from '../../app/utils/character-navigation'

const registryEntries = [
  {
    label: 'Overview',
    navigationId: 'core-character-overview',
    to: '/characters/:characterId',
  },
  {
    label: 'Skills',
    navigationId: 'core-character-skills',
    to: '/characters/:characterId/skills',
  },
  {
    label: 'Threat intelligence',
    navigationId: 'module-intel',
    to: '/characters/:characterId/intel',
  },
]

describe('character record navigation coordination', () => {
  it('registers Finance as the only core character financial destination', () => {
    const finance = platformCoreNavigation.find(
      (entry) => entry.navigationId === 'core-character-finance',
    )

    expect(finance).toMatchObject({
      label: 'Finance',
      path: '/characters/:characterId/finance',
      placement: 'character',
    })
    expect(
      platformCoreNavigation.some((entry) => entry.navigationId === 'core-character-wallet'),
    ).toBe(false)
  })

  it('registers Clones immediately after Skills in the core character contract', () => {
    const characterEntries = platformCoreNavigation.filter(
      (entry) => entry.placement === 'character',
    )
    const skillsIndex = characterEntries.findIndex(
      (entry) => entry.navigationId === 'core-character-skills',
    )

    expect(characterEntries[skillsIndex + 1]).toMatchObject({
      label: 'Clones',
      navigationId: 'core-character-clones',
      order: 30,
      path: '/characters/:characterId/clones',
    })
    expect(characterEntries.map((entry) => [entry.navigationId, entry.order])).toStrictEqual([
      ['core-character-overview', 10],
      ['core-character-skills', 20],
      ['core-character-clones', 30],
      ['core-character-finance', 40],
      ['core-character-assets', 50],
      ['core-character-history', 60],
      ['core-character-mail', 70],
    ])
  })

  it('registers Assets immediately after Finance in the core character contract', () => {
    const characterEntries = platformCoreNavigation.filter(
      (entry) => entry.placement === 'character',
    )
    const financeIndex = characterEntries.findIndex(
      (entry) => entry.navigationId === 'core-character-finance',
    )

    expect(characterEntries[financeIndex + 1]).toMatchObject({
      icon: 'ship',
      label: 'Assets',
      navigationId: 'core-character-assets',
      order: 50,
      path: '/characters/:characterId/assets',
    })
  })

  it('resolves the selected character into core and contributed destinations', () => {
    const entries = resolveCharacterNavigation(registryEntries, 42)

    expect(entries).toStrictEqual([
      {
        exact: true,
        id: 'core-character-overview',
        label: 'OVERVIEW',
        to: '/characters/42',
      },
      {
        exact: false,
        id: 'core-character-skills',
        label: 'SKILLS',
        to: '/characters/42/skills',
      },
      {
        exact: false,
        id: 'module-intel',
        label: 'THREAT INTELLIGENCE',
        to: '/characters/42/intel',
      },
    ])
  })

  it('uses exact overview matching and labels core or contributed child routes', () => {
    const entries = resolveCharacterNavigation(registryEntries, 42)

    expect(findActiveCharacterNavigationEntry(entries, '/characters/42')?.label).toBe('OVERVIEW')
    expect(findActiveCharacterNavigationEntry(entries, '/characters/42/')?.label).toBe('OVERVIEW')
    expect(findActiveCharacterNavigationEntry(entries, '/characters/42/skills')?.label).toBe(
      'SKILLS',
    )
    expect(findActiveCharacterNavigationEntry(entries, '/characters/42/intel/detail')?.label).toBe(
      'THREAT INTELLIGENCE',
    )
    expect(findActiveCharacterNavigationEntry(entries, '/characters/42/history')).toBeUndefined()
  })

  it('only resolves entries retained by the enabled registry and requires a character ID', () => {
    const enabledEntries = registryEntries.filter((entry) => entry.navigationId !== 'module-intel')

    expect(resolveCharacterNavigation(enabledEntries, 42).map((entry) => entry.id)).not.toContain(
      'module-intel',
    )
    expect(resolveCharacterNavigation(registryEntries, undefined)).toStrictEqual([])
  })

  it('limits data-prefetch intent to the existing core query owners', () => {
    expect(CORE_CHARACTER_DATA_PREFETCH_IDS).toStrictEqual([
      'core-character-skills',
      'core-character-clones',
      'core-character-finance',
      'core-character-history',
      'core-character-mail',
    ])
    expect(hasCoreCharacterDataPrefetch('core-character-skills')).toBe(true)
    expect(hasCoreCharacterDataPrefetch('core-character-clones')).toBe(true)
    expect(hasCoreCharacterDataPrefetch('core-character-assets')).toBe(false)
    expect(hasCoreCharacterDataPrefetch('core-character-overview')).toBe(false)
    expect(hasCoreCharacterDataPrefetch('core-character-mail')).toBe(true)
    expect(hasCoreCharacterDataPrefetch('module-intel')).toBe(false)
  })
})
