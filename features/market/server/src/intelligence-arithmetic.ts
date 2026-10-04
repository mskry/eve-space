export interface IntelligenceFraction {
  readonly numerator: bigint
  readonly denominator: bigint
}

export const intelligenceDecimal = (fraction: IntelligenceFraction): string => {
  if (fraction.denominator <= 0n) throw new RangeError('A positive denominator is required')
  const scaled = (fraction.numerator * 1_000_000n) / fraction.denominator
  const absolute = scaled < 0n ? -scaled : scaled
  const sign = scaled < 0n ? '-' : ''
  return `${sign}${absolute / 1_000_000n}.${String(absolute % 1_000_000n).padStart(6, '0')}`
}

export const intelligenceDifferencePercent = (
  value: IntelligenceFraction,
  baseline: IntelligenceFraction,
): IntelligenceFraction => ({
  numerator:
    (value.numerator * baseline.denominator - baseline.numerator * value.denominator) * 100n,
  denominator: value.denominator * baseline.numerator,
})

export const intelligenceRatio = (
  value: IntelligenceFraction,
  baseline: IntelligenceFraction,
): IntelligenceFraction => ({
  numerator: value.numerator * baseline.denominator,
  denominator: value.denominator * baseline.numerator,
})
