import { describe, expect, it } from 'vitest'
import { formatAssetVolume } from '../../app/utils/assets-format'

describe('formatAssetVolume', () => {
  it('formats valid volumes with bounded precision', () => {
    expect(formatAssetVolume(0)).toBe('0 m³')
    expect(formatAssetVolume(1_234.567)).toBe('1,234.57 m³')
    expect(formatAssetVolume(1_234.567, 1)).toBe('1,234.6 m³')
  })

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'returns Unknown for invalid volume %s',
    (volume) => {
      expect(formatAssetVolume(volume)).toBe('Unknown')
    },
  )
})
