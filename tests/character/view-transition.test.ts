import { describe, expect, it } from 'vitest'
import {
  characterNameViewTransitionName,
  characterPortraitViewTransitionName,
} from '../../app/utils/view-transition'

describe('character view transitions', () => {
  it('builds a unique portrait transition name', () => {
    expect(characterPortraitViewTransitionName(7)).toBe('character-portrait-7')
  })

  it('builds a unique character name transition name', () => {
    expect(characterNameViewTransitionName(7)).toBe('character-name-7')
  })
})
