import { coreOrganizationAdmissionScopes } from '@eve-space/platform-module-contract/server'

export function cacheAdmissionForCharacter(userId: string, characterId: number) {
  return {
    characters: [
      {
        characterId,
        admissionRevision: `e2e-character-${characterId}-revision`,
      },
    ],
    organization: null,
    userId,
  }
}

export function cacheAdmissionForOrganization(
  userId: string,
  characterId: number,
  organizationVersion = 1,
) {
  return {
    characters: [
      {
        characterId,
        admissionRevision: `organization-character-${characterId}-revision`,
      },
    ],
    organization: {
      admissionRevision: `organization-${organizationVersion}-revision`,
      admissionScopes: [
        coreOrganizationAdmissionScopes.activities,
        coreOrganizationAdmissionScopes.rosterCoverage,
      ],
      organizationVersion,
      validUntil: null,
    },
    userId,
  }
}
