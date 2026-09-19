import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ref } from 'vue'
import { describe, expect, test } from 'vitest'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import module from '../src/module.js'
import {
  hasAssetEvidence,
  hasMailEvidence,
  hasTrainedSkillsEvidence,
  hasWalletEvidence,
} from '../src/runtime/app/reviewer/evidence-presentation.js'
import {
  collectionState,
  memberAuditReviewerQueryOptions,
  targetLabel,
  withMemberAuditReviewerQueryState,
} from '../src/runtime/app/reviewer/useMemberAuditReviewerQuery.js'

const reviewerPanels = [
  ['overview', 'member-audit.summary.read'],
  ['trained-skills', 'member-audit.skills.read'],
  ['assets', 'member-audit.assets.read'],
  ['wallet', 'member-audit.wallet.read'],
  ['mail', 'member-audit.mail.read'],
  ['ordinary-groups', 'member-audit.groups.manage'],
  ['member-block', 'member-audit.members.block'],
] as const

const reviewerQuery = async () => ({ value: true })

test('exports a Nuxt module for the member-audit package', () => {
  expect(module).toBeTypeOf('function')
})

test('ships an accessible disabled-state runtime surface without registering a page', async () => {
  const source = await readFile(
    fileURLToPath(
      new URL('../src/runtime/app/components/MemberAuditModuleUnavailable.vue', import.meta.url),
    ),
    'utf8',
  )

  expect(source).toContain('aria-labelledby="member-audit-unavailable-title"')
  expect(source).toContain('must enable the module and its evidence sections')
})

test('exports seven lazy reviewer panels and no feature-owned page', async () => {
  const packageJson = JSON.parse(
    await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { exports: Record<string, string | object> }

  expect(
    Object.keys(packageJson.exports).toSorted((left, right) => left.localeCompare(right)),
  ).toEqual(
    ['.', ...reviewerPanels.map(([id]) => `./reviewer/${id}`)].toSorted((left, right) =>
      left.localeCompare(right),
    ),
  )
  for (const [id, permission] of reviewerPanels) {
    const source = await readFile(
      fileURLToPath(new URL(`../src/runtime/app/reviewer/${id}.vue`, import.meta.url)),
      'utf8',
    )
    expect(source).toContain(permission)
    expect(source).toContain('PlatformReviewerPanelProps')
    expect(source).not.toContain('prefetch')
  }
})

test('scopes reviewer queries to the platform contribution target lifecycle', async () => {
  const helper = await readFile(
    fileURLToPath(
      new URL('../src/runtime/app/reviewer/useMemberAuditReviewerQuery.ts', import.meta.url),
    ),
    'utf8',
  )
  const panels = await Promise.all(
    reviewerPanels.map(async ([id]) =>
      readFile(
        fileURLToPath(new URL(`../src/runtime/app/reviewer/${id}.vue`, import.meta.url)),
        'utf8',
      ),
    ),
  )

  expect(helper).toContain('platformReviewerContributionTargetResourceKey')
  for (const source of panels) {
    expect(source).toContain("esiPersistence: { kind: 'none' }")
    expect(source).toContain("moduleId: 'member-audit'")
    expect(source).toContain("subject: { kind: 'organization'")
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('useAsyncData')
  }
})

test('keeps disclosed-character selection and destructive confirmation bound to the target', async () => {
  const overview = await readFile(
    fileURLToPath(new URL('../src/runtime/app/reviewer/overview.vue', import.meta.url)),
    'utf8',
  )
  expect(overview).toContain('targetCharacterId')
  expect(overview).toContain('Character for evidence panels')

  for (const panel of ['ordinary-groups', 'member-block']) {
    const source = await readFile(
      fileURLToPath(new URL(`../src/runtime/app/reviewer/${panel}.vue`, import.meta.url)),
      'utf8',
    )
    expect(source).toContain('JSON.stringify(props.target)')
    expect(source).toContain('resetAction()')
  }
})

test('forces explicit retries and post-mutation reloads past fresh query caches', async () => {
  for (const panel of reviewerPanels.map(([id]) => id)) {
    const source = await readFile(
      fileURLToPath(new URL(`../src/runtime/app/reviewer/${panel}.vue`, import.meta.url)),
      'utf8',
    )
    expect(source).not.toContain('.refresh()')
    expect(source).toContain('.refetch()')
  }
})

describe('reviewer state presentation', () => {
  test('binds query resources and access to the selected contribution target', () => {
    const props = reviewerProps()

    expect(memberAuditReviewerQueryOptions(props, reviewerQuery)).toEqual({
      access: { ...props.queryAccess, sectionId: props.sectionId },
      query: reviewerQuery,
      resource: [
        'reviewer',
        'contributions',
        'overview',
        'targets',
        'lifecycle',
        'user-id',
        'section-activation',
        1,
      ],
    })
  })

  test.each([
    [
      'missing reviewer authority',
      { authorized: false },
      { data: undefined, error: undefined, status: 'pending' },
      'authorization-required',
    ],
    [
      'disabled module',
      { moduleEnabled: false },
      { data: undefined, error: undefined, status: 'pending' },
      'unavailable',
    ],
    [
      'query failure',
      {},
      { data: undefined, error: new Error('Bounded failure'), status: 'error' },
      'unavailable',
    ],
    [
      'unknown query failure',
      {},
      { data: undefined, error: 'failure', status: 'error' },
      'unavailable',
    ],
    ['pending query', {}, { data: undefined, error: undefined, status: 'pending' }, 'loading'],
    ['ready query', {}, { data: { value: true }, error: undefined, status: 'success' }, 'ready'],
  ] as const)('presents %s state', (_label, access, result, expected) => {
    const props = reviewerProps(access)
    const query = {
      data: ref<unknown>(result.data),
      error: ref<unknown>(result.error),
      status: ref(result.status),
    }

    expect(withMemberAuditReviewerQueryState(props, query).requestState.value.status).toBe(expected)
  })

  test('keeps a complete empty observation ready', () => {
    expect(
      collectionState(
        [
          {
            resourceId: 'assets',
            status: 'current',
            validatedAt: '2026-09-19T08:00:00Z',
          },
        ],
        { status: 'ready' },
      ),
    ).toEqual({ status: 'ready' })
  })

  test('distinguishes stale and authorization-required evidence', () => {
    expect(
      collectionState(
        [{ resourceId: 'assets', status: 'stale', validatedAt: '2026-09-18T08:00:00Z' }],
        { status: 'ready' },
      ),
    ).toMatchObject({ status: 'stale' })
    expect(
      collectionState(
        [
          {
            resourceId: 'mail-headers',
            status: 'authorization-required',
            validatedAt: null,
            requiredScope: 'esi-mail.read_mail.v1',
          },
        ],
        { status: 'ready' },
      ),
    ).toMatchObject({ status: 'authorization-required' })
    expect(
      collectionState(
        [{ resourceId: 'mail-headers', status: 'authorization-required', validatedAt: null }],
        { status: 'ready' },
      ),
    ).toMatchObject({ status: 'authorization-required' })
    expect(
      collectionState([{ resourceId: 'assets', status: 'unavailable', validatedAt: null }], {
        status: 'ready',
      }),
    ).toMatchObject({ status: 'unavailable' })
    expect(
      collectionState([{ resourceId: 'assets', status: 'never-collected', validatedAt: null }], {
        status: 'ready',
      }),
    ).toMatchObject({ status: 'unavailable' })
    expect(collectionState([], { status: 'loading', title: 'Loading' })).toEqual({
      status: 'loading',
      title: 'Loading',
    })
  })

  test('identifies account and character targets', () => {
    const base = {
      moduleId: 'member-audit',
      contributionId: 'overview',
      routeId: 'member-summary',
      organizationVersion: 4,
      queryAccess: { authenticated: true, authorized: true, moduleEnabled: true },
    }
    expect(
      targetLabel({
        ...base,
        target: {
          kind: 'managed-organization-account',
          managedMemberLifecycleId: 'lifecycle',
          userId: 'user-id',
          sectionActivationVersion: 1,
        },
      }),
    ).toBe('Member user-id')
    expect(
      targetLabel({
        ...base,
        target: {
          kind: 'managed-organization-character',
          managedMemberLifecycleId: 'lifecycle',
          userId: 'user-id',
          characterId: 90_000_001,
          characterLifecycleId: 'character-lifecycle',
          authorizationGeneration: 2,
          disclosureVersion: 1,
          sectionActivationVersion: 1,
        },
      }),
    ).toBe('Character 90000001')
  })

  test('detects empty and populated section-specific evidence shapes', () => {
    expect(hasTrainedSkillsEvidence({ trainedSkills: null })).toBe(false)
    expect(
      hasTrainedSkillsEvidence({ trainedSkills: { snapshot: { groups: [{ skills: [] }] } } }),
    ).toBe(false)
    expect(
      hasTrainedSkillsEvidence({
        trainedSkills: { snapshot: { groups: [{ skills: [{ typeId: 1 }] }] } },
      }),
    ).toBe(true)

    expect(hasAssetEvidence(null)).toBe(false)
    expect(hasAssetEvidence({ snapshot: { records: [] } })).toBe(false)
    expect(hasAssetEvidence({ snapshot: { records: [{ itemId: 1 }] } })).toBe(true)

    expect(hasWalletEvidence({ balance: null, journal: [], transactions: [] })).toBe(false)
    expect(hasWalletEvidence({ balance: {}, journal: [], transactions: [] })).toBe(true)
    expect(
      hasWalletEvidence({ balance: null, journal: [{ journalId: 1 }], transactions: [] }),
    ).toBe(true)

    expect(hasMailEvidence({ headers: [], contents: [] })).toBe(false)
    expect(hasMailEvidence({ headers: [], contents: [{ mailId: 1 }] })).toBe(true)
  })
})

function reviewerProps(
  access: Partial<PlatformReviewerPanelProps['queryAccess']> = {},
): PlatformReviewerPanelProps {
  return {
    moduleId: 'member-audit',
    contributionId: 'overview',
    routeId: 'member-summary',
    sectionId: 'overview',
    organizationVersion: 4,
    queryAccess: {
      authenticated: true,
      authorized: true,
      moduleEnabled: true,
      ...access,
    },
    target: {
      kind: 'managed-organization-account',
      managedMemberLifecycleId: 'lifecycle',
      sectionActivationVersion: 1,
      userId: 'user-id',
    },
  }
}
