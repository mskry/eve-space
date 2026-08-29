import { describe, expect, it } from 'vitest'
import { inferCloneState } from '../app/utils/clone-state'

describe('clone state inference', () => {
  it('infers alpha when a trained skill level is inactive', () => {
    expect(
      inferCloneState({
        groups: [{ skills: [{ activeLevel: 4, trainedLevel: 5 }] }],
      }),
    ).toBe('alpha')
  })

  it('does not infer omega from equal active and trained levels', () => {
    expect(
      inferCloneState({
        groups: [{ skills: [{ activeLevel: 5, trainedLevel: 5 }] }],
      }),
    ).toBeUndefined()
  })

  it('returns no status for an empty archive', () => {
    expect(inferCloneState({ groups: [] })).toBeUndefined()
  })
})
