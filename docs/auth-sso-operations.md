# EVE SSO token recovery

When EVE rotates a character's refresh token, the API first commits the encrypted response to
`pending_character_tokens`. Verification then runs against the pending access token. A successful
verification promotes it and removes the pending row in the same transaction that advances the
character's verified authorization generation. A pending row is not a usable access token and does
not grant cached character access.

If discovery, JWKS, or verification transport is unavailable, a protected character read returns
temporary unavailability (`503`). Keep the character attached and retry later: the next read
verifies the persisted pending access token; if it has expired, it refreshes only with the pending
refresh token. The old verified refresh token may already be spent and must not be retried. An
independent character remains usable. Never copy pending credentials, ciphertext, or bearer values
into logs, telemetry, support tickets, or queue payloads.

A definitive `invalid_grant`/`invalid_token` on the pending refresh, a proven-invalid signed access
token, or an exact-character/owner mismatch requires fresh character authorization. In this case
the pending state and potentially spent predecessor are retired under the character lock, with the
normal dependent-authority invalidation. An uncertain signing key or upstream failure is not proof
of invalid authorization; leave the pending row for recovery. An exact-character reauthorization
supersedes the old attempt rather than allowing an in-flight verifier to promote it.

For an unresolved pending attempt, confirm the row's character ID, lifecycle, generation, attempt
revision, and age without inspecting token material. Check SSO availability and retry a character
read after recovery. Do not delete pending rows by age or roll back to an older API/worker binary
that ignores them.
