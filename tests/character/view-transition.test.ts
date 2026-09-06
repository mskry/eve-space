import { describe, expect, it } from 'vitest'
import { characterPortraitViewTransitionName } from '../../app/utils/view-transition'

describe('character view transitions', () => {
  it('builds a unique portrait transition name', () => {
    expect(characterPortraitViewTransitionName(7)).toBe('character-portrait-7')
  })
})
