/**
 * Core modules still reaching ESI through the pre-representation seam.
 *
 * This list may only shrink. A module that no longer imports the seam is reported as a stale
 * entry, so a completed migration must delete its line, and a module that starts importing the
 * seam without being listed is rejected. When the list empties, the seam itself can be deleted.
 *
 * The egress verifier and its test both read this list. Keep it here rather than copying it, so a
 * migration cannot delete an entry from one and leave the other behind.
 */
export const legacyEsiEgressModules = [
  'api/src/characters/history.ts',
  'api/src/characters/profile.ts',
  'api/src/corporations/public-data.ts',
  'api/src/deployment/organization.ts',
  'api/src/mail/mailbox.ts',
  'api/src/organization/authority.ts',
]
