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

## ESI Operation Review

Reviewed against the EVE API Explorer on 2026-08-31 using requested and resolved
`X-Compatibility-Date: 2026-08-18`, `X-Tenant: tranquility`, and `@evespace/esi-client` 2.0.0. Every
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
