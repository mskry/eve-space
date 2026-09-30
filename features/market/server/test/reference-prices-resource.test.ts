import { expect, test, vi } from 'vitest'
import { marketReferencePricesResource } from '../src/reference-prices-resource.js'

test('maps validated ESI reference values and preserves their non-executable class', async () => {
  expect(
    marketReferencePricesResource.request({
      kind: 'deployment',
      deploymentId: 1,
      lifecycleId: 'lifecycle',
    }),
  ).toStrictEqual({})
  const mapped = await marketReferencePricesResource.map({
    data: [
      { type_id: 34, adjusted_price: 6.42 },
      { type_id: 35, average_price: 7 },
    ],
    subject: { kind: 'deployment', deploymentId: 1, lifecycleId: 'lifecycle' },
    capabilities: { coreData: {} },
  })
  expect(mapped).toStrictEqual([
    { typeId: 34, adjustedPriceIsk: '6.42', averagePriceIsk: null },
    { typeId: 35, adjustedPriceIsk: null, averagePriceIsk: '7.00' },
  ])
  const upsertMarketReferencePrices = vi.fn().mockResolvedValue({ outcome: 'applied' })
  await marketReferencePricesResource.materialize({
    data: mapped,
    validatedAt: '2026-09-28T12:34:56Z',
    subject: { kind: 'deployment', deploymentId: 1, lifecycleId: 'lifecycle' },
    authorizationGeneration: null,
    organizationVersion: null,
    managedAuthority: null,
    capabilities: {
      persistence: { upsertMarketReferencePrices },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
  })
  expect(upsertMarketReferencePrices).toHaveBeenCalledWith({
    observedHour: '2026-09-28T12:00:00.000Z',
    validatedAt: '2026-09-28T12:34:56Z',
    prices: mapped,
  })
})
