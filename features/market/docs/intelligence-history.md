# Canonical daily history

History belongs to a region and type, shared across profile station filters. Current watched types,
explicit demands, and active broad-universe targets may converge it. Broad targets consume none
of the 256 explicit-demand slots. Profile revisions and, for broad work, policy and universe
identities fence acceptance.

`converge-market-history` commits source validation, changed daily tuples, and profile progress
atomically. A later validation can correct an existing date; an older response cannot replace that
correction. Identical tuples leave the content row and its timestamp untouched. `validatedAt` on
source metadata describes validation of the complete response; the daily row timestamp describes
its last content change. `contentRevision` advances only when retained daily content changes.

An empty successful response advances source validation without deleting retained rows. Its
response count is zero; its date range is null. `retainedEvidence` explicitly labels old rows shown
alongside an empty or legacy source, and their read freshness is stale. A genuinely empty source
with no retained evidence may have current validation. Missing dates remain missing; no synthetic
zero-volume days are added. Source and book clocks are independent.

Reads expose `source` metadata and preserve the existing history fields. Uncollected types have
null source validation and an empty day list. Legacy daily rows seed conservative source metadata
with no freshness claim. `cleanup-market-history-retention` deletes at most 10,000 rows per
maintenance pass, keeping the 365 completed UTC dates ending yesterday. It does not delete book
observations or extend their retention.
