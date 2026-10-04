# Intelligence GraphQL

The module-enabled public `market` contribution provides `intelligenceMetricDefinitions`,
`intelligenceCoverage(profileId)`, `intelligence(input)`,
`intelligenceItem(profileId, typeId, generationId?)`, and
`historyRange(profileId, typeId, from, through)`. These readers use only named read-only
Market persistence operations. They never load the catalogue tree/index, create demands,
change collection policy, call ESI, or enqueue work. Disabled profiles are unavailable.

Components compose these fields for their panels. Definitions describe the server's
versioned formulas and units; the worker computes the reports. Selecting fewer fields
reduces the response projection without granting arbitrary formulas or aggregation.

`intelligence` accepts at most 100 type IDs and 100 group IDs. Group selectors include
descendants through metadata frozen with the report. Multiple selectors within each
list form a union; type and group lists intersect. Exclusions apply before filtering,
totals, ranking, and pagination. A page defaults to 25 rows and permits 1–100.

Defaults are `sort: anchorTradedValueIsk`, `direction: DESC`,
`minimumAverageDailyValueIsk: "5000000000"`, `minimumAverageDailyOrders: "5"`,
`minimumBaselineDays: 0`, and `includeStale: false`. Activity thresholds are nonnegative
exact decimal strings and can both be zero. Baseline coverage cannot exceed the selected
metric's window; book-only metrics require zero. Relevant history and/or book freshness
is evaluated independently. Positive activity thresholds also require usable history.
Stale inclusion permits retained values, but a latest empty history response still makes
history-dependent metrics unavailable.

`total` counts filtered rows with a nonnull sort metric. `omittedNullSortCount` counts
filtered rows omitted because that metric is null. Ranking uses unrounded stored numeric
quotients, with ascending type ID as the final tie-breaker in either sort direction.
Metric display values truncate toward zero at six decimal places. Integer fractions,
quantities, source revisions and ISK products remain lossless strings.

Each page identifies one complete generation and its profile, policy, catalogue,
formula version, UTC anchor, scope and publication time. `after` is an opaque signed
cursor bound to that generation, those revisions, normalized filters, sort, and last
sort key/type ID. Page size can change. Other filters cannot. A new current generation
does not move a continuation to that generation. A tampered, incompatible, expired,
retired, or invalidated cursor returns the field-addressed
`MARKET_INTELLIGENCE_RESTART_REQUIRED` error; restart without `after` or `generationId`.
The signing key is excluded from public DTOs.

Item reads return `observed`, `uncollected`, `ignored`, or `unavailable` with nullable
row/generation evidence. Missing selected generations require restart. Repeated aliases
reuse request-local reads; unknown or ignored items do not acquire collection intent.
History ranges are inclusive, confined to the latest 365 completed UTC dates, and return
only supplied dates. Empty-source retained rows carry `retainedEvidence: true`.

Coverage labels `live` separately from `generation.counts`. The latter is evaluated at
the frozen input snapshot time. The exclusive classes are `neverAttempted`,
`freshSuccess`, `staleSuccess`, and `failedWithoutSuccess`; their sum is `eligibleCount`.
`emptySource` and `failedLastAttempt` are overlapping subsets. A failed refresh can coexist
with fresh successful evidence. `latestAttemptAt` and `oldestDueAt` expose sweep progress.
Missing catalogue/exclusion evidence remains null while a watched report is bootstrapping.
Scope and revisions identify which profile those counts describe; Global PLEX is separate.

The installed operation budget remains 5,000 cost units and 1,000 projected list rows.
An intelligence ranking or coverage scan carries a fixed 1,000 source-work charge for
the bounded compact report/metadata scan, independently of the requested page size;
history ranges carry 365. These are weighted admission units, not literal database row
counts: a report may contain 32,000 types. Nested lists charge their declared ceilings
(100 report rows, 365 history dates, 256 ignored groups, 21 definitions). Aliases and
selected nested fields still count toward the aggregate budget. Large projections must
be split into separate operations. Capacity evidence belongs in the root operations docs.

For a compact three-panel operation:

```graphql
query MarketPanels($profileId: UUID!, $typeId: EveId!, $from: UTCDate!, $through: UTCDate!) {
  market {
    intelligenceCoverage(profileId: $profileId) {
      live {
        eligibleCount
        freshSuccess
        staleSuccess
        neverAttempted
        failedWithoutSuccess
      }
    }
    intelligence(input: { profileId: $profileId, sort: anchorVolumeSpike }) {
      generation {
        generationId
        anchorDate
      }
      total
      rows {
        typeId
        name
        metrics {
          anchorVolumeSpike {
            value
            observedDays
            complete
          }
        }
      }
      nextCursor
    }
    historyRange(profileId: $profileId, typeId: $typeId, from: $from, through: $through) {
      days {
        date
        averageIsk
      }
    }
  }
}
```

Packaged generated operations cover price movers, supply, underpricing, traded value,
and volume spikes in `features/market/nuxt/src/runtime/app/market-operations.graphql`.
They contribute no frontend tab. See [metric definitions](intelligence-metrics.md) and
[collection policy](intelligence-collection.md).
