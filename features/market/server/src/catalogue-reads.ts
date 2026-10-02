import type { PlatformPublicRouteCapabilities } from '@eve-space/platform-module-contract/server'

type CatalogueCoreData = PlatformPublicRouteCapabilities<readonly ['market-catalogue']>['coreData']
type MarketCatalogueRequest = Parameters<CatalogueCoreData['marketCatalogue']>[0]
type MarketCatalogueResult = Awaited<ReturnType<CatalogueCoreData['marketCatalogue']>>

type CatalogueValue<Kind extends MarketCatalogueRequest['kind']> = Extract<
  MarketCatalogueResult,
  { kind: Kind }
>

type CatalogueOutcome<Kind extends MarketCatalogueRequest['kind']> =
  | { ok: true; value: CatalogueValue<Kind>; key: string }
  | { ok: false; code: 'MARKET_CATALOGUE_UNAVAILABLE'; status: 503 }
  | {
      ok: false
      code: 'MARKET_CATALOGUE_REVISION_MISSING' | 'MARKET_TYPE_UNAVAILABLE'
      status: 404
    }

export const marketCatalogueRevisionKey = ({ revision }: MarketCatalogueResult) => {
  const ingestion = [...revision.ingestedAt]
    .map((character) => character.codePointAt(0)!.toString(16).padStart(2, '0'))
    .join('')
  return `${revision.buildNumber}-${revision.ingestVersion}-${ingestion}`
}

const matchesRequest = <Kind extends MarketCatalogueRequest['kind']>(
  result: MarketCatalogueResult,
  kind: Kind,
): result is CatalogueValue<Kind> => result.kind === kind

export const readMarketCatalogue = async <Request extends MarketCatalogueRequest>(
  coreData: CatalogueCoreData,
  request: Request,
  revision?: string,
): Promise<CatalogueOutcome<Request['kind']>> => {
  const result = await coreData.marketCatalogue(request).catch(() => null)
  const missingType = result?.kind === 'type-by-id' && !result.item
  if (!result || !matchesRequest<Request['kind']>(result, request.kind))
    return { ok: false, code: 'MARKET_CATALOGUE_UNAVAILABLE', status: 503 }
  const key = marketCatalogueRevisionKey(result)
  if (revision && revision !== key)
    return { ok: false, code: 'MARKET_CATALOGUE_REVISION_MISSING', status: 404 }
  if (missingType) return { ok: false, code: 'MARKET_TYPE_UNAVAILABLE', status: 404 }
  return { ok: true, value: result, key }
}
