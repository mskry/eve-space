// EVE bios and corp descriptions are user-authored HTML with legacy unicode literals.
// The UI renders this as escaped text, so stripping markup here is purely cosmetic.
export function eveDescriptionToPlainText(html: string | undefined | null): string | undefined {
  if (!html) return undefined
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const normalized = decodeLegacyUnicodeLiteral(text).trim()
  return normalized || undefined
}

function decodeLegacyUnicodeLiteral(value: string) {
  const literal = /^[uU](['"])([\s\S]*)\1$/.exec(value)
  if (!literal) return value

  const body = literal[2]!
  let decoded = ''
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!
    if (character !== '\\' || index === body.length - 1) {
      decoded += character
      continue
    }

    const escape = body[index + 1]!
    const digits = escape === 'u' ? 4 : escape === 'U' ? 8 : 0
    if (digits) {
      const hex = body.slice(index + 2, index + 2 + digits)
      if (hex.length === digits && /^[0-9a-f]+$/i.test(hex)) {
        const codePoint = Number.parseInt(hex, 16)
        if (digits === 4 || codePoint <= 0x10ffff) {
          decoded += digits === 4 ? String.fromCharCode(codePoint) : String.fromCodePoint(codePoint)
          index += digits + 1
          continue
        }
      }
    }

    const escapedCharacter =
      escape === 'n'
        ? '\n'
        : escape === 'r'
          ? '\r'
          : escape === 't'
            ? '\t'
            : escape === '\\' || escape === "'" || escape === '"'
              ? escape
              : undefined
    if (escapedCharacter !== undefined) {
      decoded += escapedCharacter
      index += 1
      continue
    }

    decoded += `\\${escape}`
    index += 1
  }
  return decoded
}
