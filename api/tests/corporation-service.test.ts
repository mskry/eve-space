import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPublicInfo: vi.fn(),
  listAllianceHistory: vi.fn(),
  listNpcCorporations: vi.fn(),
  resolveNames: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/corporation', () => ({
  createCorporationClient: () => ({
    withMetadata: () => ({
      getPublicInfo: mocks.getPublicInfo,
      listAllianceHistory: mocks.listAllianceHistory,
      listNpcCorporations: mocks.listNpcCorporations,
    }),
  }),
}))

vi.mock('@evespace/esi-client/domains/universe', () => ({
  createUniverseClient: () => ({
    withMetadata: () => ({ resolveNames: mocks.resolveNames }),
  }),
}))

vi.mock('../src/esi-fetch.js', () => ({ esiFetch: vi.fn() }))

let service: typeof import('../src/corporation-service.js')

const publicInfo = { name: 'Test Corporation', ticker: 'TEST', member_count: 10 }

function metadata(overrides: Record<string, unknown> = {}) {
  return { status: 200, headers: {}, ...overrides }
}

function esiResponse<Data>(data: Data, meta = metadata()) {
  return { data, meta }
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-22T12:00:00.000Z'))
  vi.resetModules()
  mocks.getPublicInfo.mockReset().mockResolvedValue(esiResponse(publicInfo))
  mocks.listAllianceHistory.mockReset().mockResolvedValue(esiResponse([]))
  mocks.listNpcCorporations.mockReset().mockResolvedValue(esiResponse([]))
  mocks.resolveNames.mockReset().mockResolvedValue(esiResponse([]))
  service = await import('../src/corporation-service.js')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('corporation service', () => {
  test('uses ESI expiry metadata before making another detail request', async () => {
    mocks.getPublicInfo
      .mockResolvedValueOnce(
        esiResponse(publicInfo, metadata({ cache: { expires: '2026-08-22T12:00:30.000Z' } })),
      )
      .mockResolvedValueOnce(esiResponse({ ...publicInfo, name: 'Refreshed Corporation' }))

    await service.getCorporationPublic(90_000_001)
    await service.getCorporationPublic(90_000_001)
    expect(mocks.getPublicInfo).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(30_000)
    await expect(service.getCorporationPublic(90_000_001)).resolves.toMatchObject({
      name: 'Refreshed Corporation',
    })
    expect(mocks.getPublicInfo).toHaveBeenCalledTimes(2)
  })

  test('uses cache-control and the documented fallback cache lifetime', async () => {
    mocks.getPublicInfo
      .mockResolvedValueOnce(
        esiResponse(publicInfo, metadata({ cache: { cacheControl: 'max-age=30' } })),
      )
      .mockResolvedValueOnce(esiResponse({ ...publicInfo, name: 'Cache-Control Refresh' }))
      .mockResolvedValueOnce(esiResponse(publicInfo))
      .mockResolvedValueOnce(esiResponse({ ...publicInfo, name: 'Fallback Refresh' }))

    await service.getCorporationPublic(90_000_002)
    await vi.advanceTimersByTimeAsync(30_000)
    await service.getCorporationPublic(90_000_002)
    await service.getCorporationPublic(90_000_003)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await expect(service.getCorporationPublic(90_000_003)).resolves.toMatchObject({
      name: 'Fallback Refresh',
    })

    expect(mocks.getPublicInfo).toHaveBeenCalledTimes(4)
  })

  test('collapses concurrent detail, alliance-history, and NPC requests', async () => {
    let resolveDetail!: (value: ReturnType<typeof esiResponse<typeof publicInfo>>) => void
    let resolveHistory!: (value: ReturnType<typeof esiResponse<[]>>) => void
    let resolveNpc!: (value: ReturnType<typeof esiResponse<number[]>>) => void
    mocks.getPublicInfo.mockImplementation(
      () => new Promise((resolve) => (resolveDetail = resolve)),
    )
    mocks.listAllianceHistory.mockImplementation(
      () => new Promise((resolve) => (resolveHistory = resolve)),
    )
    mocks.listNpcCorporations.mockImplementation(
      () => new Promise((resolve) => (resolveNpc = resolve)),
    )

    const detail = Promise.all([
      service.getCorporationPublic(90_000_004),
      service.getCorporationPublic(90_000_004),
    ])
    const history = Promise.all([
      service.getCorporationAllianceHistory(90_000_005),
      service.getCorporationAllianceHistory(90_000_005),
    ])
    const npc = Promise.all([service.getNpcCorporations(), service.getNpcCorporations()])

    expect(mocks.getPublicInfo).toHaveBeenCalledOnce()
    expect(mocks.listAllianceHistory).toHaveBeenCalledOnce()
    expect(mocks.listNpcCorporations).toHaveBeenCalledOnce()
    resolveDetail(esiResponse(publicInfo))
    resolveHistory(esiResponse([]))
    resolveNpc(esiResponse([1]))
    await expect(detail).resolves.toHaveLength(2)
    await expect(history).resolves.toEqual([[], []])
    await expect(npc).resolves.toEqual([[1], [1]])
  })

  test.each([404, 422])('negative-caches status %i corporation lookups', async (status) => {
    mocks.getPublicInfo.mockRejectedValue({ status })
    const corporationId = 90_000_000 + status

    await expect(service.getCorporationPublic(corporationId)).rejects.toMatchObject({ status })
    await expect(service.getCorporationPublic(corporationId)).rejects.toMatchObject({ status: 404 })
    expect(mocks.getPublicInfo).toHaveBeenCalledOnce()
  })

  test('shares in-flight detail work after another operation begins a cooldown', async () => {
    let resolveDetail!: (value: ReturnType<typeof esiResponse<typeof publicInfo>>) => void
    mocks.getPublicInfo.mockImplementation(
      () => new Promise((resolve) => (resolveDetail = resolve)),
    )
    mocks.listAllianceHistory.mockResolvedValue(
      esiResponse([], metadata({ errorLimit: { remaining: 10, reset: 30 } })),
    )

    const first = service.getCorporationPublic(90_000_006)
    await service.getCorporationAllianceHistory(90_000_007)
    const second = service.getCorporationPublic(90_000_006)
    resolveDetail(esiResponse(publicInfo))

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(mocks.getPublicInfo).toHaveBeenCalledOnce()
  })

  test('propagates a detail 429 cooldown and permits work after it expires', async () => {
    mocks.getPublicInfo
      .mockRejectedValueOnce({
        status: 429,
        metadata: metadata({ headers: { 'retry-after': '30' } }),
      })
      .mockResolvedValueOnce(esiResponse(publicInfo))

    await expect(service.getCorporationPublic(90_000_008)).rejects.toEqual(
      new service.CorporationEsiCooldownError(30),
    )
    await expect(service.getCorporationAllianceHistory(90_000_009)).rejects.toEqual(
      new service.CorporationEsiCooldownError(30),
    )
    await vi.advanceTimersByTimeAsync(30_000)
    await service.getCorporationPublic(90_000_010)

    expect(mocks.getPublicInfo).toHaveBeenCalledTimes(2)
    expect(mocks.listAllianceHistory).not.toHaveBeenCalled()
  })

  test('applies a low error-budget cooldown from corporation detail', async () => {
    mocks.getPublicInfo.mockResolvedValue(
      esiResponse(publicInfo, metadata({ errorLimit: { remaining: 10, reset: 25 } })),
    )

    await service.getCorporationPublic(90_000_017)
    await expect(service.getCorporationAllianceHistory(90_000_018)).rejects.toEqual(
      new service.CorporationEsiCooldownError(25),
    )
    expect(mocks.listAllianceHistory).not.toHaveBeenCalled()
  })

  test('propagates an alliance-history 429 cooldown', async () => {
    mocks.listAllianceHistory.mockRejectedValue({
      status: 429,
      metadata: metadata({ headers: { 'retry-after': '35' } }),
    })

    await expect(service.getCorporationAllianceHistory(90_000_019)).rejects.toEqual(
      new service.CorporationEsiCooldownError(35),
    )
    await expect(service.getNpcCorporations()).rejects.toEqual(
      new service.CorporationEsiCooldownError(35),
    )
    expect(mocks.listNpcCorporations).not.toHaveBeenCalled()
  })

  test('applies low-budget cooldowns from alliance history and NPC metadata', async () => {
    mocks.listAllianceHistory.mockResolvedValue(
      esiResponse([], metadata({ errorLimit: { remaining: 10, reset: 20 } })),
    )

    await service.getCorporationAllianceHistory(90_000_011)
    await expect(service.getNpcCorporations()).rejects.toEqual(
      new service.CorporationEsiCooldownError(20),
    )

    await vi.advanceTimersByTimeAsync(20_000)
    mocks.listNpcCorporations.mockRejectedValue({
      status: 429,
      metadata: metadata({ headers: { 'retry-after': '40' } }),
    })
    await expect(service.getNpcCorporations()).rejects.toEqual(
      new service.CorporationEsiCooldownError(40),
    )
    await expect(service.getCorporationPublic(90_000_012)).rejects.toEqual(
      new service.CorporationEsiCooldownError(40),
    )
  })

  test('applies a low error-budget cooldown from NPC metadata', async () => {
    mocks.listNpcCorporations.mockResolvedValue(
      esiResponse([], metadata({ errorLimit: { remaining: 10, reset: 45 } })),
    )

    await service.getNpcCorporations()
    await expect(service.getCorporationPublic(90_000_020)).rejects.toEqual(
      new service.CorporationEsiCooldownError(45),
    )
    expect(mocks.getPublicInfo).not.toHaveBeenCalled()
  })

  test('serves a fresh detail cache entry while ESI is cooling down', async () => {
    mocks.getPublicInfo
      .mockResolvedValueOnce(
        esiResponse(publicInfo, metadata({ cache: { cacheControl: 'max-age=60' } })),
      )
      .mockRejectedValueOnce({
        status: 429,
        metadata: metadata({ headers: { 'retry-after': '30' } }),
      })

    await service.getCorporationPublic(90_000_013)
    await expect(service.getCorporationPublic(90_000_014)).rejects.toEqual(
      new service.CorporationEsiCooldownError(30),
    )
    await expect(service.getCorporationPublic(90_000_013)).resolves.toMatchObject({
      name: 'Test Corporation',
    })

    expect(mocks.getPublicInfo).toHaveBeenCalledTimes(2)
  })

  test('retains valid alliance names when a 404 name batch contains one unavailable ID', async () => {
    mocks.listAllianceHistory.mockResolvedValue(
      esiResponse([
        { alliance_id: 40, is_deleted: false, record_id: 3, start_date: '2024-01-01T00:00:00Z' },
        { alliance_id: 50, is_deleted: false, record_id: 2, start_date: '2023-01-01T00:00:00Z' },
        { alliance_id: 60, is_deleted: false, record_id: 1, start_date: '2022-01-01T00:00:00Z' },
      ]),
    )
    mocks.resolveNames.mockImplementation(async ({ body }: { body: number[] }) => {
      if (body.includes(50)) throw { status: 404 }
      return esiResponse(body.map((id) => ({ id, name: `Alliance ${id}` })))
    })

    await expect(service.getCorporationAllianceHistory(90_000_015)).resolves.toMatchObject([
      { allianceName: 'Alliance 40' },
      { allianceName: null },
      { allianceName: 'Alliance 60' },
    ])
    expect(mocks.resolveNames).toHaveBeenCalledTimes(5)
  })

  test('does not split transient or quota name-resolution failures', async () => {
    mocks.getPublicInfo.mockResolvedValue(
      esiResponse({
        ...publicInfo,
        ceo_id: 11,
        creator_id: 12,
        alliance_id: 13,
        home_station_id: 14,
      }),
    )
    mocks.resolveNames.mockRejectedValue({
      status: 429,
      metadata: metadata({ headers: { 'retry-after': '30' } }),
    })

    await expect(service.getCorporationPublic(90_000_016)).resolves.toMatchObject({
      ceoName: null,
      creatorName: null,
      allianceName: null,
    })
    expect(mocks.resolveNames).toHaveBeenCalledOnce()
    await expect(service.getNpcCorporations()).rejects.toEqual(
      new service.CorporationEsiCooldownError(30),
    )
  })

  test('applies a low error-budget cooldown from successful name resolution', async () => {
    mocks.getPublicInfo.mockResolvedValue(esiResponse({ ...publicInfo, ceo_id: 11 }))
    mocks.resolveNames.mockResolvedValue(
      esiResponse(
        [{ id: 11, name: 'Chief Executive' }],
        metadata({
          errorLimit: { remaining: 10, reset: 20 },
        }),
      ),
    )

    await expect(service.getCorporationPublic(90_000_021)).resolves.toMatchObject({
      ceoName: 'Chief Executive',
    })
    await expect(service.getNpcCorporations()).rejects.toEqual(
      new service.CorporationEsiCooldownError(20),
    )
  })
})
