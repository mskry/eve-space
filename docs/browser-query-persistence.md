# Browser Query Persistence

EVE Space keeps a bounded subset of successful ESI-derived query results in the browser's
IndexedDB storage. This cache can preserve useful presentation data across reloads and short ESI
outages. It is a disposable browser snapshot, not an offline mode, an authorization record, or a
source of current permissions.

## Privacy Model

Only query definitions with an explicit persistence classification are eligible. The stored
versioned envelope can contain public ESI application DTOs and private DTOs partitioned by character
or organization admission scope. Errors are not persisted.

Sessions, administrator state, credentials, EVE access and refresh tokens, cookie values, API
secrets, encryption material, mutations, and authorization decisions are ineligible. The browser
stores application DTOs rather than raw ESI responses.

Private snapshots remain quarantined until the live application session verifies the same user and
`GET /api/me/cache-admission` confirms the current character revision or organization version,
authorization revision, validity deadline, and permitted admission scope. Each admission expires at
most 30 seconds after its request began and is renewed before then, or earlier when an organization
deadline requires it.
Logout, session failure, owner changes, authorization changes, and relevant organization or module
changes invalidate affected private partitions in memory and IndexedDB across tabs.

Persisted data never grants access. Protected requests, mutations, ownership checks, scope checks,
and organization authorization still require current server approval. If EVE Space cannot verify a
private partition or its durable invalidation generation, it discards or hides that partition and
continues with normally authorized live requests.

IndexedDB belongs to the browser profile and origin. People or software with access to that browser
profile or same-origin script execution may be able to inspect its contents. Users on shared devices
should log out and clear site data when finished.

## Retention And Presentation

Eligible results expire 24 hours after their original successful load. Reloading, restoring,
serializing, local updates, or a failed refresh does not move that absolute deadline. A successful
current response starts a new retention period; repeated server-stale responses retain the existing
deadline unless the server supplies an authoritative earlier success time.

The persisted envelope retains the newest 128 results per public, character, or organization-scope
partition, at most 512 results in total, and at most 4 MiB of UTF-8 JSON. Ties use the serialized
query key for deterministic selection. Restoration rejects snapshots exceeding any limit before
their entries can be admitted.

The interface distinguishes two degraded presentations:

- **Historical data, refresh failed.** EVE Space is showing an admitted browser snapshot after the
  current refresh failed. The indicator includes the time of the last current result and available
  retry or failure details.
- **Server-stale data.** The API successfully returned its last validated ESI representation. The
  indicator can include the server validation time, retained-from time, refresh-failure class, and
  retry boundary.

Historical data is informational. It must not be used to infer current ownership, scope,
organization membership, compliance, permission, or mutation eligibility.

Public browser data is released only after Nuxt hydration and only when no successful current result
exists. A successful server-rendered or client-fetched result always wins over an older browser
snapshot. Private browser data additionally requires live identity and admission before it can
render.

## Best-Effort Storage

Browser persistence is optional. IndexedDB may be unavailable, blocked, corrupt, over quota, or
cleared by the browser or user. EVE Space treats these outcomes as cache misses, removes malformed or
unsupported records when possible, disables unsafe private persistence, and continues using its
normal live query path. Storage readiness does not imply identity or private admission readiness.

## Clearing Browser Data

To remove the cache for one browser profile:

1. Log out of EVE Space.
2. Close other EVE Space tabs for the same deployment.
3. Use the browser's site-data settings to clear stored data for the deployment origin.

For targeted developer cleanup, open browser developer tools, select **Application**, then
**IndexedDB**, and delete the `eve-space-query-cache` database. Reload the page afterward. Deleting
all site data may also remove cookies and other application preferences.

## Rollback And Removal

The browser envelope is disposable and has no PostgreSQL migration or server recovery dependency.
Rolling back to a client that does not read its envelope leaves the IndexedDB database inert, but it
does not physically remove it.

Use this sequence when removing or replacing persistence:

1. Stop new persistence reads and writes in the client while retaining normal live queries.
2. Ship a cleanup release that closes persistence database connections and deletes the
   `eve-space-query-cache` IndexedDB database, or move to a new incompatible database name and treat
   the old database as cleanup-only data.
3. Keep cleanup available for at least the 24-hour retention window for clients that do not update
   immediately.
4. Verify that logout, current-session failure, and cross-tab invalidation still clear in-memory
   private query data before completing the rollback.

For urgent origin-wide containment, an operator may clear browser storage through browser policy or
an intentional `Clear-Site-Data: "storage"` response. That header affects all origin storage and
must be reviewed separately from ordinary cache cleanup; clearing cookies as well will log users
out.
