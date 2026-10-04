# Intelligence metrics

Formula version 1 uses supplied daily rows in 7-, 30-, and 365-calendar-date windows
ending at yesterday in UTC. Every window includes that anchor date. Missing dates
stay missing; supplied zero-volume dates count toward `observedDays`. A window is
complete only when every calendar date has a supplied row.

The weighted baseline is `sum(averageIsk * volume) / sum(volume)`. Week price change
is `(anchorAverage / baselineWeek - 1) * 100`; month/year underpricing substitutes
the current book's best ask and its corresponding baseline. Estimated traded value
is `sum(averageIsk * volume)`, rather than an executable price or market capitalization.
Average daily value and orders divide seven-day sums by the supplied-day count.

Anchor volume spike divides anchor volume by the mean supplied-day volume in the
365-day window. Week volume spike divides the seven-day supplied-day mean by that
yearly mean. The year here is a trailing baseline, without a previous-year comparison.

Book metrics use one complete identified observation and its eligible location set.
Spread is ask minus bid; spread percent divides that difference by a positive ask.
Sell depth sums remaining quantities at all prices or at prices at most 1.05/1.10
times the best ask. Days of supply divides all-price or 10%-band sell depth by mean
supplied seven-day volume. A station subset's `bookScope=stations` is paired with
`historyScope=region`: the denominator does not describe station-specific trades.
Book observation/validation/expiry clocks remain separate from history validation.

Each metric carries an exact integer `numerator` and `denominator` whose quotient
is the metric in its declared unit. Price fractions scale cents into ISK in the
denominator; comparison fractions include the percentage multiplier in the numerator.
`value` renders that fraction to six decimal places, truncating toward zero.
Large ISK products and quantities never pass through floating point arithmetic.
Comparisons use the original fractions, without rounding an intermediate baseline.

Null reasons distinguish `NO_OBSERVATIONS`, `SOURCE_UNAVAILABLE`, `NO_ANCHOR`,
`ZERO_DENOMINATOR`, `NO_BOOK`, `NO_ASK`, and `NO_BID`. An empty latest history response
or legacy/uncollected source makes history-dependent metrics unavailable even when
older rows remain readable. Book-only metrics can still be known. A complete empty
book supplies known zero all-price depth; a missing book supplies no depth. Without
asks, sell-band depth is unknown. Zero asks cannot supply a spread denominator.

For example, two supplied week dates with total volume 40 and estimated value
700 ISK have a 17.50 ISK weighted baseline and 350 ISK average daily value. An anchor
price of 20 ISK changes by 14.285714%; 100 units of sell depth provide five days
of supply using the supplied-day mean volume of 20.

Ranking defaults require 5,000,000,000 ISK average daily value and five average daily
orders. Both thresholds can be set to zero. They select report rows and do not narrow
collection eligibility. Partial baselines are disclosed; callers can require more
observed days and explicitly include stale evidence.

## Generation lifecycle

The daily-history profile resource alternates due reconciliation, history collection,
and local report work using a durable work-kind cursor. Report work makes no ESI calls.
It captures target metadata, history aggregates and source clocks, and one grouped book
scan in a single database snapshot. It derives at most 100 types per page and 64 pages
per job. Each page advances a committed type-ID cursor; restart resumes that frozen input.

New generations start no more than once every five minutes. Source fingerprints include
the profile, policy, active universe, UTC anchor, canonical validation/content state,
attempt outcomes, and complete books. Comparing those durable facts reconstructs missed
dirty notifications. Watched profiles also check the committed catalogue revision at
least every minute; catalogue-only changes invalidate their old report and stage.

Publication occurs atomically only after every frozen target has an output. Profile,
policy and catalogue-universe changes reject obsolete stages. Source changes during
derivation leave the frozen report intact and keep a future replacement due. Incomplete
replacement never becomes current. The current report and one prior report are retained;
the prior expires after 24 hours or when a further report replaces it. Staging expires
after 24 hours. Bounded maintenance removes expired data while preserving current reports.

Readers retain independent book/history provenance and distinguish live sweep coverage
from generation evidence. See [the GraphQL contract](intelligence-graphql.md) for selectors,
thresholds, cursor restart outcomes and composable examples.
