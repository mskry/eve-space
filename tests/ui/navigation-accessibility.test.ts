import { describe, expect, it, vi } from 'vitest'
import {
  createMainContentFocusManager,
  focusMainContent,
  MAIN_CONTENT_ID,
} from '../../app/utils/main-content-focus'
import { composeRecordPageTitle } from '../../app/utils/page-title'

describe('navigation accessibility', () => {
  it('focuses the shared main target without changing scroll position', () => {
    const main = document.createElement('main')
    main.id = MAIN_CONTENT_ID
    main.tabIndex = -1
    document.body.append(main)
    const focus = vi.spyOn(main, 'focus')

    focusMainContent(document)

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    main.remove()
  })

  it('focuses only the current completed path and cancels stale path changes', () => {
    const main = document.createElement('main')
    main.id = MAIN_CONTENT_ID
    main.tabIndex = -1
    document.body.append(main)
    const focus = vi.spyOn(main, 'focus')
    const manager = createMainContentFocusManager(document)

    manager.recordNavigation('/characters/7', '/characters', true)
    manager.focusFinishedPage('/characters/8')
    manager.focusFinishedPage('/characters/7')
    expect(focus).not.toHaveBeenCalled()

    manager.recordNavigation('/characters/7', '/characters', true)
    manager.recordNavigation('/characters/7', '/characters/7', true)
    manager.focusFinishedPage('/characters/7')
    expect(focus).not.toHaveBeenCalled()

    manager.recordNavigation('/characters/7', '/characters', false)
    manager.focusFinishedPage('/characters/7')
    expect(focus).not.toHaveBeenCalled()

    manager.recordNavigation('/characters/7', '/characters', true)
    manager.focusFinishedPage('/characters/7')
    expect(focus).toHaveBeenCalledOnce()
    main.remove()
  })

  it('composes unique nested record titles from route metadata and loaded identity', () => {
    const characterSections = [
      'Character Overview',
      'Character Skills',
      'Character Clones',
      'Character Finance',
      'Character Assets',
      'Employment History',
      'Character Mail',
    ]
    const characterTitles = characterSections.map((section) =>
      composeRecordPageTitle('Manifest Pilot', section, 'Character'),
    )
    const corporationTitles = ['Corporation Overview', 'Corporation Alliance History'].map(
      (section) => composeRecordPageTitle('Manifest Corporation [MNFS]', section, 'Corporation'),
    )

    expect(new Set(characterTitles).size).toBe(characterSections.length)
    expect(new Set(corporationTitles).size).toBe(corporationTitles.length)
    expect(characterTitles[4]).toBe('Manifest Pilot // Character Assets // EVE Space')
    expect(corporationTitles[1]).toBe(
      'Manifest Corporation [MNFS] // Corporation Alliance History // EVE Space',
    )
    expect(composeRecordPageTitle(undefined, undefined, 'Character')).toBe('Character // EVE Space')
  })
})
