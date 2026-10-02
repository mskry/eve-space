import type { ExplorerMarketQuery } from '../../app/generated/graphql-operations'

export const explorerMarketFixture: ExplorerMarketQuery = {
  market: {
    catalogueRevision: {
      key: 'fixture-catalogue-1',
      buildNumber: '9007199254740993',
      ingestedAt: '2026-10-02T10:00:00.000Z',
    },
    profiles: [
      {
        profileId: '00000000-0000-4000-8000-000000000001',
        revision: '1',
        regionId: '10000002',
        marketScope: 'region',
        mode: 'watched',
      },
    ],
    referencePrices: {
      kind: 'non-executable-reference',
      rows: [
        {
          typeId: '34',
          averagePriceIsk: '123456789012345678.12345',
          adjustedPriceIsk: null,
          sourceHour: '2026-10-02T10:00:00.000Z',
          validatedAt: '2026-10-02T10:05:00.000Z',
        },
      ],
    },
  },
}
