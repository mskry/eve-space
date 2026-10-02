# Market Intelligence delivery contract

The installed `market` module is enabled by default. Its catalogue is independent of live
collection. A deployment administrator must explicitly enable a bounded public profile;
installation alone schedules no orders, history, or structure work. Public profile regions
are currently The Forge (`10000002`), Domain (`10000043`), and the measured low-volume
region `10000058`. The official Global PLEX Market (`19000001`) is a separate PLEX-only
(`44992`) watched-type identity without a station filter, not a regional or all-regions
aggregate. A version-six committed SDE projection validates NPC station membership.

## Source and observation identities

| Result                 | Identity and provenance                                                                                                | Limit and presentation                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Catalogue              | Committed SDE build, ingest version, timestamp                                                                         | Published market-assigned type by ID, including unpublished inventory groups; no live price or coverage claim.                                                                                                                                                                                                                                                                                   |
| Public book            | Profile revision, region, optional watched type, UUID observation, every page's `X-Pages`, validation time, and expiry | A pointer changes only after complete publication. 512 pages, 512,000 orders, three in-flight ESI pages. A previously complete pointer remains available after an incomplete replacement with its original time.                                                                                                                                                                                 |
| Order row              | Order ID and side from that one complete book                                                                          | Exact decimal ISK price, remaining volume, public location ID/solar-system ID, exact known NPC station label and system security from committed SDE, issued time, duration and derived UTC expiry; buyers include range and minimum volume. Unknown player structures retain a system/location-ID label. Seller and buyer pages are bounded to 100 rows and keyed to an explicit observation ID. |
| Depth quote            | Pinned complete observation, selected side/type/locations/quantity                                                     | Price-time fills report filled and unfilled quantity, total ISK, volume-weighted price, best price, worst consumed price, and the source freshness. An unfilled or stale result is not an executable current price. Pages are bounded to 1,000 rows and 512 pages; hitting a bound fails without inventing liquidity.                                                                            |
| Daily history          | Profile revision, region, type, source validation/expiry                                                               | Observed daily average (never labelled median), high, low, volume, and order count. At most 365 retained days are returned. History freshness and empty coverage are independent of the order book.                                                                                                                                                                                              |
| Derived metrics        | Complete observation UUID and derivation version                                                                       | Best bid/ask, spread, side volumes, one-/five-/ten-percent depth bands and actual available range. Raw-book rollback cleanup does not erase retained compact metrics.                                                                                                                                                                                                                            |
| Reference prices       | Type and UTC source hour                                                                                               | Adjusted and average prices are non-executable reference statistics, not quantity-aware quotes.                                                                                                                                                                                                                                                                                                  |
| Private structure book | Exact owned character, lifecycle UUID, authorization generation, organization version and selected structure           | Maximum four distinct selected structures per current character binding per day, 32 pages, 32,000 orders. Host verifies current organization permission, ownership and structure-market scope before queueing and again before materialization. Private books are never merged into public books or metrics.                                                                                     |

Public ESI pages use the audited gateway's SDK validation, `cachedUntil`, validators,
cooldowns, rate groups, request collapse and generation-bound private cache. PostgreSQL
observations are durable publication evidence, not a replacement gateway cache. A cached
page does not establish a complete book. Each page still counts against collection bounds.
Complete public books may finish collection and publication after their source expiry.
Expiry remains the original ESI boundary and determines current versus stale presentation
and the next refresh; it is not an ingestion deadline. Publication still requires every
page, consistent pagination, unique orders, coherent source validation times, and the
current enabled profile revision. Private structure collection retains its freshness gate.
Order, history, catalogue and reference results have distinct source clocks. Current
public reads use short HTTP cache lifetimes; unavailable and stale discovery responses
use `no-store`. Private routes and the public history-demand/quote mutations use
`no-store`. These module results are not eligible for browser query persistence without
a separate explicit classification and admission review.

## Request and access seams

Public profile observations stage in sequential atomic batches with a measured default
of 10 whole pages. The declared operation's hard ceilings are 20 pages, 20,000 orders,
and 16 MiB of serialized UTF-8 input including envelope overhead. Every
batch checks cancellation and module eligibility and is fenced by the current enabled
profile revision. Identical page replay, even regrouped into different batches, preserves
page/order identities and original validation/expiry metadata. A failed batch rolls back
all its writes; earlier staging batches remain unpublished until complete publication.
Batching does not extend source freshness or alter the complete-publication contract.

`api/src/index.ts` mounts generated Market routes under `/api/modules`. Public catalogue,
profile/book/history/reference reads use the enabled-module composer without a session.
An anonymous history **GET** is read-only; a trusted-origin **POST** records at most 256
validated type demands per region profile. A repeat for a type admitted within the last minute
returns fresh history or HTTP 202 `queued` without waking collection again. The worker still
collects at most 16 due types per profile job, so a larger demand set spreads across more jobs.
An admitted history intent first returns already-fresh history with HTTP 200. Otherwise the
declared host capability immediately admits a coalesced type-specific profile job without
planner staggering. The worker reloads the current profile and demand before collecting;
the registered gateway still enforces source expiry, cooldowns, request collapse and concurrency.
The host normally waits up to three seconds for completion, with a five-second response-wait
ceiling. A committed fresh result returns HTTP 200; HTTP 202 distinguishes queued, active
collection, and saved demand waiting for capacity or cooldown. The periodic planner remains
the PostgreSQL-based recovery path if admission or queue delivery is interrupted.
Routes record demand through `request-market-history-demand`, defined in the
`market-001-initial.sql` baseline. Deployment
administration owns profile configuration. Private structure routes use the existing
organization-authorized owned-character composer and `market.structure.read`; neither a
deployment administrator nor a different attached character is sufficient. The queue
contains stable identity/revision/selector fields, never order rows or credentials.

The one-year history policy remains in place. Changing on-demand delivery does not introduce
a 90-day storage or response limit. A fast history response is inserted into the existing
browser query entry after canceling any superseded read, preserving its server validation
time and preventing a late uncollected response from overwriting it.

Industry planning may later request an intentional quote or observation DTO through a
declared, permission-aware platform market-reading capability. It must not import the
Market server implementation or treat historical average or adjusted reference price
as executable revenue. That future seam must carry observation ID, source time,
freshness, location constraints, fill completeness, and private subject admission where
applicable.

## GraphQL read projection

Market contributes `Query.market` through the installed module inventory. The host
[GraphQL contract guide](../../../docs/graphql-application-api.md) owns endpoint execution,
admission, scalar coercion and caching. The contribution is composed offline and every
read, including bounded list projections, passes the host's runtime module enablement gate.
It grants only named persistence reads and the public `market-catalogue` and
`static-location-labels` products. It has no profile administration, private structure,
collection demand, quote, ESI dispatch or queue capability. Public selection needs no session.
The endpoint mount and explorer are delivered in the later host/frontend task sections.

| Field                                                          | Projection                                                                                                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalogueRevision`                                            | Committed SDE key, build number, ingest version and ingest timestamp; loads revision metadata only.                                                                                                  |
| `catalogueType(revision, typeId)`                              | Published marketable type, pinned to the supplied catalogue key.                                                                                                                                     |
| `catalogueGroupTypes(revision, groupId, first, after)`         | At most 100 direct types. `first` defaults to 100; `after` and `nextCursor` retain the canonical `t_` cursor. A short requested page continues after its last returned type.                         |
| `profiles`                                                     | At most four enabled summaries with profile revision, region/global-plex scope, station IDs and watched type IDs.                                                                                    |
| `book(profileId, typeId)`                                      | Current/stale/uncollected state, profile revision, complete observation and separate incomplete replacement; reads no orders or labels.                                                              |
| `orders(profileId, typeId, observationId, side, first, after)` | At most 100 rows from the explicit complete observation; source metadata, profile revision, label completeness and opaque price/time/order continuation.                                             |
| `history(profileId, typeId)`                                   | Enabled profile revision and at most 365 retained daily averages, highs, lows, volumes and counts, with its own validation/expiry and freshness.                                                     |
| `referencePrices(typeIds)`                                     | At most 100 distinct types, marked `non-executable-reference`, with exact stored decimal prices, nullable missing statistics, UTC source hour and validation time. No book-style expiry is invented. |

Discover a revision and enabled profile before selecting pinned pages:

```graphql
query DiscoverMarket {
  market {
    catalogueRevision {
      key
      buildNumber
      ingestVersion
      ingestedAt
    }
    profiles {
      profileId
      revision
      regionId
      marketScope
      mode
      stationIds
      watchedTypeIds
    }
  }
}

query ReadMarketBook($profile: UUID!, $type: EveId!) {
  market {
    book(profileId: $profile, typeId: $type) {
      profileRevision
      status
      collectionStatus
      replacement {
        status
        attemptedAt
      }
      observation {
        observationId
        observedAt
        validatedAt
        freshUntil
        expectedPages
        totalBookOrders
      }
    }
    history(profileId: $profile, typeId: $type) {
      profileRevision
      freshness
      validatedAt
      freshUntil
      days {
        date
        averageIsk
        highIsk
        lowIsk
        volume
        orderCount
      }
    }
    referencePrices(typeIds: [$type]) {
      kind
      rows {
        typeId
        adjustedPriceIsk
        averagePriceIsk
        sourceHour
        validatedAt
      }
    }
  }
}

query ReadMarketOrders($profile: UUID!, $type: EveId!, $observation: UUID!, $after: String) {
  market {
    orders(
      profileId: $profile
      typeId: $type
      observationId: $observation
      side: sell
      first: 100
      after: $after
    ) {
      observationId
      profileRevision
      hasMore
      nextCursor
      labelsComplete
      observation {
        observedAt
        validatedAt
        freshUntil
      }
      rows {
        orderId
        price
        volumeRemain
        locationId
        locationName
        issuedAt
        expiryAt
      }
    }
  }
}
```

Omit `after` on the first order page; send its `nextCursor` with the same profile, type,
observation and side for continuation. A new publication does not change that selector.
If retention removed the observation, `MARKET_OBSERVATION_UNAVAILABLE` requires rediscovery;
if the SDE revision changed, `MARKET_CATALOGUE_REVISION_MISSING` requires a new catalogue key.
Malformed or mismatched cursors fail before order reads. Unknown locations retain public
IDs and a system/ID or ID-only fallback label; one bounded public label batch serves the
page, without protected structure lookup.

These fields preserve public publication after source expiry and the original complete
pointer during incomplete replacement. Catalogue, book, history and reference clocks remain
independent: a current book can coexist with stale history and older reference statistics.
Only a selected current, complete source can contribute a bounded public cache lifetime;
stale, uncollected, incomplete replacement or incomplete label results close cache eligibility.
Reference prices use `no-store` because their DTO supplies no expiry boundary. Repeated or
aliased reads do not record history demand or schedule collection.

GraphQL history returns `uncollected` for eligible full-region types with no recorded demand.
It checks the profile revision around the source read; `MARKET_HISTORY_PROFILE_CHANGED` requires
restarting the read. Missing or ineligible profiles remain unavailable. The REST history contract
is unchanged. Catalogue page sizes and continuations are owned by the core catalogue read; Market
checks the requested revision and classifies unavailable catalogues and missing types before
transport adapters shape a response.
