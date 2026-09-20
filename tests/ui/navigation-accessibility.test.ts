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
    let currentPath = '/characters/7'
    const scheduled: (() => void)[] = []
    const manager = createMainContentFocusManager(document, {
      currentPath: () => currentPath,
      schedule: (callback) => {
        scheduled.push(callback)
        return callback
      },
      cancelScheduled: vi.fn(),
    })

    manager.recordNavigation('/characters/7', '/characters', {
      applicationMounted: true,
      replacesMain: false,
    })
    manager.focusFinishedPage('/characters/8')
    manager.focusFinishedPage('/characters/7')
    expect(focus).not.toHaveBeenCalled()

    manager.recordNavigation('/characters/7', '/characters', {
      applicationMounted: true,
      replacesMain: false,
    })
    manager.recordNavigation('/characters/7', '/characters/7', {
      applicationMounted: true,
      replacesMain: false,
    })
    manager.focusFinishedPage('/characters/7')
    expect(focus).not.toHaveBeenCalled()

    manager.recordNavigation('/characters/7', '/characters', {
      applicationMounted: false,
      replacesMain: false,
    })
    manager.focusFinishedPage('/characters/7')
    expect(focus).not.toHaveBeenCalled()

    manager.recordNavigation('/characters/7', '/characters', {
      applicationMounted: true,
      replacesMain: false,
    })
    manager.focusFinishedPage('/characters/7')
    scheduled.at(-1)?.()
    expect(focus).toHaveBeenCalledOnce()

    currentPath = '/characters/8'
    manager.recordNavigation('/characters/8', '/characters/7', {
      applicationMounted: true,
      replacesMain: false,
    })
    manager.focusFinishedPage('/characters/7')
    expect(focus).toHaveBeenCalledOnce()
    main.remove()
  })

  it('waits for a replaced main target and tears down replacement observers', () => {
    const oldMain = document.createElement('main')
    oldMain.id = MAIN_CONTENT_ID
    oldMain.tabIndex = -1
    document.body.append(oldMain)
    let currentPath = '/settings'
    let observeReplacement: () => void = vi.fn()
    const disconnect = vi.fn()
    const observe = vi.fn()
    const cancelScheduled = vi.fn()
    const manager = createMainContentFocusManager(document, {
      currentPath: () => currentPath,
      createObserver: (callback) => {
        observeReplacement = callback
        return { disconnect, observe }
      },
      schedule: (callback) => callback,
      cancelScheduled,
    })

    manager.recordNavigation('/settings', '/characters/7', {
      applicationMounted: true,
      replacesMain: true,
    })
    manager.focusFinishedPage('/settings')
    expect(observe).toHaveBeenCalledWith(document.body, { childList: true, subtree: true })

    const newMain = document.createElement('main')
    newMain.id = MAIN_CONTENT_ID
    newMain.tabIndex = -1
    const focus = vi.spyOn(newMain, 'focus')
    oldMain.replaceWith(newMain)
    observeReplacement()

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(disconnect).toHaveBeenCalledOnce()
    expect(cancelScheduled).toHaveBeenCalledOnce()

    currentPath = '/characters'
    observeReplacement()
    expect(focus).toHaveBeenCalledOnce()
    newMain.remove()
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
