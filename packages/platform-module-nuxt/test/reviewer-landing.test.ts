import type { PlatformReviewerPanelCatalogEntry } from '../src/runtime/reviewer-panel.js'
import {
  resolveCharacterLandingPanels,
  resolveReviewerDirectoryActions,
} from '../src/runtime/reviewer-landing.js'
import { describe, expect, test, vi } from 'vitest'

const userId = '00000000-0000-4000-8000-000000000002'
const subjectLifecycleId = '00000000-0000-4000-8000-000000000021'
const target = {
  userId,
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  character: {
    characterId: 90_000_002,
    subjectLifecycleId,
    authorizationGeneration: 4,
    name: 'Selected Alt',
    isMain: false,
    affiliation: {
      corporationId: 98_000_001,
      allianceId: null,
      membership: 'managed' as const,
      freshness: 'fresh' as const,
      checkedAt: '2026-09-18T12:00:00Z',
    },
  },
}

const panel = (
  contributionId: string,
  sectionId: string,
  order: number,
): PlatformReviewerPanelCatalogEntry => ({
  audience: 'hr',
  contributionId,
  description: 'Read-only reviewer panel',
  icon: 'character',
  label: contributionId,
  load: vi.fn(),
  moduleId: 'member-audit',
  order,
  panelExport: `./reviewer/${contributionId}`,
  placement: 'character-landing',
  requiredPermission: `member-audit.${sectionId}.read`,
  routeId: `${contributionId}-route`,
  routePath: `/api/modules/member-audit/accounts/:userId/characters/:characterId/${contributionId}`,
  sectionId,
  target: 'managed-organization-character',
})

const profile = panel('profile', 'overview', 100)
const observation = panel('observation', 'current-observation', 110)
const admission = (entry: PlatformReviewerPanelCatalogEntry) => ({
  moduleId: entry.moduleId,
  contributionId: entry.contributionId,
  routeId: entry.routeId,
  routePath: entry.routePath,
  sectionId: entry.sectionId,
  target: entry.target,
  placement: entry.placement,
})
const sections = [
  { moduleId: 'member-audit', sectionId: 'overview', activationVersion: 2, disclosureVersion: 0 },
  {
    moduleId: 'member-audit',
    sectionId: 'current-observation',
    activationVersion: 5,
    disclosureVersion: 3,
  },
]
const input = () => ({
  installed: [observation, profile],
  authorized: [admission(profile), admission(observation)],
  enabledModuleIds: new Set(['member-audit']),
  enabledSections: sections,
  authenticated: true,
  organizationVersion: 7,
  expectedCharacterId: 90_000_002,
  target,
})

describe('flat reviewer character landing', () => {
  test('resolves declared directory actions without feature-specific identifiers', () => {
    const review: PlatformReviewerPanelCatalogEntry = {
      ...panel('identity-card', 'identity', 100),
      moduleId: 'other-feature',
      requiredPermission: 'other-feature.identity.read',
      directoryAction: 'review',
    }
    const manage: PlatformReviewerPanelCatalogEntry = {
      ...panel('restrict', 'controls', 200),
      moduleId: 'other-feature',
      requiredPermission: 'other-feature.accounts.manage',
      placement: undefined,
      target: 'managed-organization-account',
      directoryAction: 'manage-account',
    }
    const undeclared = panel('ignored', 'overview', 1)
    expect(resolveReviewerDirectoryActions([manage, undeclared, review])).toStrictEqual({
      reviewCharacter: review,
      manageAccount: manage,
    })
    expect(resolveReviewerDirectoryActions([undeclared])).toStrictEqual({
      reviewCharacter: undefined,
      manageAccount: undefined,
    })
    expect(review.load).not.toHaveBeenCalled()
    expect(manage.load).not.toHaveBeenCalled()
  })

  test('prefers landing review, then character review, then account review in stable order', () => {
    const landing = { ...profile, directoryAction: 'review' as const }
    const character = {
      ...panel('evidence', 'evidence', 20),
      placement: undefined,
      directoryAction: 'review' as const,
    }
    const account = {
      ...character,
      target: 'managed-organization-account' as const,
      order: 1,
    }
    expect(resolveReviewerDirectoryActions([account, character, landing]).reviewCharacter).toBe(
      landing,
    )
    expect(resolveReviewerDirectoryActions([account, character]).reviewCharacter).toBe(character)
    expect(resolveReviewerDirectoryActions([account]).reviewCharacter).toBe(account)
    const later = { ...landing, contributionId: 'later', order: 200 }
    expect(resolveReviewerDirectoryActions([later, landing]).reviewCharacter).toBe(landing)
  })

  test('orders independent panels with their own section authority', () => {
    const entries = resolveCharacterLandingPanels(input())
    expect(entries.map(({ panel: entry }) => entry.contributionId)).toStrictEqual([
      'profile',
      'observation',
    ])
    expect(entries[0]?.props.target).toMatchObject({
      characterId: 90_000_002,
      characterLifecycleId: subjectLifecycleId,
      sectionActivationVersion: 2,
      disclosureVersion: 0,
    })
    expect(entries[1]?.props.target).toMatchObject({
      characterId: 90_000_002,
      characterLifecycleId: subjectLifecycleId,
      sectionActivationVersion: 5,
      disclosureVersion: 3,
    })
    expect(profile.load).not.toHaveBeenCalled()
    expect(observation.load).not.toHaveBeenCalled()
  })

  test('keeps the profile when observation permission or activation is lost', () => {
    expect(
      resolveCharacterLandingPanels({ ...input(), authorized: [admission(profile)] }),
    ).toHaveLength(1)
    expect(
      resolveCharacterLandingPanels({ ...input(), enabledSections: [sections[0]!] }),
    ).toHaveLength(1)
    expect(
      resolveCharacterLandingPanels({ ...input(), enabledModuleIds: new Set<string>() }),
    ).toStrictEqual([])
  })

  test('rejects a changed exact target and never loads explicit evidence tabs', () => {
    const skills = { ...panel('skills', 'skills', 120), placement: undefined }
    const entries = resolveCharacterLandingPanels({
      ...input(),
      installed: [skills, profile],
      authorized: [admission(skills), admission(profile)],
    })
    expect(entries.map(({ panel: entry }) => entry.contributionId)).toStrictEqual(['profile'])
    expect(
      resolveCharacterLandingPanels({ ...input(), expectedCharacterId: 90_000_001 }),
    ).toStrictEqual([])
    expect(skills.load).not.toHaveBeenCalled()
  })
})
