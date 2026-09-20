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

| Capability               | Required permission          |
| ------------------------ | ---------------------------- |
| Search managed accounts  | `member-audit.search`        |
| View account summary     | `member-audit.summary.read`  |
| View trained skills      | `member-audit.skills.read`   |
| View assets              | `member-audit.assets.read`   |
| View wallet              | `member-audit.wallet.read`   |
| View mail                | `member-audit.mail.read`     |
| Manage ordinary groups   | `member-audit.groups.manage` |
| Block or unblock members | `member-audit.members.block` |

Do not put Member Audit permissions in automatically managed compliance groups. Member Audit may
assign or revoke ordinary groups, but only the organization owner may change membership in a
restricted group. Deployment-administrator sessions cannot perform either operation.

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

Every authenticated detailed skills, assets, wallet, or mail attempt appends exactly one immutable,
content-free allow or deny decision before returning evidence or a controlled refusal. The record is
limited to actor, authorized target account and optional resolved character, section, decision, safe
reason, organization version, policy version, applicable disclosure version, and time. Audit
append failure fails closed. Search text, evidence fields, tokens, and upstream payloads never enter
the organization audit ledger.

Group and block actions are core-owned workflows. Reviewers with the exact action permission may
assign or revoke only non-restricted ordinary groups and must provide a non-secret reason. Member
Audit presents compliance-group membership as read-only because its declared source converges that
membership automatically. To remove protected access immediately, use the separately authorized
block action; unblock reevaluates current assignments and does not recreate an expired grant.

## Reviewer Directory

The managed-member directory is owned and served by core. Member Audit declares the permissions
that make its reviewer contributions discoverable, but it does not own a search endpoint, directory
model, row renderer, or directory storage read. A caller must have a current HR or director grant,
current organization compliance, `member-audit.search`, and `member-audit.summary.read` before core
loads any enriched row. Deployment-administrator or organization-owner authority alone is not
sufficient.

The directory exposes one canonical bounded row. Column visibility does not change the response or
act as a data-access control.

| Field                | Operational meaning                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Member               | Permitted main-character identity and portrait, falling back to the current managed-affiliation character  |
| Corporation          | Current managed-affiliation corporation ID; serving the row performs no live ESI name lookup               |
| Managed since        | Start of the current managed-member lifecycle; an earlier ended lifecycle is not continuous tenure         |
| Audit data           | Aggregate state and safe counts derived from core collection metadata, never raw Member Audit evidence     |
| Groups               | Deterministically ordered current visible core assignments only                                            |
| Access status        | Current compliance state with an active member block taking precedence                                     |
| Disclosed characters | Count of current attached in-scope character lifecycles; it does not imply undisclosed-character discovery |
| Affiliation checked  | Time at which the current managed affiliation was validated                                                |
| Site registered      | Creation time of the EVE Space user record, not corporation tenure or site activity                        |
| Review deadline      | Current compliance review deadline, or no recorded value                                                   |
| Access valid until   | Current compliance access boundary, or no recorded value                                                   |
| Blocked since        | Start of the current active block, or no recorded value                                                    |

Aggregate audit state is conservative across every expected enabled Member Audit resource:

1. `not-enabled` means no evidence resource is enabled.
2. `authorization-required` means at least one expected resource lacks current authorization or
   disclosure acceptance.
3. `unavailable` means at least one expected resource has a current unavailable or failed state.
4. `never-collected` means at least one expected resource has no successful validation.
5. `stale` means every resource has succeeded but at least one validation is stale.
6. `current` means every expected resource is current.

The aggregate `asOf` value is present only when every expected resource has succeeded. It is the
oldest validation in that complete set, not the newest resource timestamp. Resource identities,
failure details, and evidence remain behind explicit target and contribution selection.

Browser preferences contain only a schema version and ordered stable field IDs. They do not contain
members, identifiers, names, groups, status or date values, search/filter/sort inputs, cursors, or
selected targets. Directory results remain private, memory-only query data and are fetched again
through current authorization.

This directory has no CSV endpoint or download control. It does not store, infer, request, or show
last site activity, last site login, EVE last-login/logout, online state, or login counts. Those
fields require separate source, scope, disclosure, permission, freshness, and retention decisions.

## Directory Rollout And Rollback

Deploy the API and Nuxt directory from the same release. The canonical row shape, filter and sort
inputs, and opaque cursor version are one contract; do not intentionally operate mismatched server
and Nuxt versions. This release requires no data migration or backfill. Its maximum-size query plan
uses the existing schema, and directory preferences remain browser-local presentation state.

In-flight cursors are ephemeral and memory-only. A server change may reject an older cursor with the
typed invalid-directory-input response, after which the workspace returns to the first page and
announces the reset. Do not translate or persist old cursors. Saved column layouts carry their own
schema version; an old version, unknown or duplicate field, missing locked field, corrupt value, or
storage failure falls back to or repairs against the current field catalogue without member data.

For rollback, restore the prior API and Nuxt pair together. Do not reverse a database migration,
because this directory adds none. The newer browser preference key may remain: the prior client
ignores it, and a later compatible client validates its version before use. Existing session,
organization-version, compliance, block, reviewer-role, exact-permission, module, and section gates
remain authoritative across rollout and rollback. Authorization loss, logout, organization changes,
or module disablement must continue to remove the affected private queries and selected target before
another directory or contribution request runs.

## Retention And SLOs

Member Audit stores intentional reviewer DTOs, not raw ESI responses.

| Evidence                                              | Retention and collection objective                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Trained skills                                        | Latest complete current-authority snapshot only; refresh interval 60 minutes                              |
| Skill queue                                           | Not collected                                                                                             |
| Assets and eligible custom names                      | Latest complete current-authority snapshot only; refresh interval 60 minutes                              |
| Wallet balance                                        | Latest complete current-authority snapshot only; refresh interval 15 minutes                              |
| Wallet journal and transactions                       | Source-timestamp retention of at most 90 days; refresh interval 15 minutes                                |
| Mail headers and sanitized plain text                 | Source-timestamp retention of at most 90 days; refresh interval 15 minutes; raw markup is never persisted |
| Incomplete continuation, staging, and promotion state | At most 24 hours                                                                                          |

Rows at or before the exclusive 90-day cutoff are not promoted or returned. Re-observation cannot
extend retention because expiry derives from the immutable source timestamp.

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

Member Audit and all six sections default disabled. Use deployment-administrator sessions with:

- `PUT /api/admin/modules/member-audit` and `{ "enabled": true }` for the module.
- `PUT /api/admin/modules/member-audit/sections/:sectionId` and `{ "enabled": true|false }` for
  `overview`, `skills`, `assets`, `wallet`, `mail`, or `access-management`.

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
   invalid authority are absent using counts only. Do not select evidence payloads.
5. If cleanup cannot complete within 24 hours, keep the section or module disabled and follow the
   incident procedure below.

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
