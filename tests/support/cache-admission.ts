import { coreOrganizationAdmissionScopes } from '@eve-space/platform-module-contract'

export function cacheAdmissionForCharacter(userId: string, characterId: number) {
  return {
    userId,
    characters: [
      {
        characterId,
        admissionRevision: `e2e-character-${characterId}-revision`,
      },
    ],
    organization: null,
  }
}

export function cacheAdmissionForOrganization(
  userId: string,
  characterId: number,
  organizationVersion = 1,
) {
  return {
    userId,
    characters: [
      {
        characterId,
        admissionRevision: `organization-character-${characterId}-revision`,
      },
    ],
    organization: {
      organizationVersion,
      admissionRevision: `organization-${organizationVersion}-revision`,
      validUntil: null,
      admissionScopes: [
        coreOrganizationAdmissionScopes.activities,
        coreOrganizationAdmissionScopes.rosterCoverage,
      ],
    },
  }
}
