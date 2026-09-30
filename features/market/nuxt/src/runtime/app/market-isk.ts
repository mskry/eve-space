// A value that rounds to 1000.00 of one unit moves up, so 999,999.99 reads 1.00M rather than 1000.00K.
const compactUnits = [
  { cents: 100_000_000_000_000n, suffix: 'T' },
  { cents: 100_000_000_000n, suffix: 'B' },
  { cents: 100_000_000n, suffix: 'M' },
  { cents: 100_000n, suffix: 'K' },
] as const

export const marketPriceCents = (price: string) => {
  const [integer = '0', fraction = ''] = price.split('.')
  return BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'))
}

const roundToUnit = (cents: bigint, unit: (typeof compactUnits)[number]) => ({
  hundredths: (cents * 100n + unit.cents / 2n) / unit.cents,
  suffix: unit.suffix,
})

export const formatMarketIskAmount = (price: string) => {
  const [integer = '0', fraction = ''] = price.split('.')
  return `${new Intl.NumberFormat('en-US').format(BigInt(integer))}.${fraction.padEnd(2, '0')}`
}

export const formatMarketIsk = (price: string) => `${formatMarketIskAmount(price)} ISK`

export const formatMarketIskCompact = (price: string) => {
  const negative = price.startsWith('−') || price.startsWith('-')
  const unsigned = negative ? price.slice(1) : price
  const amount = unsigned.replaceAll(',', '')
  const cents = marketPriceCents(amount)
  const sign = negative ? '−' : ''
  const index = compactUnits.findIndex((unit) => cents >= unit.cents)
  if (index === -1) return `${sign}${formatMarketIskAmount(amount)}`
  const rounded = roundToUnit(cents, compactUnits[index]!)
  const promoted = rounded.hundredths >= 100_000n && index > 0
  const { hundredths, suffix } = promoted ? roundToUnit(cents, compactUnits[index - 1]!) : rounded
  return `${sign}${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}${suffix}`
}

export const marketCentsToIsk = (cents: bigint) =>
  `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
