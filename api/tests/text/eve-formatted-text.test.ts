import { describe, expect, test } from 'vitest'
import {
  eveFormattedTextToPlainText,
  parseEveFormattedText,
} from '../../src/text/eve-formatted-text.js'

describe('EVE formatted text normalization', () => {
  test('decodes legacy Unicode literals and common escapes', () => {
    expect(eveFormattedTextToPlainText(String.raw`u'\uace0\n\tFly \\ safe'`)).toBe(
      '고\n\tFly \\ safe',
    )
    expect(eveFormattedTextToPlainText(String.raw`U"\U0001F600"`)).toBe('😀')
  })

  test('preserves malformed escapes and ordinary text', () => {
    expect(eveFormattedTextToPlainText(String.raw`u'\uZZZZ \U00110000'`)).toBe(
      String.raw`\uZZZZ \U00110000`,
    )
    expect(eveFormattedTextToPlainText(String.raw`Fly safe: \uace0`)).toBe(
      String.raw`Fly safe: \uace0`,
    )
  })

  test('normalizes representative EVE markup and entities', () => {
    expect(
      eveFormattedTextToPlainText(
        '<font size="14"><b>First&nbsp;line &AMP; details</b></font><br><url=showinfo:2//1000125>CONCORD</url><t>Third',
      ),
    ).toBe('First line & details\nCONCORD\tThird')
  })

  test('recognizes only the tokenizer-supported line and column markers', () => {
    expect(eveFormattedTextToPlainText('A<BR&nbsp; />B<br class="ignored">C</br>D<T>E<t >F')).toBe(
      'A\nBCD\tEF',
    )
  })

  test('allows closing brackets inside recognized quoted attributes', () => {
    expect(
      eveFormattedTextToPlainText(
        '<a href="https://example.test/?comparison=>">Visible</a><blink title=">">Text</blink>',
      ),
    ).toBe('Visible">Text')
  })

  test('keeps recognized EVE attribute families quote-aware', () => {
    expect(
      eveFormattedTextToPlainText(
        `<hint='a>b'>H</hint><localized label="a>b">L</localized><letterspace='a>b'>S</letterspace><url:'a>b'>U</url><fontsize='a>b'>F</fontsize>`,
      ),
    ).toBe('HLSUF')
    expect(parseEveFormattedText('<font size="12>10" color="#ff00ff00">G</font>')).toEqual({
      plainText: 'G',
      runs: [{ color: '#00ff00ff', start: 0, text: 'G' }],
    })
    expect(eveFormattedTextToPlainText('<hint="unterminated>Visible')).toBe('Visible')
  })

  test('leaves non-EVE entities as literal text', () => {
    expect(eveFormattedTextToPlainText('&quot; &#39; &#x2605; &apos;')).toBe(
      '&quot; &#39; &#x2605; &apos;',
    )
  })

  test('handles malformed, crossed, and unknown tags leniently', () => {
    expect(
      eveFormattedTextToPlainText(
        '<font size="14"><b>More<br><br></font><blink>Information</b></blink>',
      ),
    ).toBe('More\n\nInformation')
  })

  test('converts validated EVE colors from alpha-first order to CSS order', () => {
    expect(
      parseEveFormattedText(
        '<font color="#80ff0000">R</font><color=0xFF33FFFFL>C</color><font color=yellow>Y</font><font color=lightblue>B</font>',
      ),
    ).toEqual({
      plainText: 'RCYB',
      runs: [
        { color: '#ff000080', start: 0, text: 'R' },
        { color: '#33ffffff', start: 1, text: 'C' },
        { color: '#ffff00ff', start: 2, text: 'Y' },
        { color: '#7777ffff', start: 3, text: 'B' },
      ],
    })
  })

  test('rejects arbitrary CSS and unsupported color shapes', () => {
    expect(
      parseEveFormattedText(
        '<font color="red;position:fixed">Safe</font><color=#ffffff> six</color><font color=chartreuse> named</font>',
      ),
    ).toEqual({
      plainText: 'Safe six named',
      runs: [{ start: 0, text: 'Safe six named' }],
    })
  })

  test('discards unknown and unterminated tags like the EVE tokenizer', () => {
    expect(eveFormattedTextToPlainText('<font color="#fff">Readable</font> <broken')).toBe(
      'Readable',
    )
    expect(eveFormattedTextToPlainText('2 < 3 and 4 > 1')).toBe('2  1')
    expect(eveFormattedTextToPlainText('love <3 and <broken')).toBe('love')
  })

  test('normalizes source line endings and literal tabs', () => {
    expect(eveFormattedTextToPlainText('First\r\nSecond\tcolumn\rThird')).toBe(
      'First\nSecond column\rThird',
    )
  })

  test('decodes escaped Unicode after removing SDE markup', () => {
    expect(eveFormattedTextToPlainText(String.raw`<b>u'Fly \u2605 safe'</b>`)).toBe('Fly ★ safe')
  })

  test('preserves colors and alignment while decoding legacy Unicode runs', () => {
    expect(
      parseEveFormattedText(
        String.raw`u'<font color="#ff0000ff"> \u2588</font><font color="#ffffff00"><br>        \u2588</font>'`,
      ),
    ).toEqual({
      plainText: '█\n        █',
      runs: [
        { color: '#0000ffff', start: 0, text: '█' },
        { color: '#ffff00ff', start: 1, text: '\n        █' },
      ],
    })
  })

  test('returns undefined when normalized content is empty', () => {
    expect(eveFormattedTextToPlainText('<p><font color="#fff"></font>&nbsp;</p>')).toBeUndefined()
  })

  test('handles adversarial tag and entity near-matches in linear scans', () => {
    const incompleteTag = `<${'a'.repeat(100_000)}`
    const incompleteEntity = `&${'a'.repeat(100_000)};`
    expect(eveFormattedTextToPlainText(`${incompleteEntity}${incompleteTag}`)).toBe(
      incompleteEntity,
    )
  })
})
