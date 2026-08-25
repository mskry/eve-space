import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPublic: vi.fn(),
  resolveNames: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/universe', () => ({
  createUniverseClient: () => ({ withMetadata: () => ({ resolveNames: mocks.resolveNames }) }),
}))
vi.mock('../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getPublic: mocks.getPublic }),
}))
vi.mock('../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))

beforeEach(() => {
  mocks.getPublic.mockImplementation(async (resource) => {
    const loaded = await resource.load({ ifNoneMatch: '"names"' })
    return { data: loaded.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
  })
})

describe('universe name resolver', () => {
  test('deduplicates canonical set inputs and passes conditional validators', async () => {
    mocks.resolveNames.mockResolvedValue(
      response([
        { category: 'corporation', id: 2, name: 'Second' },
        { category: 'corporation', id: 1, name: 'First' },
      ]),
    )
    const { resolveUniverseNames } = await import('../src/universe-names-service.js')

    const names = await resolveUniverseNames([2, 1, 2])

    expect([...names.keys()]).toEqual([2, 1])
    expect(mocks.getPublic.mock.calls[0]?.[0]).toMatchObject({
      operation: 'universe-resolve-names',
      inputs: { ids: [2, 1] },
    })
    expect(mocks.resolveNames).toHaveBeenCalledWith({
      body: [2, 1],
      ifNoneMatch: '"names"',
    })
  })

  test('splits only unavailable identifier batches', async () => {
    mocks.resolveNames.mockImplementation(async ({ body }: { body: number[] }) => {
      if (body.length > 1) throw Object.assign(new Error('Unavailable identifier'), { status: 404 })
      return response([{ category: 'corporation', id: body[0], name: `Corporation ${body[0]}` }])
    })
    const { resolveUniverseNames } = await import('../src/universe-names-service.js')

    await expect(resolveUniverseNames([1, 2])).resolves.toSatisfy(
      (names: Map<number, unknown>) => names.size === 2,
    )
    expect(mocks.resolveNames).toHaveBeenCalledTimes(3)

    mocks.resolveNames
      .mockReset()
      .mockRejectedValue(Object.assign(new Error('Unavailable'), { status: 503 }))
    await expect(resolveUniverseNames([3, 4])).rejects.toMatchObject({ status: 503 })
    expect(mocks.resolveNames).toHaveBeenCalledOnce()
  })

  test('fails instead of returning partial names when the split budget is exhausted', async () => {
    mocks.resolveNames.mockRejectedValue(
      Object.assign(new Error('Unavailable identifier'), { status: 404 }),
    )
    const { resolveUniverseNames } = await import('../src/universe-names-service.js')

    await expect(
      resolveUniverseNames(Array.from({ length: 66 }, (_, index) => index + 1)),
    ).rejects.toMatchObject({ name: 'UniverseNameResolutionLimitError', status: 424 })
  })
})

function response<Data>(data: Data) {
  return { data, meta: { status: 200, headers: {} } }
}
