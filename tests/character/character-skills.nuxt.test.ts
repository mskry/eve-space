import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CharacterSkillsCatalogue from '../../app/components/character/skills/Catalogue.vue'
import CharacterSkillsQueue from '../../app/components/character/skills/Queue.vue'
import CharacterSkillsSummaryCard from '../../app/components/character/skills/SummaryCard.vue'
import type {
  CharacterAttributes,
  CharacterSkillQueue,
  CharacterSkills,
} from '../../app/queries/characters'

const mountedWrappers: { unmount: () => void }[] = []
const skills = {
  totalSp: 1_500_000,
  unallocatedSp: 12_000,
  injectedSkillCount: 3,
  groups: [
    {
      groupId: 1,
      name: 'Armor',
      trainedSp: 0,
      skills: [
        {
          typeId: 50,
          name: 'Repair Systems',
          injected: false,
          activeLevel: 0,
          trainedLevel: 0,
          skillpoints: 0,
        },
      ],
    },
    {
      groupId: 2,
      name: 'Gunnery',
      trainedSp: 900_000,
      skills: [
        {
          typeId: 100,
          name: 'Motion Prediction',
          injected: true,
          activeLevel: 4,
          trainedLevel: 5,
          skillpoints: 500_000,
        },
        {
          typeId: 101,
          name: 'Sharpshooter',
          injected: true,
          activeLevel: 5,
          trainedLevel: 5,
          skillpoints: 400_000,
        },
        {
          typeId: 102,
          name: 'Weapon Upgrades',
          injected: false,
          activeLevel: 0,
          trainedLevel: 0,
          skillpoints: 0,
        },
      ],
    },
    {
      groupId: 3,
      name: 'Sequencing',
      trainedSp: 0,
      skills: [
        {
          typeId: 150,
          name: 'Genetic Engineering',
          injected: false,
          activeLevel: 0,
          trainedLevel: 0,
          skillpoints: 0,
        },
      ],
    },
    {
      groupId: 4,
      name: 'Spaceship Command',
      trainedSp: 600_000,
      skills: [
        {
          typeId: 200,
          name: 'Evasive Maneuvering',
          injected: true,
          activeLevel: 4,
          trainedLevel: 4,
          skillpoints: 600_000,
        },
      ],
    },
  ],
} satisfies CharacterSkills
const uninjectedSkills = {
  ...skills,
  totalSp: 0,
  unallocatedSp: 0,
  injectedSkillCount: 0,
  groups: skills.groups.map((group) => ({
    ...group,
    trainedSp: 0,
    skills: group.skills.map((skill) => ({
      ...skill,
      injected: false,
      activeLevel: 0,
      trainedLevel: 0,
      skillpoints: 0,
    })),
  })),
} satisfies CharacterSkills
const attributes = {
  charisma: 19,
  intelligence: 24,
  memory: 21,
  perception: 27,
  willpower: 22,
  bonusRemaps: 1,
  accruedRemapCooldownDate: null,
  lastRemapDate: null,
} satisfies CharacterAttributes

function trainingQueue(): CharacterSkillQueue {
  const now = Date.now()
  return {
    state: 'training',
    activeQueuePosition: 0,
    entries: [
      {
        queuePosition: 0,
        typeId: 100,
        name: 'Motion Prediction',
        groupId: 2,
        groupName: 'Gunnery',
        finishedLevel: 5,
        levelStartSp: 256_000,
        levelEndSp: 512_000,
        trainingStartSp: 256_000,
        startDate: new Date(now - 3_600_000).toISOString(),
        finishDate: new Date(now + 3_600_000).toISOString(),
        primaryAttribute: 'perception',
        secondaryAttribute: 'willpower',
      },
      {
        queuePosition: 1,
        typeId: 200,
        name: 'Evasive Maneuvering',
        groupId: 4,
        groupName: 'Spaceship Command',
        finishedLevel: 5,
        levelStartSp: 512_000,
        levelEndSp: 1_024_000,
        trainingStartSp: null,
        startDate: new Date(now + 3_600_000).toISOString(),
        finishDate: new Date(now + 86_400_000).toISOString(),
        primaryAttribute: 'perception',
        secondaryAttribute: 'intelligence',
      },
      {
        queuePosition: 2,
        typeId: 102,
        name: 'Weapon Upgrades',
        groupId: 2,
        groupName: 'Gunnery',
        finishedLevel: 3,
        levelStartSp: 8_000,
        levelEndSp: 45_255,
        trainingStartSp: null,
        startDate: new Date(now + 86_400_000).toISOString(),
        finishDate: new Date(now + 172_800_000).toISOString(),
        primaryAttribute: 'perception',
        secondaryAttribute: 'willpower',
      },
    ],
  }
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

describe('character Skills components', () => {
  it('filters the catalogue through native labelled groups', async () => {
    const wrapper = await mountSuspended(CharacterSkillsCatalogue, {
      props: { skillQueue: undefined, skillQueueStatus: 'idle', skills },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('.skills-level-filter').element.tagName).toBe('FIELDSET')
    expect(wrapper.get('.skills-level-filter legend').text()).toBe('Filter skills by trained level')
    expect(wrapper.get('.skill-group-chips').element.tagName).toBe('FIELDSET')
    expect(wrapper.findAll('.skill-row')).toHaveLength(3)
    expect(wrapper.get('.skill-group-chip.is-selected').text()).toContain('Gunnery')
    expect(wrapper.findAll('.skill-group-chip')).toHaveLength(4)
    expect(wrapper.findAll('.skill-group-chip')[1]?.attributes('aria-label')).toBe(
      'Gunnery, 3 catalogue skills, 67% of skill levels trained',
    )
    expect(wrapper.findAll('.skill-group-chip')[1]?.attributes('style')).toContain(
      '--skill-group-progress: 67%',
    )

    await wrapper.setProps({ skillQueue: trainingQueue() })
    expect(wrapper.get('.skill-group-chip.is-selected').text()).toContain('Gunnery')

    await wrapper.get('input[type="search"]').setValue('evasive')
    expect(wrapper.get('.skill-list-header h2').text()).toContain('Results for')
    expect(wrapper.findAll('.skill-row')).toHaveLength(1)
    expect(wrapper.get('.skill-row-name').text()).toBe('Evasive Maneuvering')

    await wrapper.findAll('.skills-level-filter button')[3]?.trigger('click')
    expect(wrapper.find('.skill-row').exists()).toBe(false)
  })

  it('reveals only truncated skill names without changing row layout', async () => {
    const wrapper = await mountSuspended(CharacterSkillsCatalogue, {
      props: { skillQueue: undefined, skillQueueStatus: 'idle', skills },
      route: false,
    })
    mountedWrappers.push(wrapper)
    const [truncated, fitting] = wrapper.findAll('.skill-row-name')

    Object.defineProperties(truncated!.element, {
      clientWidth: { configurable: true, value: 80 },
      scrollWidth: { configurable: true, value: 160 },
    })
    Object.defineProperties(fitting!.element, {
      clientWidth: { configurable: true, value: 160 },
      scrollWidth: { configurable: true, value: 80 },
    })

    await truncated!.trigger('mouseenter')
    expect(truncated!.classes()).toContain('is-revealed')

    await truncated!.trigger('mouseleave')
    await fitting!.trigger('mouseenter')
    expect(truncated!.classes()).not.toContain('is-revealed')
    expect(fitting!.classes()).not.toContain('is-revealed')
  })

  it('keeps a zero-injected character catalogue and controls available', async () => {
    const wrapper = await mountSuspended(CharacterSkillsCatalogue, {
      props: { skillQueue: undefined, skillQueueStatus: 'idle', skills: uninjectedSkills },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('.skill-catalogue-notice').element.tagName).toBe('OUTPUT')
    expect(wrapper.get('.skill-catalogue-notice').text()).toContain('no injected skills')
    expect(wrapper.findAll('.skill-group-chip')).toHaveLength(4)
    expect(wrapper.get('.skill-group-chip.is-selected').text()).toContain('Armor')
    expect(wrapper.findAll('.skill-row')).toHaveLength(1)
    expect(wrapper.get('.skill-row-level').text()).toBe('0')
    expect(wrapper.get('.skill-level-track').attributes('aria-label')).toBe(
      'Active level 0; trained level 0 of 5; not injected',
    )
  })

  it('separates an injected untrained skill from an uninjected catalogue entry', async () => {
    const wrapper = await mountSuspended(CharacterSkillsCatalogue, {
      props: {
        skillQueue: undefined,
        skillQueueStatus: 'idle',
        skills: {
          ...skills,
          groups: [
            {
              groupId: 1,
              name: 'Armor',
              trainedSp: 0,
              skills: [
                {
                  typeId: 50,
                  name: 'Hull Upgrades',
                  injected: true,
                  activeLevel: 0,
                  trainedLevel: 0,
                  skillpoints: 0,
                },
                {
                  typeId: 51,
                  name: 'Repair Systems',
                  injected: false,
                  activeLevel: 0,
                  trainedLevel: 0,
                  skillpoints: 0,
                },
              ],
            },
          ],
        },
      },
      route: false,
    })
    mountedWrappers.push(wrapper)

    const rows = wrapper.findAll('.skill-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.classes()).toContain('is-injected')
    expect(rows[0]?.get('.skill-level-track').attributes('aria-label')).toBe(
      'Active level 0; trained level 0 of 5; injected, not trained',
    )
    expect(rows[1]?.classes()).not.toContain('is-injected')
    expect(rows[1]?.get('.skill-level-track').attributes('aria-label')).toBe(
      'Active level 0; trained level 0 of 5; not injected',
    )
    expect(wrapper.get('.skill-level-legend').text()).toContain('INJECTED')
  })

  it('shows catalogue unavailability without a misleading no-injected notice', async () => {
    const wrapper = await mountSuspended(CharacterSkillsCatalogue, {
      props: {
        skillQueue: undefined,
        skillQueueStatus: 'idle',
        skills: { ...uninjectedSkills, groups: [] },
      },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.find('.skill-catalogue-notice').exists()).toBe(false)
    expect(wrapper.text()).toContain('Skill catalogue unavailable')
    expect(wrapper.text()).toContain('static data ingestion completes')
  })

  it('labels an unavailable queue without claiming it is empty', async () => {
    const wrapper = await mountSuspended(CharacterSkillsCatalogue, {
      props: { skillQueue: undefined, skillQueueStatus: 'loading', skills },
      route: false,
    })
    mountedWrappers.push(wrapper)
    const queuedOnly = wrapper.get('.skills-queued-filter')

    expect(queuedOnly.attributes('aria-label')).toBe('Skill queue is loading')
    expect(queuedOnly.attributes()).toHaveProperty('disabled')

    await wrapper.setProps({ skillQueueStatus: 'scope-required' })
    expect(queuedOnly.attributes('aria-label')).toBe('Skill queue authorization required')

    await wrapper.setProps({ skillQueueStatus: 'error' })
    expect(queuedOnly.attributes('aria-label')).toBe('Skill queue unavailable')

    await wrapper.setProps({ skillQueueStatus: 'idle' })
    expect(queuedOnly.attributes('aria-label')).toBe('No queued skills available')
  })

  it('composes catalogue search and level filters with polite result counts', async () => {
    const wrapper = await mountSuspended(CharacterSkillsCatalogue, {
      props: { skillQueue: trainingQueue(), skillQueueStatus: 'idle', skills },
      route: false,
    })
    mountedWrappers.push(wrapper)

    const status = wrapper.get('.skills-match-status')
    const announcement = wrapper.get('.skills-result-announcement')
    expect(status.classes()).not.toContain('is-visible')
    expect(announcement.attributes('aria-live')).toBe('polite')
    expect(announcement.text()).toBe('6 CATALOGUE SKILLS ACROSS 4 GROUPS')
    expect(wrapper.findAll('.skill-group-chip-count').map((chip) => chip.text())).toEqual([
      '1',
      '3',
      '1',
      '1',
    ])

    await wrapper.findAll('.skills-level-filter button')[1]?.trigger('click')
    expect(status.classes()).toContain('is-visible')
    expect(status.text()).toBe('3 SKILLS / 3 GROUPS')
    expect(announcement.text()).toBe('3 CATALOGUE SKILLS ACROSS 3 GROUPS')
    expect(wrapper.findAll('.skill-group-chip-count').map((chip) => chip.text())).toEqual([
      '1',
      '1',
      '1',
      '0',
    ])

    const search = wrapper.get('input[type="search"]')
    await search.setValue('g')
    await search.setValue('gun')
    await search.setValue('gunnery')
    expect(status.text()).toBe('1 MATCH / 1 GROUP')
    expect(announcement.text()).toBe('3 CATALOGUE SKILLS ACROSS 3 GROUPS')
    await vi.waitFor(() =>
      expect(announcement.text()).toBe('1 CATALOGUE SKILL MATCHED ACROSS 1 GROUP'),
    )
    expect(wrapper.get('.skill-row-name').text()).toBe('Weapon Upgrades')

    await wrapper.findAll('.skills-level-filter button')[3]?.trigger('click')
    expect(status.text()).toBe('2 MATCHES / 1 GROUP')
    await vi.waitFor(() =>
      expect(announcement.text()).toBe('2 CATALOGUE SKILLS MATCHED ACROSS 1 GROUP'),
    )
    expect(wrapper.findAll('.skill-group-chip-count').map((chip) => chip.text())).toEqual([
      '0',
      '2',
      '0',
      '0',
    ])
  })

  it('composes the queued-only toggle with trained-level filters', async () => {
    const wrapper = await mountSuspended(CharacterSkillsCatalogue, {
      props: { skillQueue: trainingQueue(), skillQueueStatus: 'idle', skills },
      route: false,
    })
    mountedWrappers.push(wrapper)

    const status = wrapper.get('.skills-match-status')
    const announcement = wrapper.get('.skills-result-announcement')
    const queuedOnly = wrapper.get('.skills-queued-filter')
    expect(queuedOnly.attributes('aria-pressed')).toBe('false')

    await queuedOnly.trigger('click')
    expect(queuedOnly.attributes('aria-pressed')).toBe('true')
    expect(status.text()).toBe('3 SKILLS / 2 GROUPS')
    expect(announcement.text()).toBe('3 CATALOGUE SKILLS ACROSS 2 GROUPS')
    expect(wrapper.findAll('.skill-group-chip-count').map((chip) => chip.text())).toEqual([
      '0',
      '2',
      '0',
      '1',
    ])

    await wrapper.findAll('.skills-level-filter button')[1]?.trigger('click')
    expect(status.text()).toBe('1 SKILL / 1 GROUP')
    expect(announcement.text()).toBe('1 CATALOGUE SKILL ACROSS 1 GROUP')
    expect(wrapper.get('.skill-row-name').text()).toBe('Weapon Upgrades')
  })

  it('shows a queued uninjected skill in both catalogue and queue panel', async () => {
    const skillQueue = trainingQueue()
    const catalogue = await mountSuspended(CharacterSkillsCatalogue, {
      props: { skillQueue, skillQueueStatus: 'idle', skills },
      route: false,
    })
    mountedWrappers.push(catalogue)

    const weaponUpgrades = catalogue
      .findAll('.skill-row')
      .find((row) => row.get('.skill-row-name').text() === 'Weapon Upgrades')
    expect(weaponUpgrades).toBeDefined()
    expect(weaponUpgrades!.get('.skill-row-level').text()).toBe('0')
    expect(weaponUpgrades!.findAll('.skill-level-track .is-queued')).toHaveLength(3)
    expect(weaponUpgrades!.get('.skill-level-track').attributes('aria-label')).toContain(
      'queued to level 3',
    )

    const queue = await mountSuspended(CharacterSkillsQueue, {
      props: {
        authorizeUrl: '',
        message: '',
        skillQueue,
        status: 'idle',
      },
      route: false,
    })
    mountedWrappers.push(queue)
    expect(queue.text()).toContain('Weapon Upgrades')
  })

  it('renders native progress and a compact queue authorization state', async () => {
    const wrapper = await mountSuspended(CharacterSkillsQueue, {
      props: {
        authorizeUrl: '',
        message: '',
        skillQueue: trainingQueue(),
        status: 'idle',
      },
      route: false,
    })
    mountedWrappers.push(wrapper)

    const progress = wrapper.get('progress')
    expect(progress.attributes('max')).toBe('100')
    expect(Number(progress.attributes('value'))).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('SP/MIN')
    expect(wrapper.text()).not.toContain('OMEGA SP/MIN')
    expect(wrapper.text()).toContain('3/50')

    await wrapper.setProps({
      authorizeUrl: '/reauthorize',
      message: 'Authorize skill queue access for this character.',
      skillQueue: undefined,
      status: 'scope-required',
    })
    expect(wrapper.get('.character-authorization-state').classes()).toContain(
      'character-authorization-state--compact',
    )
    expect(wrapper.get('.character-authorization-state a').attributes('href')).toBe('/reauthorize')
  })

  it('shows summary attributes and retains independent retry behavior', async () => {
    const wrapper = await mountSuspended(CharacterSkillsSummaryCard, {
      props: {
        attributes,
        attributesAuthorizeUrl: '',
        attributesMessage: '',
        attributesStatus: 'idle',
        skills,
      },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.text()).toContain('1,500,000 SP')
    expect(wrapper.text()).toContain('REMAPS AVAILABLE: 1')
    expect(wrapper.findAll('.skills-hero-stats dd')[1]?.text()).toBe('2')
    expect(wrapper.findAll('.skill-attribute-cells > div')).toHaveLength(5)

    await wrapper.setProps({
      attributes: undefined,
      attributesMessage: 'Attributes unavailable.',
      attributesStatus: 'error',
    })
    await wrapper.get('.skill-attribute-notice button').trigger('click')
    expect(wrapper.emitted('retryAttributes')).toHaveLength(1)
  })
})
