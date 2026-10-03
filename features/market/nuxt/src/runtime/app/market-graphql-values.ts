export const marketSafeInteger = (value: string) => {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('Unsupported Market integer.')
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error('Market value exceeds the supported range.')
  return result
}

export const marketKnownState = <State extends string>(
  value: string,
  states: readonly State[],
): State => {
  const state = states.find((candidate) => candidate === value)
  if (!state) throw new Error('Unsupported Market state.')
  return state
}

export const marketSafeTotal = (values: readonly number[]) => {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Market total exceeds the supported range.')
}

export const marketExactPrice = (price: string) => {
  if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(price)) throw new Error('Unsupported Market price precision.')
  return price
}
