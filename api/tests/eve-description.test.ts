import { describe, expect, test } from 'vitest'
import { eveDescriptionToPlainText } from '../src/eve-description.js'

describe('EVE description normalization', () => {
  test('decodes legacy Unicode literals and common escapes', () => {
    expect(eveDescriptionToPlainText(String.raw`u'\uace0\n\tFly \\ safe'`)).toBe(
      '고\n\tFly \\ safe',
    )
    expect(eveDescriptionToPlainText(String.raw`U"\U0001F600"`)).toBe('😀')
  })

  test('preserves malformed escapes and ordinary text', () => {
    expect(eveDescriptionToPlainText(String.raw`u'\uZZZZ \U00110000'`)).toBe(
      String.raw`\uZZZZ \U00110000`,
    )
    expect(eveDescriptionToPlainText(String.raw`Fly safe: \uace0`)).toBe(
      String.raw`Fly safe: \uace0`,
    )
  })
})
