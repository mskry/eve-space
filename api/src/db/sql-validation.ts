const dollarQuoteDelimiterPattern = /^\$[A-Za-z_]\w*\$|^\$\$/

interface MaskSqlOptions {
  readonly preserveQuotedIdentifiers?: boolean
  readonly rejectUnterminated?: boolean
}

export function maskSqlLiteralsAndComments(sql: string, options: MaskSqlOptions = {}) {
  let result = ''
  let index = 0

  while (index < sql.length) {
    const skipped =
      skipLineComment(sql, index) ??
      skipBlockComment(sql, index, options.rejectUnterminated) ??
      skipSingleQuotedLiteral(sql, index, options.rejectUnterminated) ??
      skipDollarQuotedLiteral(sql, index, options.rejectUnterminated) ??
      skipQuotedIdentifier(sql, index, options.rejectUnterminated)
    if (skipped !== undefined) {
      result +=
        options.preserveQuotedIdentifiers && sql[index] === '"'
          ? sql.slice(index, skipped)
          : ' '.repeat(skipped - index)
      index = skipped
      continue
    }

    result += sql[index]
    index += 1
  }

  return result
}

function skipLineComment(sql: string, index: number) {
  if (!sql.startsWith('--', index)) return undefined
  const end = sql.indexOf('\n', index + 2)
  return end === -1 ? sql.length : end
}

function skipBlockComment(sql: string, index: number, rejectUnterminated = false) {
  if (!sql.startsWith('/*', index)) return undefined
  let depth = 1
  index += 2
  while (index < sql.length && depth > 0) {
    if (sql.startsWith('/*', index)) {
      depth += 1
      index += 2
    } else if (sql.startsWith('*/', index)) {
      depth -= 1
      index += 2
    } else {
      index += 1
    }
  }
  if (depth > 0 && rejectUnterminated) throw new Error('Unterminated SQL block comment.')
  return index
}

function skipSingleQuotedLiteral(sql: string, index: number, rejectUnterminated = false) {
  if (sql[index] !== "'") return undefined
  return skipQuoted(sql, index, "'", rejectUnterminated)
}

function skipQuotedIdentifier(sql: string, index: number, rejectUnterminated = false) {
  if (sql[index] !== '"') return undefined
  return skipQuoted(sql, index, '"', rejectUnterminated)
}

function skipQuoted(sql: string, index: number, quote: string, rejectUnterminated: boolean) {
  index += 1
  while (index < sql.length) {
    if (sql[index] === quote && sql[index + 1] === quote) {
      index += 2
      continue
    }
    if (sql[index] === quote) return index + 1
    index += 1
  }
  if (rejectUnterminated)
    throw new Error(`Unterminated SQL ${quote === "'" ? 'string literal' : 'quoted identifier'}.`)
  return index
}

function skipDollarQuotedLiteral(sql: string, index: number, rejectUnterminated = false) {
  if (sql[index] !== '$') return undefined

  const delimiter = dollarQuoteDelimiterPattern.exec(sql.slice(index))?.[0]
  if (!delimiter) return undefined

  const end = sql.indexOf(delimiter, index + delimiter.length)
  if (end === -1) {
    if (rejectUnterminated) throw new Error(`Unterminated SQL dollar-quoted literal ${delimiter}.`)
    return sql.length
  }
  return end + delimiter.length
}
