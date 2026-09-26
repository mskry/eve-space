export class OrganizationGroupMutationError extends Error {
  constructor(
    readonly code:
      | 'manager-authority-required'
      | 'owner-authority-required'
      | 'bundle-name-conflict'
      | 'bundle-not-found'
      | 'permission-unavailable'
      | 'retained-permission-invalid'
      | 'group-name-conflict'
      | 'group-not-found'
      | 'target-not-found'
      | 'compliance-group-manual-change'
      | 'rule-group-manual-change'
      | 'rule-not-found'
      | 'rule-revision-conflict'
      | 'invalid-rule-condition'
      | 'compliance-source-mismatch'
      | 'assignment-already-active'
      | 'assignment-not-found'
      | 'invalid-expiry',
  ) {
    super(code)
  }
}
