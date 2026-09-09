# Organization Platform

## Product And Policy Boundary

EVE Space governs one configured corporation or alliance while delivering capabilities through
individually authorized characters. A corporation deployment manages that corporation. An alliance
deployment manages the corporations returned by the current alliance-corporations collection.

Organizations may require each member to disclose and attach every character. Compliance evaluates
every attached character, its required scopes, fresh affiliation, and any explicit audited exception.
This is a disclosure policy, not an account-discovery guarantee. EVE SSO authorizes one selected
character at a time and provides no supported complete account roster, so EVE Space cannot discover
all of a person's characters or prove that no undisclosed character exists.

Alliance roster coverage is corporation-scoped. Public alliance membership identifies corporation
IDs, but each corporation's private member roster requires an eligible token character from that
corporation with `esi-corporations.read_corporation_membership.v1`. Missing, stale, or unauthorized
corporation coverage remains explicit and is never presented as an empty or complete roster.

Managed-organization identity, versioned compliance, roles, groups, blocks, audit, and authorization
middleware are core because they protect every installed module. Organization activity collection,
snapshot storage, activity providers, and detail pages belong to an installed module. The local
deployment administrator controls deployment settings and module enablement but receives no private
organization permission from that authority.

## Local Organization Fixture

The organization fixture is a one-shot development aid for exercising member, HR, director, owner,
corporation-source, compliance-group, and organization-activity behavior through production services.
It creates synthetic identities and encrypted synthetic EVE tokens; it does not call ESI or bypass
authorization. The deployment administrator login is `fixture-admin@localhost` with password
`eve-space-fixture`, and the attached character is `Fixture Director` (`90000001`).

Use a new disposable PostgreSQL database whose name is `eve_space_fixture` or starts with
`eve_space_fixture_`. Stop every API and worker process that points at that database before seeding,
and keep the worker disabled until seeding completes. Create the database with the same local role as
the normal development database, then run from the repository root:

```bash
NODE_ENV=development \
DATABASE_URL='postgres://eve_space:<local-password>@127.0.0.1:5432/eve_space_fixture' \
pnpm dev:fixture:organization -- \
  --confirm-database=eve_space_fixture \
  --session-handoff=/tmp/eve-space-fixture-session.html
```

Replace `<local-password>` locally; do not place it in documentation, shell output, or source control.
The command rebuilds server-module dependencies, verifies `NODE_ENV=development`, requires a loopback
PostgreSQL host, compares the connected database with the exact confirmation argument, applies startup
migrations, and refuses any database containing application or fixture state. It prints only the
synthetic organization IDs, resource count, and handoff-file path. The mode-`0600` handoff file holds
the application session bearer without printing it or placing it in a request URL.

After seeding, point a development-only API at the fixture database, open the handoff file in a browser,
and select **Sign in as Fixture Director**. The form posts the bearer in the request body to the
development-only session-cookie exchange and redirects to the UI with the normal HttpOnly session
cookie. Delete the handoff file immediately after signing in. Start the worker only if queue-backed
behavior is required. Never change the normal shared `.env` to the fixture URL while other processes
are running. Drop the entire fixture database when testing is complete; fixtures are not updated,
reset, or reused.

## ESI Operation Review

Re-reviewed against the EVE API Explorer and its official OpenAPI document on 2026-09-07 using requested and resolved
`X-Compatibility-Date: 2026-08-18`, `X-Tenant: tranquility`, and `@evespace/esi-client` 3.0.1. Every
listed operation supports `ETag`/`If-None-Match` and `Last-Modified`/`If-Modified-Since`. Runtime
`Expires` and `Cache-Control` remain authoritative over the documented fallback. Event-based entries
without a client TTL use runtime metadata only.

| Use                                  | ESI operation and route                                                                                                                | Authorization                                                                                  | Minimum compatibility | Cache fallback            | Rate group                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------- | ------------------------- | --------------------------------- |
| Alliance corporations                | `GetAlliancesAllianceIdCorporations`, `GET /alliances/{alliance_id}/corporations`                                                      | Public                                                                                         | `2020-01-01`          | 3600 seconds              | Legacy only; no declared group    |
| Corporation roster                   | `GetCorporationsCorporationIdMembers`, `GET /corporations/{corporation_id}/members`                                                    | `esi-corporations.read_corporation_membership.v1`; token character belongs to that corporation | `2020-01-01`          | 3600 seconds              | `corp-member`, 300/15m            |
| Character corporation roles          | `GetCharactersCharacterIdRoles`, `GET /characters/{character_id}/roles`                                                                | `esi-characters.read_corporation_roles.v1`                                                     | `2020-01-01`          | 3600 seconds              | `char-detail`, 600/15m            |
| Corporation project list             | `GetCorporationsProjectsListing`, `GET /corporations/{corporation_id}/projects`                                                        | `esi-corporations.read_projects.v1`                                                            | `2025-08-26`          | Event-based, runtime only | `corp-project`, 600/15m           |
| Corporation project detail           | `GetCorporationsProjectsDetail`, `GET /corporations/{corporation_id}/projects/{project_id}`                                            | `esi-corporations.read_projects.v1`                                                            | `2025-08-26`          | Event-based, 60 seconds   | `corp-project`, 600/15m           |
| Project contributors                 | `GetCorporationsProjectsContributors`, `GET /corporations/{corporation_id}/projects/{project_id}/contributors`                         | `esi-corporations.read_projects.v1`; `Project_Manager` role                                    | `2025-08-26`          | Event-based, runtime only | `corp-project`, 600/15m           |
| Exact-character project contribution | `GetCorporationsProjectsContribution`, `GET /corporations/{corporation_id}/projects/{project_id}/contribution/{character_id}`          | `esi-corporations.read_projects.v1`; exact eligible character                                  | `2025-08-26`          | Event-based, 60 seconds   | `corp-project`, 600/15m           |
| Public freelance jobs                | `GetFreelanceJobsListing`, `GET /freelance-jobs`                                                                                       | Public                                                                                         | `2025-12-16`          | Event-based, runtime only | `freelance-job`, 12000/15m        |
| Freelance job detail                 | `GetFreelanceJobsDetail`, `GET /freelance-jobs/{job_id}`                                                                               | Public unless the job ACL requires a participant or owning-corporation manager                 | `2025-12-16`          | Event-based, 60 seconds   | `freelance-job`, 12000/15m        |
| Corporation freelance jobs           | `GetCorporationsFreelanceJobsListing`, `GET /corporations/{corporation_id}/freelance-jobs`                                             | `esi-corporations.read_freelance_jobs.v1`; `Project_Manager` role                              | `2025-12-16`          | Event-based, runtime only | `corp-freelance-job`, 300/15m     |
| Corporation freelance participants   | `GetCorporationsFreelanceJobsParticipants`, `GET /corporations/{corporation_id}/freelance-jobs/{job_id}/participants`                  | `esi-corporations.read_freelance_jobs.v1`; `Project_Manager` role                              | `2025-12-16`          | Event-based, runtime only | `corp-freelance-job`, 300/15m     |
| Character freelance jobs             | `GetCharactersFreelanceJobsListing`, `GET /characters/{character_id}/freelance-jobs`                                                   | `esi-characters.read_freelance_jobs.v1`                                                        | `2025-12-16`          | Event-based, 60 seconds   | `char-freelance-job`, 300/15m     |
| Character freelance participation    | `GetCharactersFreelanceJobsParticipation`, `GET /characters/{character_id}/freelance-jobs/{job_id}/participation`                      | `esi-characters.read_freelance_jobs.v1`                                                        | `2025-12-16`          | Event-based, 60 seconds   | `char-freelance-job`, 300/15m     |
| Military campaigns                   | `GetMilitaryCampaignsListing`, `GET /military-campaigns`                                                                               | Public                                                                                         | `2026-08-04`          | Event-based, 60 seconds   | `military-campaign`, 300/15m      |
| Military campaign detail             | `GetMilitaryCampaignsDetail`, `GET /military-campaigns/{campaign_id}`                                                                  | Public                                                                                         | `2026-08-04`          | Event-based, 60 seconds   | `military-campaign`, 300/15m      |
| Campaign objectives                  | `GetMilitaryCampaignsObjectivesListing`, `GET /military-campaigns/{campaign_id}/objectives`                                            | Public                                                                                         | `2026-08-04`          | Event-based, 60 seconds   | `military-campaign`, 300/15m      |
| Campaign objective detail            | `GetMilitaryCampaignsObjectivesDetail`, `GET /military-campaigns/{campaign_id}/objectives/{objective_id}`                              | Public                                                                                         | `2026-08-04`          | Event-based, 60 seconds   | `military-campaign`, 300/15m      |
| Character campaign objectives        | `GetCharactersMilitaryCampaignsObjectivesListing`, `GET /characters/{character_id}/military-campaigns/objectives`                      | `esi.activity.char:read`                                                                       | `2026-08-04`          | Event-based, 60 seconds   | `char-military-campaign`, 150/15m |
| Character objective participation    | `GetCharactersMilitaryCampaignsObjectivesParticipation`, `GET /characters/{character_id}/military-campaigns/objectives/{objective_id}` | `esi.activity.char:read`                                                                       | `2026-08-04`          | Event-based, 60 seconds   | `char-military-campaign`, 150/15m |

Project lists/contributors, public and corporation freelance lists/participants, public objective lists,
and character objective lists use opaque `before`/`after` cursors with limits from 10 to 100. Initial
collection pages backward with `before` and retains the initial `after` cursor for incremental work.
Do not infer ordering or construct cursor values.

The corporation-source `Project_Manager` requirements above are additional EVE authorization
conditions, not EVE Space organization roles. Each private character or corporation request uses the
exact registered data-source or selected owned character; another attached character's token or scope
must never be substituted.

## Pre-Release Rollout

1. Back up PostgreSQL and the dedicated Queue Redis AOF, verify restore procedures, and record the
   current application image. Do not treat Cache Redis as authoritative data.
2. Deploy the new API and worker so core and installed-module migrations complete, but leave the
   organization-activity module disabled and do not tighten registration policy yet.
3. Confirm the configured corporation or alliance and its current organization version. A correction
   creates a new version; grants, compliance, sources, and observations from the previous version
   cannot authorize the corrected organization.
4. Attach or reauthorize an eligible character with
   `esi-characters.read_corporation_roles.v1`, then complete the separate EVE-backed owner claim.
   Deployment-administrator access is not a substitute for this claim.
5. For a corporation deployment, register one eligible corporation source. For an alliance, register
   a separate eligible source in every managed corporation whose private roster or corporation
   resources must be covered.
6. Wait for fresh managed-corporation, source, and roster collection state. Treat missing, pending,
   stale, or unauthorized coverage as incomplete; never infer an empty corporation roster.
7. Grant HR/director access and configure groups only after owner authority is current. Review the
   resulting immutable audit entries before broadening access.
8. Apply the intended registration scopes and remediation windows. Verify existing accounts converge
   to the expected pending, compliant, review-required, or suspended state before enabling dependent
   services.
9. Enable organization activity, verify member-safe activity and exact-character participation, then
   monitor `/api/status`, queue age, collection freshness, compliance transitions, and provider
   degradation through the rollout window.

## Rollback

- Disable organization activity through module settings first. This removes its routes, providers,
  pages, and collection eligibility without deleting its schema, snapshots, checkpoints, or migration
  ledger.
- If registration enforcement must be relaxed, use a currently verified organization owner to restore
  the previous required scopes and remediation windows. The suspended-owner recovery path may repair a
  policy the verified owner can satisfy; deployment administration still cannot bypass organization
  authority.
- Revoke or pause dependent service gates independently when their entitlement is withdrawn. Do not
  delete attached characters or EVE tokens to roll back an organization policy.
- Preserve organization audit history, domain events, compliance history, roster observations,
  corporation-source history, module storage, and character authorization generations. Do not run
  `docker compose down --volumes` or reverse applied migrations.
- Rolling back to a prior application image is valid only when that image accepts the current additive
  schema and domain-event versions. Otherwise keep the current API/worker and disable the affected
  feature or policy gate.
- Changing back to a previous corporation or alliance creates another organization version. Re-claim
  owner authority and register fresh corporation sources; never reactivate grants or observations from
  an older version.

## Rollout Verification

Record the application revision, organization version, UTC timestamp, and operator for each
deployment verification. The 2026-09-08 local Compose verification rebuilt all five services and
confirmed healthy API, worker, PostgreSQL, Cache Redis, and Queue Redis dependencies. Representative
live probes returned `200` for `/api/status`, canonical `400` validation for a malformed public type
identifier, and `401` before protected organization and character handlers.

The matching focused PostgreSQL and route suites verify owner claim, managed-corporation convergence,
corporation-source coverage, compliant member access, fresh-violation suspension, bounded stale-ESI
grace and recovery, organization-version invalidation, non-owned character isolation, HR/director
authorization, deployment-only administrator refusal, missing-scope responses, and disabled-module
behavior. Run the authoritative full suites before release:

```bash
pnpm --filter @eve-space/api test:coverage
pnpm --filter @eve-space/api test:redis
pnpm test:postgres
pnpm test:modules:coverage
pnpm test:module-conformance
```

Runtime sampling must report only counts or classifications rather than dumping payloads. Check API
and worker logs, Queue Redis job fields, PostgreSQL domain-event payloads and organization audit text,
browser private-query cleanup, and status telemetry for credential markers. Investigate any match in a
restricted environment without copying the value into tickets, logs, or chat.
