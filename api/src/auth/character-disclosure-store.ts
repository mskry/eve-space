import { and, eq, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characterReviewerDisclosureAcceptances,
  deploymentModules,
  deploymentModuleSections,
  eveTokens,
} from '../db/schema.js'
import {
  parseReviewerUseDisclosures,
  type ReviewerUseDisclosure,
} from '../reviewer-use-disclosure.js'

type DisclosureWriter = Pick<DatabaseTransaction, 'delete' | 'insert' | 'update'>
type DisclosureReader = Pick<DatabaseTransaction, 'select'>

export type CharacterReviewerDisclosureEligibility =
  | {
      readonly status: 'eligible'
      readonly authorizationGeneration: number
      readonly disclosureVersion: number
    }
  | {
      readonly status: 'authorization-required'
      readonly authorizationGeneration: number | null
      readonly disclosureVersion: number
    }
  | { readonly status: 'disabled' }

export async function replaceCharacterReviewerDisclosureAcceptances(
  connection: DisclosureWriter,
  input: {
    readonly characterId: number
    readonly authorizationGeneration: number
    readonly disclosures: readonly ReviewerUseDisclosure[]
  },
) {
  const disclosures = parseReviewerUseDisclosures(input.disclosures)
  await connection
    .delete(characterReviewerDisclosureAcceptances)
    .where(eq(characterReviewerDisclosureAcceptances.characterId, input.characterId))
  if (disclosures.length === 0) return

  await connection.insert(characterReviewerDisclosureAcceptances).values(
    disclosures.map((disclosure) => ({
      characterId: input.characterId,
      moduleId: disclosure.moduleId,
      sectionId: disclosure.sectionId,
      disclosureVersion: disclosure.disclosureVersion,
      authorizationGeneration: input.authorizationGeneration,
    })),
  )
}

export async function advanceCharacterReviewerDisclosureAcceptances(
  connection: Pick<DatabaseTransaction, 'update'>,
  characterId: number,
  previousAuthorizationGeneration: number,
) {
  await connection
    .update(characterReviewerDisclosureAcceptances)
    .set({
      authorizationGeneration: sql`${characterReviewerDisclosureAcceptances.authorizationGeneration} + 1`,
    })
    .where(
      and(
        eq(characterReviewerDisclosureAcceptances.characterId, characterId),
        eq(
          characterReviewerDisclosureAcceptances.authorizationGeneration,
          previousAuthorizationGeneration,
        ),
      ),
    )
}

export async function resolveCharacterReviewerDisclosureEligibility(
  characterId: number,
  moduleId: string,
  sectionId: string,
  connection: DisclosureReader = db,
): Promise<CharacterReviewerDisclosureEligibility> {
  const [record] = await connection
    .select({
      moduleEnabled: deploymentModules.enabled,
      sectionEnabled: deploymentModuleSections.enabled,
      sectionKind: deploymentModuleSections.kind,
      disclosureVersion: deploymentModuleSections.disclosureVersion,
      tokenVersion: eveTokens.tokenVersion,
      acceptedDisclosureVersion: characterReviewerDisclosureAcceptances.disclosureVersion,
      acceptedAuthorizationGeneration:
        characterReviewerDisclosureAcceptances.authorizationGeneration,
    })
    .from(deploymentModuleSections)
    .innerJoin(deploymentModules, eq(deploymentModules.moduleId, deploymentModuleSections.moduleId))
    .leftJoin(eveTokens, eq(eveTokens.characterId, characterId))
    .leftJoin(
      characterReviewerDisclosureAcceptances,
      and(
        eq(characterReviewerDisclosureAcceptances.characterId, characterId),
        eq(characterReviewerDisclosureAcceptances.moduleId, deploymentModuleSections.moduleId),
        eq(characterReviewerDisclosureAcceptances.sectionId, deploymentModuleSections.sectionId),
      ),
    )
    .where(
      and(
        eq(deploymentModuleSections.moduleId, moduleId),
        eq(deploymentModuleSections.sectionId, sectionId),
      ),
    )

  if (
    !record?.moduleEnabled ||
    !record.sectionEnabled ||
    record.sectionKind !== 'sensitive-evidence'
  )
    return { status: 'disabled' }

  const authorizationGeneration = record.tokenVersion ?? null
  if (
    authorizationGeneration === null ||
    record.acceptedAuthorizationGeneration !== authorizationGeneration ||
    record.acceptedDisclosureVersion !== record.disclosureVersion
  )
    return {
      status: 'authorization-required',
      authorizationGeneration,
      disclosureVersion: record.disclosureVersion,
    }

  return {
    status: 'eligible',
    authorizationGeneration,
    disclosureVersion: record.disclosureVersion,
  }
}
