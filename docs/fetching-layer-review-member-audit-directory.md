# Fetching Compliance Review: Member Audit Directory

## Conclusion

The configurable Member Audit directory is compliant within this request-path review. Its entry,
directory, and target queries execute only in the browser, use the credentialed application client,
remain memory-only, and reach a private core route that verifies the current session, organization,
reviewer audience, compliance, block state, directory permission, and summary permission before
loading directory rows.

## Scope

- Review date: 2026-09-20.
- Base commit: `3d3f7911207adce33f6ef02121daf9b1a06bf6b1`, including the uncommitted
  `add-configurable-member-audit-directory` implementation.
- Request paths: organization-review entry, managed-member directory, and exact selected-target
  lookup. Feature contribution requests remain independently gated and are covered by the Member
  Audit module review.
- Governing rules: root `AGENTS.md`, the platform Nuxt package boundary, the accepted OpenSpec change,
  and the [fetching-layer checklist](fetching-layer-compliance-checklist.md).
- This path performs no ESI operation and uses no browser query persistence. ESI freshness, Redis
  coordination, and persisted-snapshot checks are therefore not applicable.

## Request Inventory

| Consumer / query                   | Key and result-changing inputs                                                                                                  | Trigger and SSR behavior                                                                      | Final route and authorization                                                                                                     | Resource / persistence                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `organizationReviewEntryQuery`     | Private reviewer entry key                                                                                                      | Client mount after authenticated session; `import.meta.client` disables SSR                   | `GET /api/organization/review`; `privateNoStore`, `loadSession`, `requireSession`, `loadOrganizationSession`, reviewer entry gate | Installed contribution metadata only; `esiPersistence: none` |
| `organizationReviewDirectoryQuery` | Organization version, normalized search, corporation, group, compliance, block, audit state, sort, direction, cursor, and limit | Client only after session, successful entry, and at least one enabled authorized contribution | `GET /api/organization/review/members`; same middleware plus validated query and core directory projection                        | Core PostgreSQL summary projection; `esiPersistence: none`   |
| `organizationReviewTargetQuery`    | Organization version, target user, optional character, and managed-member lifecycle                                             | Client only after explicit target selection                                                   | `GET /api/organization/review/members/:userId`; same middleware plus current-version target resolution                            | Core target identity only; `esiPersistence: none`            |

All requests use `createPlatformApiClient`, whose Hono client initialization sets
`credentials: 'include'`. The root application mounts the chained platform router at
`/api/organization/review` after credentialed CORS and CSRF middleware.

## Authorization And Privacy Evidence

- `organizationReviewerPlatformRoutes` applies `privateNoStore`, `loadSession`, `requireSession`, and
  `loadOrganizationSession` to every entry, directory, and target request. Responses carry
  `Cache-Control: private, no-store` and `Vary: Cookie`.
- `createOrganizationReviewerEntryGate` starts from currently installed and enabled reviewer
  contributions. For a contribution with a directory permission, it calls
  `authorizeOrganizationReviewerContribution` with that permission and
  `member-audit.summary.read` as additional requirements.
- Reviewer authorization rejects an active block, anything short of full current compliance, an
  ordinary-member or owner-only audience, and missing group permissions. Its database checks bind
  grants and permission assignments to the current deployment organization version.
- The directory query receives only the organization version loaded by middleware. The repeatable-read
  projection rechecks that version before returning; exact-target lookup also fails closed when the
  current version or managed scope changes.
- Route tests prove ordinary member, owner-only, deployment-administrator, missing search, missing
  summary, blocked, noncompliant, disabled-contribution, and out-of-scope requests return no enriched
  rows. PostgreSQL and target tests cover organization-version changes during projection/resolution.
- Canonical rows contain bounded lifecycle, identity, group, compliance/block, count, and aggregate
  collection metadata only. Route and component tests exclude raw evidence/resource records, token
  fields, hidden-character claims, activity/login fields, and CSV/export surfaces.

## Query Identity And Lifecycle Evidence

- The directory key is under `PRIVATE_QUERY_KEYS.organizationReviewerVersion` and distinguishes every
  result-changing input. The target key also binds the organization version and selected lifecycle.
- Each query declares `esiPersistence: { kind: 'none' }`; directory rows, filters, sort state,
  cursors, and selected targets are never written by the browser persister. The separate column
  preference stores only `{ version, fieldIds }` after mount.
- Search, corporation, group, compliance, block, audit, sort, direction, and page-size changes clear
  the current cursor and history before the replacement request. Invalid/stale cursors recover to
  page one through the typed `INVALID_REVIEWER_DIRECTORY_INPUT` outcome.
- Organization-version changes remove the prior reviewer-version scope. Canonical authorization
  denial removes the current reviewer scope, logout uses the shared private-query lifecycle, and
  module/section disablement removes contribution queries while the workspace stops presenting the
  directory when no compatible contribution remains.
- The page never renders the table during SSR. Column preferences use documented defaults for SSR and
  initial hydration, then read local storage in `onMounted`.

## Checklist Results

| Checks                                    | Result                  | Evidence / reason                                                                                                                                               |
| ----------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-01, MOD-05, MOD-06                    | PASS                    | Typed application DTOs and shared query/lifecycle interfaces are used; no ESI, storage, or feature-directory substitute exists                                  |
| AUTH-01 through AUTH-07                   | PASS for reviewed paths | Final mount, middleware, browser-only gates, current organization/reviewer permissions, presentation closure, and credentialed client were inspected and tested |
| QUERY-01 through QUERY-05                 | PASS for reviewed paths | Keys cover every input, private scopes are version-bound, stale contexts are removed, DTOs come from `AppType`, and chained validated routes are preserved      |
| QUERY-06                                  | N/A                     | The directory path is read-only                                                                                                                                 |
| TIME-01 through TIME-07                   | N/A                     | The directory performs no ESI/cacheable-resource operation and persists no query result                                                                         |
| PERSIST-01, PERSIST-04 through PERSIST-10 | PASS or N/A             | Query persistence is explicitly disabled; hydration and shared private lifecycle behavior remain applicable and covered                                         |
| PERSIST-02, PERSIST-03                    | N/A                     | No directory result enters the official persister                                                                                                               |
| ESI-01 through ESI-10                     | N/A                     | No directory request performs ESI work                                                                                                                          |

## Verification

| Command                                                                                                                                                                                                                                                                                         | Result          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `pnpm exec vitest run tests/organization/organization-review-directory-fields.test.ts tests/organization/organization-review-directory-presentation.test.ts tests/organization/organization-review-directory-column-preferences.test.ts tests/organization/organization-review-queries.test.ts` | 40 tests passed |
| `pnpm exec vitest run --config vitest.ui.config.ts tests/organization/organization-review-directory.nuxt.test.ts tests/organization/organization-review-workspace.nuxt.test.ts`                                                                                                                 | 32 tests passed |
| `EVE_SPACE_E2E_PERSISTENCE_FIXTURE=1 pnpm exec vitest run --config vitest.e2e.config.ts tests/organization/member-audit-review.e2e.test.ts`                                                                                                                                                     | 2 tests passed  |

Broader repository verification is tracked by the OpenSpec implementation checklist and is not
implied by this focused review.
