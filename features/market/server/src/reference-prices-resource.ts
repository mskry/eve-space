import type {
  PlatformDeploymentResourceSubject,
  PlatformSingleRequestResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformExecutableEsiOperationProtocol } from '@eve-space/platform-module-server'
import { mapReferencePrice, type MarketReferencePrice } from './market-representation.js'
import type { referencePricesOperation } from './operations.js'
import type { MarketReferenceWrites } from './persistence.js'

type ReferenceProtocol = PlatformExecutableEsiOperationProtocol<
  { readonly 'market-reference-prices': typeof referencePricesOperation },
  'market-reference-prices'
>

export const marketReferencePricesResource: PlatformSingleRequestResourceImplementation<
  'market-reference-prices',
  ReferenceProtocol,
  readonly MarketReferencePrice[],
  string,
  unknown,
  PlatformDeploymentResourceSubject,
  readonly [],
  MarketReferenceWrites
> = {
  mode: 'single-request',
  operation: 'market-reference-prices',
  request: () => ({}),
  map: ({ data }) => {
    if (data.length > 20_000) throw new RangeError('Reference price count exceeds Market bound')
    const prices = data.map(mapReferencePrice)
    if (new Set(prices.map(({ typeId }) => typeId)).size !== prices.length) {
      throw new Error('Market reference prices repeat a type')
    }
    return prices
  },
  materialize: async ({ data, validatedAt, capabilities }) => {
    const observedHour = new Date(validatedAt)
    observedHour.setUTCMinutes(0, 0, 0)
    await capabilities.persistence.upsertMarketReferencePrices({
      observedHour: observedHour.toISOString(),
      validatedAt,
      prices: [...data],
    })
    capabilities.logger.info('market.reference-prices.observed', {
      typeCount: data.length,
      validatedAt,
    })
  },
}
