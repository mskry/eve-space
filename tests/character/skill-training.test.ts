import { describe, expect, it } from 'vitest'
import { skillPointsPerMinute, skillPointsRequiredForLevel } from '../../app/utils/skill-training'

describe('skill training formulas', () => {
  it.each([
    [1, 250],
    [2, 1414],
    [3, 8000],
    [4, 45_254],
    [5, 256_000],
  ] as const)('calculates rank 1 level %s as %s SP', (level, expected) => {
    expect(skillPointsRequiredForLevel(1, level)).toBe(expected)
  })

  it.each([
    [1, 4000],
    [2, 22_627],
    [3, 128_000],
    [4, 724_077],
    [5, 4_096_000],
  ] as const)('scales rank 16 level %s to %s SP', (level, expected) => {
    expect(skillPointsRequiredForLevel(16, level)).toBe(expected)
  })

  it('calculates skill points generated per minute from primary and secondary attributes', () => {
    expect(skillPointsPerMinute(27, 21)).toBe(37.5)
    expect(skillPointsPerMinute(20, 20)).toBe(30)
  })
})
