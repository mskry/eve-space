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
Order, history, catalogue and reference results have distinct source clocks. Current
public reads use short HTTP cache lifetimes; unavailable and stale discovery responses
use `no-store`. Private routes and the public history-demand/quote mutations use
`no-store`. These module results are not eligible for browser query persistence without
a separate explicit classification and admission review.

## Request and access seams

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
