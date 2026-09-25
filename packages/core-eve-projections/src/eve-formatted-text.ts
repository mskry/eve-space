// EVE formatted text contains HTML-like markup and may use legacy unicode literals.
// The UI renders typed runs and never receives raw markup.
const legacyUnicodePrefixes = new Set(['u', 'U'])
const quoteCharacters = new Set(["'", '"'])
const unicodeEscapeLengths = new Map([
  ['U', 8],
  ['u', 4],
])
const escapedCharacters = new Map([
  ['"', '"'],
  ["'", "'"],
  ['\\', '\\'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
])
const eveEntities = new Map([
  ['amp', '&'],
  ['gt', '>'],
  ['lt', '<'],
  ['nbsp', ' '],
])
const namedEveColors = new Map([
  ['aqua', 'ff00ffff'],
  ['black', 'ff000000'],
  ['blue', 'ff0000ff'],
  ['fuchsia', 'ffff00ff'],
  ['gray', 'ff808080'],
  ['green', 'ff008000'],
  ['grey', 'ff808080'],
  ['lightblue', 'ff7777ff'],
  ['lightgreen', 'ff80ff80'],
  ['lightred', 'ffcc3333'],
  ['lime', 'ff00ff00'],
  ['maroon', 'ff800000'],
  ['navy', 'ff000080'],
  ['olive', 'ff808000'],
  ['orange', 'ffff8000'],
  ['purple', 'ff800080'],
  ['red', 'ffff0000'],
  ['silver', 'ffc0c0c0'],
  ['teal', 'ff008080'],
  ['transparent', '00000000'],
  ['white', 'ffffffff'],
  ['yellow', 'ffffff00'],
])
const voidTags = new Set(['br', 'center', 'left', 'right', 't'])

interface EveFormattedTextRun {
  color?: string
  start: number
  text: string
}

export interface EveFormattedText {
  plainText: string
  runs: readonly EveFormattedTextRun[]
}

export function parseEveFormattedText(
  formattedText: string | undefined | null,
): EveFormattedText | undefined {
  if (!formattedText) {
    return undefined
  }

  const rawRuns = tokenizeTextRuns(formattedText.replaceAll('\r\n', '\n').replaceAll('\t', ' '))
  const normalizedRuns = normalizeTextRuns(rawRuns)
  const plainText = normalizedRuns.map((run) => run.text).join('')
  if (!plainText) {
    return undefined
  }

  const decodedRuns = decodeLegacyUnicodeTextRuns(normalizedRuns, plainText)
  const finalRuns = decodedRuns ?? normalizedRuns
  const finalPlainText = finalRuns.map((run) => run.text).join('')
  if (!finalPlainText) {
    return undefined
  }

  let start = 0
  const runs = finalRuns.map((run) => {
    const positioned: EveFormattedTextRun = run.color
      ? { color: run.color, start, text: run.text }
      : { start, text: run.text }
    start += run.text.length
    return positioned
  })
  return { plainText: finalPlainText, runs }
}

export function eveFormattedTextToPlainText(
  formattedText: string | undefined | null,
): string | undefined {
  return parseEveFormattedText(formattedText)?.plainText
}

interface TextRun {
  color?: string
  text: string
}

interface TagFrame {
  color?: string
  name: string
}

interface ParsedTag {
  closing: boolean
  end: number
  name?: string
  nameEnd?: number
}

type AttributeScanResult = { cursor: number } | { tagEnd: number }

function tokenizeTextRuns(value: string) {
  const runs: TextRun[] = []
  const frames: TagFrame[] = []
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor)
    if (start === -1) {
      appendTextRun(runs, decodeEveEntities(value.slice(cursor)), activeColor(frames))
      break
    }

    appendTextRun(runs, decodeEveEntities(value.slice(cursor, start)), activeColor(frames))
    const tag = parseTag(value, start)
    if (tag.end === -1) {
      break
    }
    if (!tag.name || tag.nameEnd === undefined) {
      cursor = tag.end + 1
      continue
    }

    applyParsedTag(runs, frames, value, start, tag, tag.name)
    cursor = tag.end + 1
  }
  return runs
}

function applyParsedTag(
  runs: TextRun[],
  frames: TagFrame[],
  value: string,
  start: number,
  tag: ParsedTag,
  name: string,
) {
  if (tag.closing) {
    closeTagFrame(frames, name)
    return
  }
  if (name === 'br' && isLineBreakTag(value, start, tag.end)) {
    appendTextRun(runs, '\n', activeColor(frames))
    return
  }
  if (name === 't' && isExactTag(value, start, tag.end, 't')) {
    appendTextRun(runs, '\t', activeColor(frames))
    return
  }
  if (voidTags.has(name)) {
    return
  }

  const color = readTagColor(value, tag)
  frames.push({ name, ...(color && { color }) })
}

function parseTag(value: string, start: number): ParsedTag {
  const end = findTagEnd(value, start)
  if (end === -1) {
    return { closing: false, end }
  }

  const closing = value[start + 1] === '/'
  const nameStart = start + (closing ? 2 : 1)
  if (!isAsciiLetter(value.codePointAt(nameStart))) {
    return { closing, end }
  }

  let nameEnd = nameStart + 1
  while (isAsciiAlphaNumeric(value.codePointAt(nameEnd))) {
    nameEnd += 1
  }
  return { closing, end, name: value.slice(nameStart, nameEnd).toLowerCase(), nameEnd }
}

function readTagColor(value: string, tag: ParsedTag) {
  if (!tag.name || tag.nameEnd === undefined) {
    return
  }
  if (tag.name === 'color' && value[tag.nameEnd] === '=') {
    return parseEveColor(readAttributeValue(value, tag.nameEnd + 1, tag.end)?.value)
  }
  if (tag.name !== 'font') {
    return
  }

  return readFontTagColor(value, tag.nameEnd, tag.end)
}

function readFontTagColor(value: string, initialCursor: number, tagEnd: number) {
  let cursor = initialCursor
  while (cursor < tagEnd) {
    const attribute = readTagAttribute(value, cursor, tagEnd)
    if (!attribute) {
      return
    }
    if (attribute.key === 'color') {
      return parseEveColor(attribute.value)
    }
    cursor = attribute.end
  }
  return
}

function readTagAttribute(value: string, initialCursor: number, tagEnd: number) {
  const keyStart = skipAttributeWhitespace(value, initialCursor)
  if (keyStart === initialCursor) {
    return
  }

  let separator = keyStart
  while (separator < tagEnd && value[separator] !== '=') {
    separator += 1
  }
  if (separator === tagEnd) {
    return
  }

  const attribute = readAttributeValue(value, separator + 1, tagEnd)
  if (!attribute) {
    return
  }
  return {
    end: attribute.end,
    key: value.slice(keyStart, separator).trim().toLowerCase(),
    value: attribute.value,
  }
}

function readAttributeValue(value: string, start: number, tagEnd: number) {
  const quote = value[start]
  if (quote === "'" || quote === '"') {
    const end = value.indexOf(quote, start + 1)
    if (end === -1 || end > tagEnd) {
      return
    }
    return { end: end + 1, value: value.slice(start + 1, end) }
  }

  let end = start
  while (end < tagEnd && !isAttributeBoundary(value, end)) {
    end += 1
  }
  return { end, value: value.slice(start, end) }
}

function parseEveColor(value: string | undefined) {
  if (!value) {
    return
  }
  const lower = value.toLowerCase()
  let alphaRedGreenBlue = namedEveColors.get(lower)
  if (!alphaRedGreenBlue) {
    const withoutLongSuffix = lower.endsWith('l') ? lower.slice(0, -1) : lower
    if (withoutLongSuffix.startsWith('0x')) {
      alphaRedGreenBlue = withoutLongSuffix.slice(2)
    } else if (withoutLongSuffix.startsWith('#')) {
      alphaRedGreenBlue = withoutLongSuffix.slice(1)
    }
  }
  if (!alphaRedGreenBlue || !isEightHexDigits(alphaRedGreenBlue)) {
    return
  }
  const alpha = alphaRedGreenBlue.slice(0, 2)
  const redGreenBlue = alphaRedGreenBlue.slice(2)
  return `#${redGreenBlue}${alpha}`
}

function isEightHexDigits(value: string) {
  if (value.length !== 8) {
    return false
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index)
    if (code === undefined) {
      return false
    }
    const isDigit = code >= 48 && code <= 57
    const isLowerHex = code >= 97 && code <= 102
    if (!isDigit && !isLowerHex) {
      return false
    }
  }
  return true
}

function closeTagFrame(frames: TagFrame[], name: string) {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index]!.name !== name) {
      continue
    }
    frames.splice(index)
    return
  }
}

function activeColor(frames: readonly TagFrame[]) {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const color = frames[index]!.color
    if (color) {
      return color
    }
  }
  return
}

function appendTextRun(runs: TextRun[], text: string, color: string | undefined) {
  if (!text) {
    return
  }
  const previous = runs.at(-1)
  if (previous && previous.color === color) {
    previous.text += text
    return
  }
  runs.push({ text, ...(color && { color }) })
}

function normalizeTextRuns(runs: readonly TextRun[]) {
  const collapsed: TextRun[] = []
  for (const run of runs) {
    let text = run.text.replaceAll(/\n{3,}/g, '\n\n')
    const previousNewlines = trailingNewlineCount(collapsed.at(-1)?.text ?? '')
    const leadingNewlines = leadingNewlineCount(text)
    const excessNewlines = Math.max(0, previousNewlines + leadingNewlines - 2)
    if (excessNewlines) {
      text = text.slice(excessNewlines)
    }
    appendTextRun(collapsed, text, run.color)
  }

  return trimTextRuns(collapsed)
}

function leadingNewlineCount(value: string) {
  let count = 0
  while (value[count] === '\n') {
    count += 1
  }
  return count
}

function trailingNewlineCount(value: string) {
  let count = 0
  while (value[value.length - 1 - count] === '\n') {
    count += 1
  }
  return count
}

function sliceTextRuns(runs: readonly TextRun[], start: number, end: number) {
  const sliced: TextRun[] = []
  let offset = 0
  for (const run of runs) {
    const runEnd = offset + run.text.length
    const sliceStart = Math.max(start, offset) - offset
    const sliceEnd = Math.min(end, runEnd) - offset
    if (sliceStart < sliceEnd) {
      appendTextRun(sliced, run.text.slice(sliceStart, sliceEnd), run.color)
    }
    offset = runEnd
  }
  return sliced
}

function trimTextRuns(runs: readonly TextRun[]) {
  const plainText = runs.map((run) => run.text).join('')
  const start = plainText.length - plainText.trimStart().length
  const end = plainText.trimEnd().length
  return sliceTextRuns(runs, start, end)
}

function decodeEveEntities(value: string) {
  return value.replaceAll(/&(?:amp|gt|lt|nbsp);/gi, (entity) => {
    const name = entity.slice(1, -1).toLowerCase()
    return eveEntities.get(name)!
  })
}

// `codePointAt` reports undefined past the end of the string, which callers rely on to stop scanning.
function isAsciiLetter(code: number | undefined) {
  if (code === undefined) {
    return false
  }
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isAsciiAlphaNumeric(code: number | undefined) {
  if (code === undefined) {
    return false
  }
  return isAsciiLetter(code) || (code >= 48 && code <= 57)
}

function findTagEnd(value: string, start: number) {
  const attributeValue = attributeValueStart(value, start)
  if (attributeValue) {
    return findAttributeTagEnd(value, ...attributeValue)
  }
  return value.indexOf('>', start + 1)
}

function attributeValueStart(
  value: string,
  start: number,
): [cursor: number, valuePending: boolean] | undefined {
  const first = value[start + 1]?.toLowerCase()
  switch (first) {
    case 'a':
      return [start + 2, false]
    case 'c':
      return matchingAttributePrefix(value, start, 'color=', 7, true)
    case 'f':
      return fontAttributeValueStart(value, start)
    case 'h':
      return matchingAttributePrefix(value, start, 'hint=', 6, true)
    case 'l':
      return (
        matchingAttributePrefix(value, start, 'localized', 10, false) ??
        matchingAttributePrefix(value, start, 'letterspace=', 13, true)
      )
    case 'u':
      return urlAttributeValueStart(value, start)
    default:
      return undefined
  }
}

function matchingAttributePrefix(
  value: string,
  start: number,
  prefix: string,
  cursorOffset: number,
  valuePending: boolean,
): [cursor: number, valuePending: boolean] | undefined {
  return startsWithIgnoreCase(value, start + 1, prefix)
    ? [start + cursorOffset, valuePending]
    : undefined
}

function fontAttributeValueStart(
  value: string,
  start: number,
): [cursor: number, valuePending: boolean] | undefined {
  if (!startsWithIgnoreCase(value, start + 1, 'font')) {
    return undefined
  }
  if (startsWithIgnoreCase(value, start + 1, 'fontsize=')) {
    return [start + 10, true]
  }
  if (value[start + 5]?.toLowerCase() === 's') {
    return undefined
  }
  return [start + 5, false]
}

function urlAttributeValueStart(
  value: string,
  start: number,
): [cursor: number, valuePending: boolean] | undefined {
  if (!startsWithIgnoreCase(value, start + 1, 'url')) {
    return undefined
  }

  const separator = value[start + 4]
  if (separator !== '=' && separator !== ':') {
    return undefined
  }
  return [start + 5, true]
}

function findAttributeTagEnd(value: string, initialCursor: number, initialValuePending: boolean) {
  let cursor = initialCursor
  let valuePending = initialValuePending

  while (cursor < value.length) {
    const valueStart: AttributeScanResult = valuePending
      ? { cursor }
      : scanAttributeName(value, cursor)
    if ('tagEnd' in valueStart) {
      return valueStart.tagEnd
    }

    const valueEnd = scanAttributeValue(value, valueStart.cursor)
    if ('tagEnd' in valueEnd) {
      return valueEnd.tagEnd
    }
    cursor = valueEnd.cursor

    if (value[cursor] === '>') {
      return cursor
    }
    valuePending = false
  }

  return -1
}

function scanAttributeName(value: string, initialCursor: number): AttributeScanResult {
  const cursor = skipAttributeWhitespace(value, initialCursor)
  if (cursor === initialCursor) {
    return { tagEnd: value.indexOf('>', cursor) }
  }

  let separator = cursor
  while (separator < value.length) {
    if (value[separator] === '=') {
      return { cursor: separator + 1 }
    }
    if (value[separator] === '>') {
      return { tagEnd: separator }
    }
    separator += 1
  }
  return { tagEnd: -1 }
}

function scanAttributeValue(value: string, initialCursor: number): AttributeScanResult {
  const quote = value[initialCursor] ?? ''
  if (quoteCharacters.has(quote)) {
    const closingQuote = value.indexOf(quote, initialCursor + 1)
    if (closingQuote === -1) {
      return { tagEnd: value.indexOf('>', initialCursor) }
    }
    return { cursor: closingQuote + 1 }
  }

  let cursor = initialCursor
  while (cursor < value.length && !isAttributeBoundary(value, cursor)) {
    cursor += 1
  }
  if (cursor === value.length) {
    return { tagEnd: -1 }
  }
  return { cursor }
}

function skipAttributeWhitespace(value: string, initialCursor: number) {
  let cursor = initialCursor
  while (cursor < value.length) {
    if (value[cursor] === ' ' || value[cursor] === '\t') {
      cursor += 1
      continue
    }
    if (startsWithIgnoreCase(value, cursor, '&nbsp;')) {
      cursor += 6
      continue
    }
    break
  }
  return cursor
}

function isAttributeBoundary(value: string, cursor: number) {
  const character = value[cursor]
  return (
    character === ' ' ||
    character === '\t' ||
    character === '>' ||
    startsWithIgnoreCase(value, cursor, '&nbsp;')
  )
}

function startsWithIgnoreCase(value: string, start: number, expected: string) {
  return value.slice(start, start + expected.length).toLowerCase() === expected
}

function isLineBreakTag(value: string, start: number, end: number) {
  if (value.slice(start + 1, start + 3).toLowerCase() !== 'br') {
    return false
  }

  let cursor = start + 3
  while (cursor < end) {
    const character = value[cursor]
    if (character === ' ' || character === '\t') {
      cursor += 1
      continue
    }
    if (value.slice(cursor, cursor + 6).toLowerCase() === '&nbsp;') {
      cursor += 6
      continue
    }
    break
  }

  return cursor === end || (value[cursor] === '/' && cursor + 1 === end)
}

function isExactTag(value: string, start: number, end: number, name: string) {
  return value.slice(start + 1, end).toLowerCase() === name
}

function decodeLegacyUnicodeTextRuns(runs: readonly TextRun[], plainText: string) {
  const body = legacyUnicodeBody(plainText)
  if (body === undefined) {
    return
  }

  const bodyRuns = sliceTextRuns(runs, 2, plainText.length - 1)
  const decoded: TextRun[] = []
  let runIndex = 0
  let runEnd = bodyRuns[0]?.text.length ?? 0
  for (let index = 0; index < body.length; index += 1) {
    while (index >= runEnd && runIndex < bodyRuns.length - 1) {
      runIndex += 1
      runEnd += bodyRuns[runIndex]!.text.length
    }

    const character = body[index]!
    if (character !== '\\' || index === body.length - 1) {
      appendTextRun(decoded, character, bodyRuns[runIndex]?.color)
      continue
    }

    const [escaped, consumed] = decodeEscape(body, index + 1)
    appendTextRun(decoded, escaped, bodyRuns[runIndex]?.color)
    index += consumed
  }
  return trimTextRuns(decoded)
}

function legacyUnicodeBody(value: string) {
  if (value.length < 3 || !legacyUnicodePrefixes.has(value[0]!)) {
    return
  }

  const quote = value[1]!
  if (!quoteCharacters.has(quote) || value.at(-1) !== quote) {
    return
  }
  return value.slice(2, -1)
}

function decodeEscape(body: string, escapeIndex: number): [value: string, consumed: number] {
  const escape = body[escapeIndex]!
  const digits = unicodeEscapeLengths.get(escape)
  if (digits !== undefined) {
    const hex = body.slice(escapeIndex + 1, escapeIndex + 1 + digits)
    if (hex.length === digits && /^[0-9a-f]+$/i.test(hex)) {
      const codePoint = Number.parseInt(hex, 16)
      if (digits === 4 || codePoint <= 0x10_ff_ff) {
        return [String.fromCodePoint(codePoint), digits + 1]
      }
    }
  }

  return [escapedCharacters.get(escape) ?? `\\${escape}`, 1]
}
