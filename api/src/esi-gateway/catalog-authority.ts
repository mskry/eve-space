export { coreEsiOperationIds } from './internal/operation-metadata.js'

export interface EsiCatalogReviewSources {
  readonly catalog: string
  readonly operationMetadata: string
}

export function getEsiCatalogReviewSources(): EsiCatalogReviewSources {
  return {
    catalog: 'api/src/esi-gateway/internal/catalog.ts',
    operationMetadata: 'api/src/esi-gateway/internal/operation-metadata.ts',
  }
}
