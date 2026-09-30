# Public Market catalogue delivery

The default-enabled `market` release declares the route-only public `market-catalogue` core-data product and contributes its `/market` sidebar entry. Its route is available only while Market is installed and enabled; an existing administrator-disabled setting remains disabled. No application session or Industry release is required. PostgreSQL's committed SDE projection is the authority. Missing projection version 5, invalid hierarchy, count breach, or database failure returns `503` with `Cache-Control: no-store`. A disabled release returns `404` before the handler or core-data read.

## Revision-pinned requests

| Request                                                                               | Result                                                          | Cache policy                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------- |
| `GET /api/modules/market/catalogue/revision`                                          | `{ key, revision: { buildNumber, ingestVersion, ingestedAt } }` | `public, max-age=30, must-revalidate` |
| `GET /api/modules/market/catalogue/body/<key>/tree`                                   | Complete group hierarchy with direct published-type counts      | `public, max-age=31536000, immutable` |
| `GET /api/modules/market/catalogue/body/<key>/groups/<groupId>/types?cursor=<opaque>` | At most 100 directly assigned items and `nextCursor`            | `public, max-age=31536000, immutable` |
| `GET /api/modules/market/catalogue/body/<key>/search-index`                           | Complete compact global type ID/group/name index                | `public, max-age=31536000, immutable` |

All responses carry a representation-specific weak ETag (`W/"<key>-<representation>"`) so gzip and identity encodings share the same semantic validator. A matching `If-None-Match` returns `304` with the same ETag and cache policy. The public platform route composer applies gzip above its size threshold when the client accepts it, with `Vary: Accept-Encoding`; host route tests decode the actual wire response. The key encodes the exact build number, projection version, and ingestion-time string; a same-build reingest changes it. An old key no longer reconstructible from PostgreSQL returns `404` with `no-store` if a browser or CDN no longer has its immutable body. A current body is reconstructible after disposable cache loss. The client fetches the short-lived revision and public tree for SSR payload reuse, loads direct types for expanded groups in bounded pages as the list end becomes visible, and fetches the global index at four search characters. Group-page query identities include revision, group ID, and cursor; obsolete replies are discarded. A retained previous tree is labelled previous during refresh failure and is never called current.

The tree read validates the complete group hierarchy and direct-type counts in one repeatable-read snapshot. A group-page read verifies the requested group and selects only its first 101 matching published rows ordered by numeric type ID; the extra row determines continuation. Expanding a parent does not fetch descendants. A search-index read bounds the full published assigned set at 32,000 plus one and fails for orphaned assignments instead of silently dropping them. No feature code reads SDE tables directly.

No in-process or Redis body cache is added yet. Each HTTP request, including `304`, invokes one bounded core-data read; browser/shared HTTP caches can reuse immutable bodies without requesting them. Production read frequency and latency should be measured before adding a disposable server cache. The small revision endpoint currently reads the tree product; a future revision-only core-data operation could reduce its database cost without changing revision identity.

## Measured transfer sizes

Using official Tranquility JSONL build 3542233, sorted numeric IDs, compact UTF-8 JSON, and Python `gzip.compress(..., mtime=0)`:

| Representation                                                        | JSON bytes | Gzip bytes |
| --------------------------------------------------------------------- | ---------: | ---------: |
| Complete 2,114-group tree with direct counts                          |    183,281 |     24,789 |
| Complete 19,561-type search index                                     |  1,322,859 |    197,589 |
| First 100 types of largest measured direct group (428 total)          |      6,357 |      1,137 |
| Search index grown to 32,000 types with deterministic synthetic names |  2,107,845 |    262,057 |

The median non-empty direct group has six items. These are representation sizes, not production network latency or browser parse/index benchmarks. The route tests independently exercise 32,000-type transfer and cache reconstruction. Roll back by disabling Market routes/navigation while retaining the additive icon migration and committed SDE history; Industry enablement remains independent.

## Isolated runtime probe

An isolated Compose project on alternate ports rebuilt the API without replacing the existing development API or PostgreSQL volume. Its API applied the Market icon migration (now `019_market_group_icon.sql` after reconciling with `main`) and became healthy after the reviewed ESI scope configuration was supplied. Before Market enablement, the revision route returned `404`; enabled with no SDE projection it returned `503`, and malformed group/cursor paths returned `400`. A one-shot official ingest published build 3542233 at projection version 5 with 2,114 groups (2,084 icon IDs) and 19,561 published market-assigned types. Against the running API after ingest: revision, tree, group 614's three direct types, and search index returned `200`; the index retained type 35912 from an unpublished inventory group; tree and index responses carried gzip; a matching tree ETag returned `304`; an obsolete revision key returned `404`; an invalid group path returned `400`. The isolated API was later restarted on port 8790 for the host Nuxt preview at `http://localhost:3000/market`; the existing API and PostgreSQL volume were not replaced.
