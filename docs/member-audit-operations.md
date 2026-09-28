# Member Audit Operations

## Security Boundaries

Member Audit is a private organization-review contribution. Installation, module enablement,
reviewer role, permission assignment, section enablement, current organization membership, current
character authorization, and current disclosure acceptance are independent gates. Do not treat one
as evidence that another is present.

- Deployment administrators may enable or disable the module and its sections. That authority grants
  no organization role, module permission, or private-data access.
- Organization owners may grant the `hr_auditor` or `director` role and configure restricted groups.
  Owner authority alone grants no Member Audit evidence access.
- A reviewer needs a current HR or director grant, `member-audit.search`, the exact contribution
  permission, current compliance, and membership in the active organization version.
- ESI-backed sections also require the selected character's current scope and acceptance of the
  current reviewer-use disclosure on the same authorization generation. EVE SSO authorizes only
  that selected disclosed character; it cannot discover undisclosed characters or prove account
  completeness.
- A member block denies the blocked actor before Member Audit search or storage reads. Blocking a
  target denies that target's protected access but does not erase evidence or prevent a separately
  authorized reviewer from investigating the target.

## Reviewer Setup

1. Keep the module and every section disabled while configuring access.
2. As the organization owner, grant the reviewer a current `HR / Auditor` or `Director` role in
   **Settings > Integrations > Organization roles**. Record a non-secret reason.
3. In **Organization access**, preview a Member Audit profile and copy only the required permissions
   into a permission bundle. Profiles are suggestions; previewing or copying one grants no access.
4. Create a manual restricted group through `POST /api/organization/groups` with
   `restricted: true`, `managementMode: "manual"`, `complianceSource: null`, and the selected
   `bundleIds`. Restricted groups prevent HR or director reviewers from broadening their own access.
5. Assign the reviewer through
   `POST /api/organization/groups/:groupId/assignments` as the organization owner. Include a
   non-secret reason and an expiry when access is temporary.
6. Confirm the effective permissions before enabling a section. Use the smallest applicable set:

| Capability                 | Required permission                     |
| -------------------------- | --------------------------------------- |
| Search managed accounts    | `member-audit.search`                   |
| View account summary       | `member-audit.summary.read`             |
| View trained skills        | `member-audit.skills.read`              |
| View assets                | `member-audit.assets.read`              |
| View wallet                | `member-audit.wallet.read`              |
| View mail                  | `member-audit.mail.read`                |
| View current ship/location | `member-audit.current-observation.read` |
| Manage ordinary groups     | `member-audit.groups.manage`            |
| Block or unblock members   | `member-audit.members.block`            |

Do not put Member Audit permissions in automatically managed compliance groups. Rule-managed
groups can include deliberately selected restricted reviewer bundles only when the owner has
configured a bounded current eligibility rule; Member Audit cannot assign or revoke them. Member
Audit may assign or revoke ordinary manual groups, but only the organization owner may change
membership in a restricted manual group. Deployment-administrator sessions cannot perform either
operation.

## Target And Evidence Scope

A review target is an account with at least one current disclosed character lifecycle in a
corporation managed by the active organization version. The account remains reviewable while
noncompliant, suspended, or blocked so an authorized reviewer can inspect the core decision. A
disclosed external character appears only while a current organization-policy exception evaluates
it. Member Audit never exposes an undisclosed character, an out-of-scope account, an unregistered
roster character's owner, or evidence from a prior account, character, or organization lifecycle.

The reviewer representations are limited to:

- Trained skills: skill identity, level, skill points, catalogue grouping, and training attributes.
- Assets: type, quantity, location, grouping, volume, and eligible custom name.
- Wallet: current balance and bounded journal and transaction fields required for review.
- Mail: bounded header identity, source timestamp, labels, resolved parties, subject, and sanitized
  plain-text body. Raw markup is never retained.
- Current observations: separate latest complete ship type/name and system/location-kind snapshots
  with permitted public labels and independent validation times; no ship instance ID, coordinates,
  online state, or movement history.

Every authenticated detailed skills, assets, wallet, or mail attempt appends exactly one immutable,
content-free allow or deny decision before returning evidence or a controlled refusal. The record is
limited to actor, authorized target account and optional resolved character, section, decision, safe
reason, organization version, policy version, applicable disclosure version, and time. Audit
append failure fails closed. Search text, evidence fields, tokens, and upstream payloads never enter
the organization audit ledger.

Group and block actions are core-owned workflows. Reviewers with the exact action permission may
assign or revoke only non-restricted ordinary groups and must provide a non-secret reason. Member
Audit presents compliance- and rule-managed membership as read-only because core converges each
from its declared source. To remove protected access immediately, use the separately authorized
block action; unblock reevaluates current assignments and does not recreate an expired grant.

## Reviewer Directory

The managed-member directory is owned and served by core. Member Audit declares the permissions
that make its reviewer contributions discoverable, but it does not own a search endpoint, directory
model, row renderer, or directory storage read. A caller must have a current HR or director grant,
current organization compliance, `member-audit.search`, and `member-audit.summary.read` before core
loads any enriched row. Deployment-administrator or organization-owner authority alone is not
sufficient.

`GET /api/organization/review/characters` returns one bounded row per eligible current disclosed
character, including an approved external character only while its account has a fresh managed
affiliation. It pages the global character relation before account-group enrichment. The older
`/members` account endpoint and account-only target links remain separate. Column visibility does
not change the response or act as a data-access control.

| Field                | Operational meaning                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Character            | The row character's own name, portrait identity, lifecycle and managed/approved-external affiliation; the eligible account main character is secondary context |
| Corporation          | The row character's observed corporation ID, including approved external affiliation; no live ESI name lookup                                                  |
| Managed since        | Start of the account's current managed-member lifecycle; an earlier ended lifecycle is not continuous tenure                                                   |
| Audit data           | The row character's aggregate state, safe counts, and oldest complete validation, never a sibling's timestamp or raw evidence                                  |
| Groups               | Deterministically ordered current visible **account** assignments only                                                                                         |
| Access status        | Current **account** compliance state with an active account block taking precedence                                                                            |
| Disclosed characters | Count of the account's currently eligible disclosed characters; it does not imply undisclosed-character discovery                                              |
| Affiliation checked  | Time at which the **row character's** current affiliation was validated, with freshness and external status distinguished                                      |
| Site registered      | Creation time of the EVE Space user record, not corporation tenure or site activity                                                                            |
| Review deadline      | Current compliance review deadline, or no recorded value                                                                                                       |
| Access valid until   | Current compliance access boundary, or no recorded value                                                                                                       |
| Blocked since        | Start of the current active block, or no recorded value                                                                                                        |

Aggregate audit state is conservative across every expected enabled Member Audit resource:

1. `not-enabled` means no evidence resource is enabled.
2. `authorization-required` means at least one expected resource lacks current authorization or
   disclosure acceptance.
3. `unavailable` means at least one expected resource has a current unavailable or failed state.
4. `never-collected` means at least one expected resource has no successful validation.
5. `stale` means every resource has succeeded but at least one validation is stale.
6. `current` means every expected resource is current.

The per-character aggregate `asOf` value is present only when every expected resource for that
character has succeeded. It is the oldest validation in that complete set, not the newest resource
timestamp or a sibling character's time. Resource identities,
failure details, and evidence remain behind explicit target and contribution selection.

Character name or exact character-ID search selects matching rows; exact account-ID search selects
that account's eligible rows. Corporation filtering uses the row affiliation, while group,
compliance, and block filters use account facts; audit-state filtering uses the row's aggregate.
Sorting applies to the whole authorized result set before a maximum 50-character page, with nulls
last and stable character/lifecycle ties. The encrypted character cursor binds the organization
version, normalized query, every filter, sort field and direction, page size, and last ordering
tuple. It cannot be replayed as an account cursor. Eligibility changes between pages require
current re-evaluation rather than granting a historical snapshot.

Browser preferences contain only a schema version and ordered stable field IDs. They do not contain
members, identifiers, names, groups, status or date values, search/filter/sort inputs, cursors, or
selected targets. Directory results remain private, memory-only query data and are fetched again
through current authorization.

This directory has no CSV endpoint or download control. It does not store, infer, request, or show
last site activity, last site login, EVE last-login/logout, online state, or login counts. Those
fields require separate source, scope, disclosure, permission, freshness, and retention decisions.

## Current Observation DTOs

Ship and location are separate `current-observation` resources. Each snapshot retains the exact
character/organization authority binding in storage, one complete intentional payload, the original
gateway `validatedAt`, and upstream `cachedUntil`. The read operation returns independently nullable
envelopes, for example a current ship with location unavailable:

```json
{
  "currentShip": {
    "dtoRevision": 1,
    "observationId": "00000000-0000-4000-8000-000000000001",
    "snapshot": {
      "kind": "current-ship",
      "typeId": 34,
      "typeName": "Merlin",
      "groupId": 25,
      "groupName": "Frigate",
      "name": "Review Vessel"
    },
    "validatedAt": "2026-09-18T12:00:00Z",
    "cachedUntil": "2026-09-18T12:00:05Z"
  },
  "currentLocation": null
}
```

An independently admitted structure observation can retain its identifier without a private
structure-name lookup:

```json
{
  "currentShip": null,
  "currentLocation": {
    "dtoRevision": 1,
    "observationId": "00000000-0000-4000-8000-000000000002",
    "snapshot": {
      "kind": "current-location",
      "solarSystemId": 30000001,
      "solarSystemName": "Unknown solar system",
      "solarSystemSecurityStatus": null,
      "locationType": "structure",
      "structureId": 1000000001
    },
    "validatedAt": "2026-09-18T12:00:00Z",
    "cachedUntil": "2026-09-18T12:00:05Z"
  }
}
```

The status for each resource is independently `current`, `stale`, `authorization-required`,
`never-collected`, or `unavailable`. Under the present zero-stale policy, `stale` cannot release
evidence. Ship may be current while location is authorization-required or unavailable, and vice
versa. In those latter states the affected envelope is null. No ship instance ID, coordinates,
movement series, online status, or private structure details are retained.

## Directory Rollout And Rollback

Deploy the API and Nuxt directory from the same release. The canonical row shape, filter and sort
inputs, and opaque cursor version are one contract; do not intentionally operate mismatched server
and Nuxt versions. The directory relation requires no backfill; this change's separate OAuth and
observation migrations remain forward-only. Its maximum-size query plan uses the existing core
schema, and directory preferences remain browser-local presentation state.

In-flight cursors are ephemeral and memory-only. Old account-directory cursors are never translated
into character cursors. A rejected cursor returns the typed invalid-directory-input response, after
which the workspace returns to the first page and announces the reset. Saved column layouts carry their own
schema version; an old version, unknown or duplicate field, missing locked field, corrupt value, or
storage failure falls back to or repairs against the current field catalogue without member data.

For rollback, restore the prior API and Nuxt pair together without reversing applied migrations.
The newer browser preference key may remain: the prior client
ignores it, and a later compatible client validates its version before use. Existing session,
organization-version, compliance, block, reviewer-role, exact-permission, module, and section gates
remain authoritative across rollout and rollback. Authorization loss, logout, organization changes,
or module disablement must continue to remove the affected private queries and selected target before
another directory or contribution request runs.

## Retention And SLOs

Member Audit stores intentional reviewer DTOs, not raw ESI responses.

| Evidence                                              | Retention and collection objective                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trained skills                                        | Latest complete current-authority snapshot only; refresh interval 60 minutes                                                                                                                             |
| Skill queue                                           | Not collected                                                                                                                                                                                            |
| Assets and eligible custom names                      | Latest complete current-authority snapshot only; refresh interval 60 minutes                                                                                                                             |
| Wallet balance                                        | Latest complete current-authority snapshot only; refresh interval 15 minutes                                                                                                                             |
| Wallet journal and transactions                       | Source-timestamp retention of at most 90 days; refresh interval 15 minutes                                                                                                                               |
| Mail headers and sanitized plain text                 | Source-timestamp retention of at most 90 days; refresh interval 15 minutes; raw markup is never persisted                                                                                                |
| Current ship and current location                     | Separate latest complete snapshots; proposed collection interval 300 seconds per resource; readable for at most 24 hours after its own last successful validation and only until earlier upstream expiry |
| Incomplete continuation, staging, and promotion state | At most 24 hours                                                                                                                                                                                         |

Rows at or before the exclusive 90-day cutoff are not promoted or returned. Re-observation cannot
extend retention because expiry derives from the immutable source timestamp.

The 300-second observation cadence is a planning limit, not a guarantee of live ESI freshness.
Runtime `Expires` or `Cache-Control` determines the upstream boundary; a gateway cache hit does not
advance the original validation time. Both existing `ship` and `location` gateway contracts permit
**no stale evidence**, which is stricter than the 24-hour readable ceiling. At upstream expiry the
snapshot becomes unreadable immediately; the current policy does not release a `stale` payload.
The `stale` DTO state is reserved for a separately reviewed future gateway allowance. Retry,
cooldown, and delayed scheduling never extend the readable deadline. Expired private content is
purged within 24 hours after expiry; authority-invalid content is unreadable immediately and
purged within 24 hours of invalidation. Neither purge lag is a period of authorized reading.

An authoritative authorization, disclosure, character lifecycle, managed-member lifecycle,
organization-version, module, or section invalidation must make affected evidence unreadable
immediately. Bounded physical cleanup must complete within 24 hours. The queue planner repairs
collection state, runs installed-resource maintenance, and retries purge work from PostgreSQL; do
not restart the worker merely to clear work that only the worker can drain.

Before enabling a section in a real deployment, record representative measurements for request
count, pages or detail fan-out, worker duration, queue wait, ESI cooldown or error-budget pressure,
refresh-token contention, database growth, and purge throughput. No production capacity acceptance
has been inferred from unit or fixture tests.

## Section Rollout

Member Audit and all seven sections default disabled. Use deployment-administrator sessions with:

- `PUT /api/admin/modules/member-audit` and `{ "enabled": true }` for the module.
- `PUT /api/admin/modules/member-audit/sections/:sectionId` and `{ "enabled": true|false }` for
  `overview`, `skills`, `assets`, `wallet`, `mail`, `current-observation`, or `access-management`.

API and worker replicas normally converge within `MODULE_RUNTIME_CACHE_TTL_MS`, which defaults to
five seconds. Browser module discovery uses a 30-second freshness window and refreshes before entry.

Roll out one section at a time:

1. Enable `overview`; verify only authorized reviewers can search and open bounded summaries.
2. Enable `skills`; complete a fresh selected-character disclosure and authorization, then verify a
   complete skills snapshot and content-free access audit.
3. Enable `assets`; exercise a representative multi-page character and verify continuation,
   enrichment, atomic promotion, and database growth.
4. Enable `wallet`; verify balance, journal, and transaction statuses independently and confirm the
   90-day boundary.
5. Enable `mail`; verify bounded header/detail fan-out, plain-text sanitization, isolated mail
   permission, and the 90-day boundary. Treat this as the highest-sensitivity rollout.
6. Enable `access-management`; verify ordinary-group and block confirmations, required reasons,
   immutable audit, and restricted/compliance-group refusal.
7. Keep `current-observation` disabled until a measured representative ship/location call budget,
   queue lag, database-write rate, and purge throughput are accepted. Then verify exact-character
   disclosure and independently admitted states in a controlled development organization.
   Production enablement requires separate privacy acceptance; code delivery or development
   verification does not grant it.

For every step, inspect worker health, queue wait and backlog age, ESI cooldown and error-budget
telemetry, resource status, access-audit decisions, row growth, and purge throughput. Do not enable
the next section until its representative case remains within documented ESI request ceilings and
the 24-hour purge objective. Re-enable creates a new activation version and requires a new complete
observation; retained pre-disable data must not become current again.

## Kill Switches And Rollback

Disable the affected section first. Section disablement gates routes, reviewer contributions,
planning, execution, collection status, and retained evidence before feature code reads storage. If
the incident is not isolated or the section gate cannot be verified, disable the complete module.

After disablement:

1. Wait for runtime-cache convergence and refresh the browser module catalog.
2. Verify the affected contribution is absent and its route returns the disabled/not-found response.
3. Verify queued work performs no new ESI access or materialization for the disabled authority.
4. Keep permission bundles and core role grants intact while investigating. Disablement makes module
   permissions inert, so revoking them first is unnecessary and can obscure the incident timeline.
5. Do not revoke EVE tokens, alter owner-facing routes, remove core groups or blocks, or rewrite
   immutable organization audit as part of module rollback.

Static uninstall is a separate build-time action. Follow
[Platform Module Foundation: Explicit Removal](platform-module-foundation.md#explicit-removal) after
the module is disabled and inaccessible.

## Purge Runbook

Routine retention and invalid-authority cleanup is automatic. Monitor the count and oldest
`created_at` value in `platform_resource_purge_work` without selecting target identifiers. A pending
row approaching 24 hours, repeated maintenance failure, or storage growth beyond the accepted
capacity envelope is an incident.

For lifecycle, transfer, detachment, or account-deletion cleanup:

1. Confirm the authoritative core mutation committed and the evidence route is already denied.
2. Keep the worker and planner running. Purges execute in attested batches of at most 1,000 rows and
   repeat until the operation reports no remaining batch.
3. Verify the purge-work backlog drains and collection state no longer exposes the invalid authority.
4. Verify snapshots, wallet/mail rows, continuation state, staging, and promotion markers for the
   invalid authority are absent using counts only, including `current_observation_snapshots` for
   both `current-ship` and `current-location`. Do not select evidence payloads.
5. If cleanup cannot complete within 24 hours, keep the section or module disabled and follow the
   incident procedure below.

Observation maintenance invokes the attested `purge-current-observation` operation independently
for each resource. `retention` removes a snapshot after its upstream expiry or 24-hour readable
ceiling; `authority`, `account`, and `organization` modes match the full invalidated binding or
bounded removal scope. Each invocation deletes at most 1,000 rows and repeats until no rows remain.
For rollback, disable `current-observation` first, verify reads and collection stop, then complete
both resource purges within 24 hours; leave the forward-only migrations and content-free audit
history in place. Re-enablement advances disclosure acceptance and activation, never revives a
prior snapshot. Controlled PostgreSQL tests exercise expired and invalid-authority purges and a
multi-batch organization-version purge; deployment measurements remain a separate acceptance gate.

For an explicit organization-version privacy purge or permanent removal:

1. Disable the complete module and verify route, navigation, planner, and worker gates have converged.
2. Record the organization version and approved purge scope without copying member or evidence data
   into the change record.
3. Use a reviewed forward operator migration to invoke the attested
   `member-audit/purge-evidence` operation in `organization` mode for every evidence, continuation,
   staging, and promotion store until each call reports `remaining: false`. Do not issue ad hoc table
   deletes or call the module SQL routine from an application session.
4. In the same reviewed removal procedure, remove the covered platform collection state, module
   settings, saved navigation, provisioning, migration-ledger, schema, privilege, and runtime-role
   state identified by the platform explicit-removal checklist. Backups remain subject to encrypted
   infrastructure retention; after a restore, rerun invalidation and retention cleanup before
   admitting Member Audit traffic.
5. Verify zero covered rows with aggregate counts, retain the non-sensitive operator approval and
   completion time, and keep content-free core organization audit according to core retention.

## Privacy Incident Response

Treat unauthorized access, incorrect disclosure binding, raw or mis-scoped mail content, stale
evidence release, or a purge-SLO breach as a privacy incident.

1. Contain immediately with the affected section kill switch; disable the module if isolation is
   uncertain.
2. Preserve content-free organization audit and sanitized operational telemetry. Record actor,
   authorized target identity when already known, section, allow/deny decision, safe reason,
   organization/policy/disclosure versions, timestamps, queue outcome, and error classification.
3. Never log or copy access/refresh tokens, cookies, OAuth state, session bearers, encryption
   material, search terms, skills, assets, wallet records, message parties, subjects, bodies, raw ESI
   payloads, cursors, database URLs, or Redis URLs into tickets, chat, telemetry, or command output.
4. Determine whether authority checks, disclosure generation binding, sanitization, retention, or
   purge execution failed. Use aggregate counts and bounded identifiers rather than evidence content.
5. Run the bounded purge procedure for affected authority or organization versions and verify the
   evidence remains unreadable throughout.
6. Re-enable only after authorization and disclosure regressions pass, representative section
   capacity is accepted, purge completion is verified, and the incident owner approves the rollout.
