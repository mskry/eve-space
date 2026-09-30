export interface MarketSourcePage<Data> {
  readonly data: readonly Data[]
  readonly pages: number
  readonly validatedAt: string
  readonly freshUntil: string
}

export const collectMarketPages = async <Data>(input: {
  readonly loadPage: (page: number, signal?: AbortSignal) => Promise<MarketSourcePage<Data>>
  readonly maximumPages: number
  readonly maximumConcurrentPages: number
  readonly signal?: AbortSignal
}) => {
  input.signal?.throwIfAborted()
  const first = await input.loadPage(1, input.signal)
  const expectedPages = first.pages
  if (
    !Number.isSafeInteger(expectedPages) ||
    expectedPages < 1 ||
    expectedPages > input.maximumPages
  ) {
    throw new RangeError('Market book exceeds the page bound')
  }
  const pages: MarketSourcePage<Data>[] = [first]
  const cancellation = new AbortController()
  const signal = input.signal
    ? AbortSignal.any([input.signal, cancellation.signal])
    : cancellation.signal
  let next = 2
  const collect = async (): Promise<void> => {
    signal.throwIfAborted()
    const number = next++
    if (number > expectedPages) return
    try {
      const loaded = await input.loadPage(number, signal)
      if (loaded.pages !== expectedPages || loaded.data.length > 1_000) {
        throw new Error('Market page changed pagination or exceeded its row bound')
      }
      pages[number - 1] = loaded
    } catch (error) {
      cancellation.abort()
      throw error
    }
    return collect()
  }
  const outcomes = await Promise.allSettled(
    Array.from({ length: Math.min(expectedPages - 1, input.maximumConcurrentPages) }, collect),
  )
  const failure = outcomes.find((outcome) => outcome.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  let earliest = Number.POSITIVE_INFINITY
  let latest = Number.NEGATIVE_INFINITY
  let freshness = Number.POSITIVE_INFINITY
  for (const [index, page] of pages.entries()) {
    if (!page || page.pages !== expectedPages || page.data.length > 1_000) {
      throw new Error(`Market page ${index + 1} is incomplete`)
    }
    const validatedAt = new Date(page.validatedAt).getTime()
    const freshUntil = new Date(page.freshUntil).getTime()
    if (
      !Number.isFinite(validatedAt) ||
      !Number.isFinite(freshUntil) ||
      freshUntil <= validatedAt
    ) {
      throw new Error('Market page has invalid freshness metadata')
    }
    earliest = Math.min(earliest, validatedAt)
    latest = Math.max(latest, validatedAt)
    freshness = Math.min(freshness, freshUntil)
  }
  if (latest - earliest > 60_000)
    throw new Error('Market pages exceed the coherent observation window')
  return {
    pages,
    expectedPages,
    observedAt: new Date(earliest).toISOString(),
    validatedAt: new Date(latest).toISOString(),
    freshUntil: new Date(freshness).toISOString(),
  }
}
