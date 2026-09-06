export class OrganizationGroupMutationError extends Error {
  constructor(
    readonly code:
      | 'manager-authority-required'
      | 'owner-authority-required'
      | 'bundle-name-conflict'
      | 'bundle-not-found'
      | 'group-name-conflict'
      | 'group-not-found'
      | 'target-not-found'
      | 'compliance-group-manual-change'
      | 'compliance-source-mismatch'
      | 'assignment-already-active'
      | 'assignment-not-found'
      | 'invalid-expiry',
  ) {
    super(code)
  }
}
