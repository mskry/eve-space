import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
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
  groups: [
    {
      groupId: 1,
      name: 'Gunnery',
      trainedSp: 900_000,
      skills: [
        {
          typeId: 100,
          name: 'Motion Prediction',
          activeLevel: 4,
          trainedLevel: 5,
          skillpoints: 500_000,
        },
        {
          typeId: 101,
          name: 'Sharpshooter',
          activeLevel: 5,
          trainedLevel: 5,
          skillpoints: 400_000,
        },
      ],
    },
    {
      groupId: 2,
      name: 'Spaceship Command',
      trainedSp: 600_000,
      skills: [
        {
          typeId: 200,
          name: 'Evasive Maneuvering',
          activeLevel: 4,
          trainedLevel: 4,
          skillpoints: 600_000,
        },
      ],
    },
  ],
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
        groupId: 1,
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
        groupId: 2,
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
    ],
  }
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

describe('character Skills components', () => {
  it('filters the catalogue through native labelled groups', async () => {
    const wrapper = await mountSuspended(CharacterSkillsCatalogue, {
      props: { skillQueue: trainingQueue(), skills },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('.skills-level-filter').element.tagName).toBe('FIELDSET')
    expect(wrapper.get('.skills-level-filter legend').text()).toBe('Filter skills by trained level')
    expect(wrapper.get('.skill-group-chips').element.tagName).toBe('FIELDSET')
    expect(wrapper.findAll('.skill-row')).toHaveLength(2)

    await wrapper.get('input[type="search"]').setValue('evasive')
    expect(wrapper.get('.skill-list-header h2').text()).toContain('Results for')
    expect(wrapper.findAll('.skill-row')).toHaveLength(1)
    expect(wrapper.get('.skill-row-name').text()).toBe('Evasive Maneuvering')

    await wrapper.findAll('.skills-level-filter button')[2]?.trigger('click')
    expect(wrapper.find('.skill-row').exists()).toBe(false)
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
    expect(wrapper.text()).toContain('2/50')

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
