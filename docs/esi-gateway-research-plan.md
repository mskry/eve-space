# ESI gateway defect solutions: research plan

Status: awaiting the Deep Recon plan gate.

## Decision

Identify repair patterns for the three reproduced gateway defects, compare their failure guarantees and operational costs, and recommend which alternatives merit an architecture decision. The research will not implement changes or introduce binding architecture decisions.

Audience: the user's own engineering decision-making.

## Problem inputs and constraints

The [engineering assessment](reviews/esi-gateway-2026-10-03/report.md) supplies the scenarios to investigate. These scenarios and repository instructions frame the research; they are not evidence for general claims about distributed systems or library behavior.

Preserve the existing server-owned gateway, typed Promise interfaces, SDK-owned single attempts, separate disposable Cache Redis and durable coordination Redis, PostgreSQL persistence owner, and the narrow existing Effect boundary. Private data remains subject to current authorization. Recovery must not blindly replay unsafe external mutations.

## Research dimensions

| Dimension                                    | Questions                                                                                                                                                                                                  | Alternatives to investigate, without assuming they work                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mutation cancellation and uncertain outcomes | Where should caller cancellation stop governing settlement? How do cleanup and revision changes survive lost responses or cancellation during retry? What remains impossible without provider idempotency? | Explicit Promise mutation state machine; narrow shielded settlement/finalizer; durable command intent plus reconciliation                                                    |
| Durable invalidation and repair              | What survives disposable-cache loss, coordination outages, process death and ambiguous external completion? How do readers detect an unreconciled mutation?                                                | Durable coordination intent before dispatch; PostgreSQL intent/outbox plus read barrier; version/epoch invalidation; explicitly bounded weaker freshness                     |
| Lease renewal and shutdown                   | How are renewals serialized, joined, and released? What happens when renewal or release stalls? What do lease loss and fencing actually guarantee?                                                         | Promise-owned renewal task and joined finalizer; reuse a scoped lifecycle abstraction within existing boundaries; scheduling primitives with explicit pending-work ownership |

## Comparison criteria

For each alternative, record the dispatch point, durable state, reader behavior, crash/outage windows, cancellation semantics, shutdown bounds, recovery method, and unsafe replay risk. Compare additional writes/round trips qualitatively; do not invent throughput or latency numbers. Identify migrations, operational monitoring and ownership changes separately.

Evaluate the combination of the three repairs: cancellation settlement, durable intent and lease draining must compose without treating external ESI and PostgreSQL as one transaction.

## Research method and effort

- Intent: Run. Type: technical. Decision shape: explore, with comparisons and conditional recommendations.
- Topology: three independent research dimensions, one researcher each; fresh-context verification of the claims that drive recommendations.
- Preset: standard, from the installed skill defaults. Up to three concurrent researchers, up to eight sources per dimension per round, at most two rounds. Stop earlier when the questions are answered or leads stop adding useful evidence.
- Validation: normal, from defaults. Independently check load-bearing claims. Version/compatibility and decisive performance claims require appropriate corroboration; unconfirmed compatibility remains an explicit limitation.
- Sources: web search and direct official documentation, standards, original papers and maintained primary-source repositories. Search-shaped project tools are not external research evidence. No external publishing or messaging.
- Starting source families: HTTP semantics and idempotency; Node cancellation and timers; Effect interruption/resource scope; Redis durability, leases and fencing; PostgreSQL transactions; documented outbox/reconciliation patterns. These are search targets, not pre-approved conclusions.
- Research firewall: researchers receive only their question brief and explicit constraints, with no inherited conversation or project files. Project-specific fit is a clearly labeled application inference made after external evidence lands.
- Expected duration: approximately 10–20 minutes after approval, depending on source coverage and contradictions.

## Deliverables

Write a local research workspace under `docs/research/research-esi-gateway-defect-solutions/` containing the brief, source digests, append-only claims ledger, cited Markdown report, comparison tables, open questions and re-check dates. Produce an offline HTML briefing of the same report. Hand-off material should be usable by `bmad-architecture`; no code changes or tickets are part of this run.

## Tooling prerequisite

The installed skill is present, but `uv` and the project's `_bmad/scripts`/configuration are missing. Proposed fallback: use the bundled skill scripts in a temporary tooling environment and the explicit local workspace above, without writing or repairing `_bmad`. A full `bmad setup` is a separate alternative, not required by the research itself.

## Gate

The invoked skill's [Run instructions](../.agents/skills/bmad-deep-recon/references/run.md) explicitly require a plan approval before acquisition: “Present as a compact checklist, get approval, then”. Approval of this plan also accepts the tooling fallback; no research acquisition has started.
