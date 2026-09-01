import { describe, expect, test } from 'vitest'
import { eveDescriptionToPlainText } from '../../src/text/eve-description.js'

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

  test('normalizes representative SDE markup and entities', () => {
    expect(
      eveDescriptionToPlainText(
        '<p>First&nbsp;line &amp; details</p><p><font color="#fff">Second &#8226; &#x2605;</font><br>Third</p>',
      ),
    ).toBe('First line & details\nSecond • ★\nThird')
  })

  test('preserves readable content around malformed tags', () => {
    expect(eveDescriptionToPlainText('<font color="#fff">Readable</font> <broken')).toBe(
      'Readable <broken',
    )
    expect(eveDescriptionToPlainText('2 < 3 and 4 > 1')).toBe('2 < 3 and 4 > 1')
  })

  test('decodes escaped Unicode after removing SDE markup', () => {
    expect(eveDescriptionToPlainText(String.raw`<b>u'Fly \u2605 safe'</b>`)).toBe('Fly ★ safe')
  })

  test('returns undefined when normalized content is empty', () => {
    expect(eveDescriptionToPlainText('<p><font color="#fff"></font>&nbsp;</p>')).toBeUndefined()
  })
})
