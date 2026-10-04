const semanticVersionNumberPattern = /^(?:0|[1-9]\d*)$/
const semanticVersionLooseIdentifiersPattern = /^[\dA-Za-z.-]+$/

interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

const parseSemanticVersion = (value: string): SemanticVersion | undefined => {
  const buildSeparator = value.indexOf('+')
  if (buildSeparator !== value.lastIndexOf('+')) {
    return undefined
  }
  const versionAndPrerelease = buildSeparator < 0 ? value : value.slice(0, buildSeparator)
  const build = buildSeparator < 0 ? undefined : value.slice(buildSeparator + 1)
  if (build !== undefined && !semanticVersionLooseIdentifiersPattern.test(build)) {
    return undefined
  }

  const prereleaseSeparator = versionAndPrerelease.indexOf('-')
  const core =
    prereleaseSeparator < 0
      ? versionAndPrerelease
      : versionAndPrerelease.slice(0, prereleaseSeparator)
  const prerelease =
    prereleaseSeparator < 0 ? undefined : versionAndPrerelease.slice(prereleaseSeparator + 1)
  if (prerelease !== undefined && !semanticVersionLooseIdentifiersPattern.test(prerelease)) {
    return undefined
  }
  const coreParts = core.split('.')
  if (
    coreParts.length !== 3 ||
    !coreParts.every((part) => semanticVersionNumberPattern.test(part))
  ) {
    return undefined
  }
  return {
    major: Number(coreParts[0]),
    minor: Number(coreParts[1]),
    patch: Number(coreParts[2]),
    prerelease: prerelease?.split('.') ?? [],
  }
}

const comparePrereleasePart = (left: string | undefined, right: string | undefined) => {
  if (left === undefined) {
    return -1
  }
  if (right === undefined) {
    return 1
  }
  if (left === right) {
    return 0
  }
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined
  if (leftNumber !== undefined && rightNumber !== undefined) {
    return Math.sign(leftNumber - rightNumber)
  }
  if (leftNumber !== undefined) {
    return -1
  }
  if (rightNumber !== undefined) {
    return 1
  }
  return left < right ? -1 : 1
}

const comparePrerelease = (left: readonly string[], right: readonly string[]) => {
  if (left.length === 0) {
    return right.length === 0 ? 0 : 1
  }
  if (right.length === 0) {
    return -1
  }
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const compared = comparePrereleasePart(left[index], right[index])
    if (compared !== 0) {
      return compared
    }
  }
  return 0
}

const compareSemanticVersion = (left: SemanticVersion, right: SemanticVersion) => {
  const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch
  if (core !== 0) {
    return Math.sign(core)
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

const caretUpperBound = (version: SemanticVersion): SemanticVersion => {
  if (version.major > 0) {
    return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] }
  }
  if (version.minor > 0) {
    return { major: 0, minor: version.minor + 1, patch: 0, prerelease: [] }
  }
  return { major: 0, minor: 0, patch: version.patch + 1, prerelease: [] }
}

const satisfiesUpperBound = (
  version: SemanticVersion,
  compared: number,
  upper: SemanticVersion,
) => {
  return compared >= 0 && compareSemanticVersion(version, upper) < 0
}

const satisfiesOrderedComparator = (operator: string, compared: number) => {
  switch (operator) {
    case '=':
      return compared === 0
    case '<':
      return compared < 0
    case '<=':
      return compared <= 0
    case '>':
      return compared > 0
    case '>=':
      return compared >= 0
    default:
      return false
  }
}

const satisfiesWildcard = (version: SemanticVersion, requested: string, operator: string) => {
  if (operator !== '=') {
    return false
  }
  const parts = requested.split('.')
  const actual = [version.major, version.minor, version.patch]
  return parts.every((part, index) =>
    part === '*' || part === 'x' || part === 'X' ? true : Number(part) === actual[index],
  )
}

const satisfiesComparator = (version: SemanticVersion, comparator: string) => {
  const match = /^(\^|~|<=|>=|<|>|=)?(.+)$/.exec(comparator)
  if (!match?.[2]) {
    return false
  }
  const operator = match[1] ?? '='
  const requested = parseSemanticVersion(match[2])
  if (!requested) {
    return satisfiesWildcard(version, match[2], operator)
  }
  const compared = compareSemanticVersion(version, requested)
  if (operator === '^') {
    return satisfiesUpperBound(version, compared, caretUpperBound(requested))
  }
  if (operator === '~') {
    const upper = { major: requested.major, minor: requested.minor + 1, patch: 0, prerelease: [] }
    return satisfiesUpperBound(version, compared, upper)
  }
  return satisfiesOrderedComparator(operator, compared)
}

export const semanticVersionSatisfies = (version: string, range: string) => {
  const parsedVersion = parseSemanticVersion(version)
  if (!parsedVersion) {
    return false
  }
  return range.split('||').some((alternative) =>
    alternative
      .trim()
      .split(/\s+/)
      .every((comparator) => satisfiesComparator(parsedVersion, comparator)),
  )
}

const minimumRequestedVersion = (value: string) => {
  const exact = parseSemanticVersion(value)
  if (exact) return exact
  const parts = value.split('.').map((part) => (['*', 'x', 'X'].includes(part) ? '0' : part))
  while (parts.length < 3) parts.push('0')
  return parseSemanticVersion(parts.join('.'))
}

const comparatorRequiresMinimum = (minimum: SemanticVersion, comparator: string) => {
  const match = /^(\^|~|>=|>|=)?([^<]+)$/.exec(comparator)
  if (!match?.[2]) return false
  const requested = minimumRequestedVersion(match[2])
  return !!requested && compareSemanticVersion(requested, minimum) >= 0
}

export const semanticVersionRangeRequires = (minimum: string, range: string) => {
  const parsedMinimum = parseSemanticVersion(minimum)
  if (!parsedMinimum) return false
  return range.split('||').every((alternative) =>
    alternative
      .trim()
      .split(/\s+/)
      .some((comparator) => comparatorRequiresMinimum(parsedMinimum, comparator)),
  )
}
