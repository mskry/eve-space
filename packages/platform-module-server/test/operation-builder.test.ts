import { describe, expect, it } from 'vitest'
import { definePlatformExecutableEsiOperation } from '../src/index.js'

const policy = {
  audit: { reviewedDate: '2026-09-26' },
  cache: { kind: 'none' },
  identity: { kind: 'ordered', fields: [] },
  representationVersion: 'v1',
  retry: { kind: 'none' },
} as const

describe('generated ESI operation definition', () => {
  it.each([
    ['GetStatus', 'public', [], null],
    ['GetCorporationsProjectsListing', 'oauth', ['corporation_id'], null],
    ['GetCorporationsFreelanceJobsListing', 'oauth', ['corporation_id'], 'Project_Manager'],
  ] as const)('derives %s from its descriptor', (sdkOperationId, kind, subjects, role) => {
    const definition = definePlatformExecutableEsiOperation({ sdkOperationId, policy })
    expect(definition.contract.authorization.kind).toBe(kind)
    expect(definition.contract.rateGroup).toEqual(
      definition.descriptor.transport.protocol.rateLimit,
    )
    expect(definition.contract.compatibility.minimumDate).toBe(
      definition.descriptor.transport.minimumCompatibilityDate,
    )
    expect(definition.descriptor.transport.requestSubjectBindings).toEqual(subjects)
    expect(definition.descriptor.transport.requiredRoles).toEqual(role ? [role] : [])
    expect(definition.contract.authorization.subjectBindings).toEqual(subjects)
    expect(definition.contract.authorization.requiredRolePredicate).toBe(
      role ? 'project-manager' : null,
    )
  })

  it('rejects module-authored generated policy even when passed dynamically', () => {
    // SAFETY: this test deliberately bypasses the builder type to verify its runtime override rejection.
    expect(() =>
      definePlatformExecutableEsiOperation({
        sdkOperationId: 'GetCorporationsProjectsListing',
        policy: { ...policy, authorization: { kind: 'public' } } as never,
      }),
    ).toThrow('Module cannot override generated ESI policy')
  })
})
