import { describe, expect, it } from 'vitest'
import { platformCoreNavigation } from '../../packages/platform-module-contract/src/contract'
import {
  CORE_CHARACTER_DATA_PREFETCH_IDS,
  findActiveCharacterNavigationEntry,
  hasCoreCharacterDataPrefetch,
  resolveCharacterNavigation,
} from '../../app/utils/character-navigation'

const registryEntries = [
  {
    navigationId: 'core-character-overview',
    label: 'Overview',
    to: '/characters/:characterId',
  },
  {
    navigationId: 'core-character-skills',
    label: 'Skills',
    to: '/characters/:characterId/skills',
  },
  {
    navigationId: 'module-intel',
    label: 'Threat intelligence',
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
      navigationId: 'core-character-clones',
      label: 'Clones',
      path: '/characters/:characterId/clones',
      order: 30,
    })
    expect(characterEntries.map((entry) => [entry.navigationId, entry.order])).toEqual([
      ['core-character-overview', 10],
      ['core-character-skills', 20],
      ['core-character-clones', 30],
      ['core-character-finance', 40],
      ['core-character-history', 50],
      ['core-character-mail', 60],
    ])
  })

  it('resolves the selected character into core and contributed destinations', () => {
    const entries = resolveCharacterNavigation(registryEntries, 42)

    expect(entries).toEqual([
      {
        id: 'core-character-overview',
        label: 'OVERVIEW',
        to: '/characters/42',
        exact: true,
      },
      {
        id: 'core-character-skills',
        label: 'SKILLS',
        to: '/characters/42/skills',
        exact: false,
      },
      {
        id: 'module-intel',
        label: 'THREAT INTELLIGENCE',
        to: '/characters/42/intel',
        exact: false,
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
    expect(resolveCharacterNavigation(registryEntries, undefined)).toEqual([])
  })

  it('limits data-prefetch intent to the existing core query owners', () => {
    expect(CORE_CHARACTER_DATA_PREFETCH_IDS).toEqual([
      'core-character-skills',
      'core-character-clones',
      'core-character-finance',
      'core-character-history',
      'core-character-mail',
    ])
    expect(hasCoreCharacterDataPrefetch('core-character-skills')).toBe(true)
    expect(hasCoreCharacterDataPrefetch('core-character-clones')).toBe(true)
    expect(hasCoreCharacterDataPrefetch('core-character-overview')).toBe(false)
    expect(hasCoreCharacterDataPrefetch('core-character-mail')).toBe(true)
    expect(hasCoreCharacterDataPrefetch('module-intel')).toBe(false)
  })
})
