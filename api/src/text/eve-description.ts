// EVE descriptions contain HTML-like markup and may use legacy unicode literals.
// The UI renders this as escaped text, so stripping markup here is purely cosmetic.
const legacyUnicodePrefixes = new Set(['u', 'U'])
const legacyUnicodeQuotes = new Set(["'", '"'])
const unicodeEscapeLengths: Readonly<Record<string, number>> = { u: 4, U: 8 }
const escapedCharacters: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '\\': '\\',
  "'": "'",
  '"': '"',
}
const htmlEntities: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

export function eveDescriptionToPlainText(html: string | undefined | null): string | undefined {
  if (!html) return undefined
  const text = decodeHtmlEntities(
    stripMarkup(html.replaceAll(/<br\s*\/?>/gi, '\n').replaceAll(/<\/p>/gi, '\n')),
  )
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
  const normalized = decodeLegacyUnicodeLiteral(text).trim()
  return normalized || undefined
}

function decodeHtmlEntities(value: string) {
  return value.replaceAll(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, named: string) => {
      if (named) return htmlEntities[named.toLowerCase()] ?? entity
      const encodedCodePoint = decimal ?? hexadecimal
      if (!encodedCodePoint) return entity
      const codePoint = Number.parseInt(encodedCodePoint, decimal ? 10 : 16)
      return isUnicodeScalar(codePoint) ? String.fromCodePoint(codePoint) : entity
    },
  )
}

function isUnicodeScalar(value: number) {
  return value > 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff)
}

function stripMarkup(value: string) {
  let plainText = ''
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor)
    if (start === -1) return plainText + value.slice(cursor)
    if (!isMarkupStart(value, start)) {
      plainText += value.slice(cursor, start + 1)
      cursor = start + 1
      continue
    }
    const end = value.indexOf('>', start + 1)
    if (end === -1) return plainText + value.slice(cursor)
    plainText += value.slice(cursor, start)
    cursor = end + 1
  }
  return plainText
}

function isMarkupStart(value: string, start: number) {
  const next = value[start + 1]
  if (next && /[a-z]/i.test(next)) return true
  return next === '/' && /[a-z]/i.test(value[start + 2] ?? '')
}

function decodeLegacyUnicodeLiteral(value: string) {
  const body = legacyUnicodeBody(value)
  if (body === undefined) return value

  let decoded = ''
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!
    if (character !== '\\' || index === body.length - 1) {
      decoded += character
      continue
    }

    const [escaped, consumed] = decodeEscape(body, index + 1)
    decoded += escaped
    index += consumed
  }
  return decoded
}

function legacyUnicodeBody(value: string) {
  if (value.length < 3 || !legacyUnicodePrefixes.has(value[0]!)) return undefined

  const quote = value[1]!
  if (!legacyUnicodeQuotes.has(quote) || value.at(-1) !== quote) return undefined
  return value.slice(2, -1)
}

function decodeEscape(body: string, escapeIndex: number): [value: string, consumed: number] {
  const escape = body[escapeIndex]!
  const digits = unicodeEscapeLengths[escape]
  if (digits !== undefined) {
    const hex = body.slice(escapeIndex + 1, escapeIndex + 1 + digits)
    if (hex.length === digits && /^[0-9a-f]+$/i.test(hex)) {
      const codePoint = Number.parseInt(hex, 16)
      if (digits === 4 || codePoint <= 0x10ffff)
        return [String.fromCodePoint(codePoint), digits + 1]
    }
  }

  return [escapedCharacters[escape] ?? `\\${escape}`, 1]
}
