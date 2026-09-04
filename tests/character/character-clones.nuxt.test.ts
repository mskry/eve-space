import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import CharacterClonesWorkspace from '../../app/components/character/clones/Workspace.vue'
import type { CharacterSkills } from '../../app/queries/characters'
import type { CharacterClones, CharacterImplants } from '../../app/queries/clones'
import type { CloneResourceState } from '../../app/types/clones'

const mountedWrappers: { unmount: () => void }[] = []
const ready: CloneResourceState = { status: 'ready', message: '', authorizeUrl: '' }
const freshness = {
  cachedUntil: '2026-09-03T11:02:00.000Z',
  validatedAt: '2026-09-03T11:00:00.000Z',
  stale: false,
}
const clones = {
  homeLocation: { locationId: 60_000_001, locationType: 'station', name: 'Jita IV - Moon 4' },
  jumpClones: [
    {
      jumpCloneId: 11,
      name: 'Industry clone',
      location: { locationId: 60_000_001, locationType: 'station', name: 'Jita IV - Moon 4' },
      implants: [{ typeId: 2, name: 'Memory Augmentation', slot: 2, bonuses: [] }],
    },
    {
      jumpCloneId: 12,
      name: null,
      location: { locationId: 1_035_466_617_946, locationType: 'structure', name: null },
      implants: [],
    },
  ],
  lastCloneJumpAt: '2026-09-02T12:00:00Z',
  lastStationChangeAt: '2026-08-30T12:00:00Z',
  ...freshness,
} satisfies CharacterClones
const implants = {
  implants: [
    { typeId: 3, name: 'Ocular Filter', slot: 1, bonuses: [{ attribute: 'perception', value: 4 }] },
    { typeId: 4, name: 'Neural Boost', slot: 3, bonuses: [{ attribute: 'willpower', value: 4 }] },
  ],
  ...freshness,
} satisfies CharacterImplants
const skills = {
  groups: [
    {
      skills: [
        { typeId: 24_242, trainedLevel: 5, activeLevel: 5 },
        { typeId: 33_407, trainedLevel: 3, activeLevel: 3 },
      ],
    },
  ],
} as unknown as CharacterSkills

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

describe('character Clones workspace', () => {
  it('presents the active clone, augmentations, and grouped jump clones', async () => {
    const wrapper = await mountWorkspace({ clones, implants, skills })

    const jumpClones = wrapper.get('[role="region"][aria-label="Jump clones"]')
    expect(jumpClones.classes()).toContain('character-summary-card')
    expect(jumpClones.get('.character-summary-icon img').attributes('src')).toContain(
      '/types/165/icon?size=64&tenant=tranquility',
    )
    expect(jumpClones.get('.ui-eyebrow').text()).toBe('JUMP CLONES')
    expect(jumpClones.get('h2').text()).toBe('2 OF 8 INSTALLED6 SLOTS AVAILABLE')
    expect(wrapper.get('section[aria-labelledby="character-clones-rack-title"] h2').text()).toBe(
      'Active clone implants',
    )
    expect(wrapper.get('.character-clones-rack .ui-eyebrow').text()).toBe('AUGMENTATIONS')
    expect(wrapper.get('section[aria-labelledby="character-clones-home-title"] h2').text()).toBe(
      'Home Station',
    )
    const homeLocation = wrapper.get('.character-clones-home')
    expect(homeLocation.get('.character-clones-home-location').text()).toBe('Jita IV - Moon 4')
    expect(homeLocation.findAll('dt').map((term) => term.text())).toEqual([
      'Home Station',
      'Last Home Station change',
    ])
    expect(homeLocation.get('dt').classes()).toContain('sr-only')
    expect(wrapper.get('section[aria-labelledby="character-clones-stored-title"] h2').text()).toBe(
      'Jump clones by location',
    )
    expect(wrapper.text()).toContain('Jita IV - Moon 4')
    expect(wrapper.text()).toContain('Industry clone')
    expect(wrapper.text()).toContain('Unnamed clone')
    expect(wrapper.text()).toContain('Unknown structure')
    expect(wrapper.text()).toContain('No implants installed')
  })

  it('racks active implants by slot and leaves unfilled slots addressable', async () => {
    const wrapper = await mountWorkspace({ clones, implants })

    const slots = wrapper.findAll('.character-clones-rack .character-clones-slot-list > li')
    expect(slots).toHaveLength(10)
    expect(slots[0]?.get('.character-clones-slot-index').text()).toBe('01')
    expect(slots[0]?.text()).toContain('Ocular Filter')
    expect(slots[0]?.text()).toContain('+4 PER')
    expect(slots[1]?.get('.character-clones-slot-empty').text()).toContain('Empty slot')
    expect(
      wrapper.get('.character-clones-rack .character-clones-section-heading span').text(),
    ).toBe('2 / 10 SLOTS FILLED')
    expect(slots[0]?.get('.character-clones-implant-bonus').text()).toBe('+4 PER')
    expect(slots[2]?.get('.character-clones-implant-bonus').text()).toBe('+4 WIL')
    expect(wrapper.find('.character-clones-attribute-totals').exists()).toBe(false)
  })

  it('groups jump clones by location and reports derived capacity', async () => {
    const wrapper = await mountWorkspace({ clones, implants, skills })

    const groups = wrapper.findAll('.character-clones-group')
    expect(groups).toHaveLength(2)
    expect(groups[0]?.get('h3').text()).toBe('Jita IV - Moon 4')
    expect(groups[0]?.get('.character-clones-group-heading span').text()).toContain('STATION')
    expect(groups[1]?.get('.character-clones-group-heading span').text()).toContain('STRUCTURE')
    expect(wrapper.get('.character-clones-stored-footer').text()).toBe(
      '2 OF 8 JUMP CLONES INSTALLED',
    )
  })

  it('previews stored implants and expands the existing item-information list', async () => {
    const wrapper = await mountWorkspace({ clones, implants })
    const card = wrapper.findAll('.character-clones-card')[0]!
    const disclosure = card.get('.character-clones-card-summary')
    const preview = card.get('.character-clones-card-preview-item')

    expect(preview.text()).toBe('')
    expect(preview.get('.ui-eve-image').attributes('width')).toBe('32')
    expect(card.getComponent({ name: 'UiTooltip' }).props('content')).toBe('Memory Augmentation')
    expect(disclosure.attributes('aria-expanded')).toBe('false')
    expect(disclosure.find('.character-clones-card-chevron').exists()).toBe(true)
    expect(card.find('.character-clones-card-implants').exists()).toBe(false)

    await disclosure.trigger('click')

    expect(disclosure.attributes('aria-expanded')).toBe('true')
    expect(disclosure.attributes('data-state')).toBe('open')
    expect(card.get('.character-clones-card-implants').text()).toContain('Memory Augmentation')
    const implantTrigger = card.get('.character-clones-implant-trigger')
    expect(implantTrigger.attributes('aria-label')).toBe(
      'View item information for Memory Augmentation',
    )
    const implantName = implantTrigger.get('.character-clones-implant-name')
    expect(implantName.text()).toContain('Memory Augmentation')
    expect(implantName.find('.app-information-icon').exists()).toBe(true)

    const emptyCard = wrapper.findAll('.character-clones-card')[1]!
    expect(emptyCard.find('button.character-clones-card-summary').exists()).toBe(false)
    expect(emptyCard.get('.character-clones-card-summary').classes()).toContain(
      'character-clones-card-summary--static',
    )
    expect(emptyCard.find('.character-clones-card-chevron').exists()).toBe(false)
    expect(emptyCard.text()).toContain('No implants installed')
    expect(emptyCard.text()).not.toContain('0 IMPLANTS')
  })

  it('withholds a bay maximum when the skills resource is unavailable', async () => {
    const wrapper = await mountWorkspace({ clones, implants })

    expect(wrapper.get('.character-clones-stored-footer').text()).toBe('2 JUMP CLONES INSTALLED')
    expect(wrapper.get('[aria-label="Jump clones"] h2').text()).toBe('2 INSTALLEDCAPACITY UNKNOWN')
    expect(wrapper.text()).toContain('Maximum needs the skills resource')
  })

  it('states a full clone bay through the value the summary card already renders', async () => {
    const fullBay = {
      groups: [{ skills: [{ typeId: 24_242, trainedLevel: 2, activeLevel: 2 }] }],
    } as unknown as CharacterSkills

    const wrapper = await mountWorkspace({ clones, implants, skills: fullBay })

    expect(wrapper.get('[aria-label="Jump clones"] h2').text()).toBe(
      '2 OF 2 INSTALLEDCAPACITY REACHED',
    )
    expect(wrapper.get('.character-clones-stored-footer').text()).toBe(
      '2 OF 2 JUMP CLONES INSTALLED',
    )
  })

  it('renders clone activity only as historical timestamps', async () => {
    const wrapper = await mountWorkspace({ clones, implants })
    const jumpClones = wrapper.get('[aria-label="Jump clones"]')
    const home = wrapper.get('[aria-labelledby="character-clones-home-title"]')

    expect(jumpClones.text()).toContain('LAST CLONE JUMP')
    expect(jumpClones.get('time').attributes('datetime')).toBe(clones.lastCloneJumpAt)
    expect(home.text()).toContain('Last Home Station change')
    expect(home.get('time').attributes('datetime')).toBe(clones.lastStationChangeAt)
    expect(wrapper.text()).not.toContain('Available')
    expect(wrapper.text()).not.toContain('Until the next jump is available')
  })

  it('omits absent clone jump and Home Station activity', async () => {
    const wrapper = await mountWorkspace({
      clones: { ...clones, lastCloneJumpAt: null, lastStationChangeAt: null },
      implants,
    })

    expect(wrapper.get('[aria-label="Jump clones"]').text()).not.toContain('LAST CLONE JUMP')
    expect(wrapper.get('[aria-label="Jump clones"]').text()).not.toContain('Unavailable')
    expect(wrapper.get('[aria-labelledby="character-clones-home-title"]').text()).not.toContain(
      'Last Home Station change',
    )
  })

  it('renders without throwing when the API predates the slot and bonus fields', async () => {
    const legacyImplants = {
      implants: [
        { typeId: 3, name: 'Ocular Filter' },
        { typeId: 4, name: 'Neural Boost' },
      ],
      ...freshness,
    } as unknown as CharacterImplants

    const wrapper = await mountWorkspace({ clones, implants: legacyImplants })

    expect(wrapper.find('.character-clones-rack').exists()).toBe(true)
    expect(wrapper.get('.character-clones-rack-unslotted').text()).toContain('Ocular Filter')
    expect(wrapper.find('.character-clones-attribute-totals').exists()).toBe(false)
    expect(wrapper.find('.character-clones-implant-bonus').exists()).toBe(false)

    expect(wrapper.find('.character-clones-rack-columns').exists()).toBe(true)
    expect(wrapper.findAll('.character-clones-slot-empty')).toHaveLength(10)
    expect(wrapper.get('.character-clones-rack-unslotted').text()).toContain('SLOT UNKNOWN')
    expect(
      wrapper.get('.character-clones-rack .character-clones-section-heading span').text(),
    ).toBe('0 / 10 SLOTS FILLED / 2 UNPLACED')
  })

  it('keeps the rack and lists the strays when only some implants carry a slot', async () => {
    const mixed = {
      implants: [
        { typeId: 3, name: 'Ocular Filter', slot: 1, bonuses: [] },
        { typeId: 9, name: 'Unknown implant 9', slot: null, bonuses: [] },
      ],
      ...freshness,
    } as unknown as CharacterImplants

    const wrapper = await mountWorkspace({ clones, implants: mixed })

    expect(wrapper.find('.character-clones-rack-columns').exists()).toBe(true)
    expect(wrapper.get('.character-clones-rack-unslotted').text()).toContain('SLOT UNKNOWN')
    expect(
      wrapper.get('.character-clones-rack .character-clones-section-heading span').text(),
    ).toBe('1 / 10 SLOTS FILLED / 1 UNPLACED')
  })

  it('still draws an empty rack when the character has no implants at all', async () => {
    const wrapper = await mountWorkspace({
      clones,
      implants: { implants: [], ...freshness } as unknown as CharacterImplants,
    })

    expect(wrapper.find('.character-clones-rack-columns').exists()).toBe(true)
    expect(wrapper.findAll('.character-clones-slot-empty')).toHaveLength(10)
    expect(
      wrapper.get('.character-clones-rack .character-clones-section-heading span').text(),
    ).toBe('0 / 10 SLOTS FILLED')
  })

  it('shows the Home Station in its own region when no jump clone shares it', async () => {
    const wrapper = await mountWorkspace({
      clones: {
        ...clones,
        homeLocation: { locationId: 60_000_009, locationType: 'station', name: 'Amarr VIII' },
      },
      implants,
    })

    const home = wrapper.get('[aria-labelledby="character-clones-home-title"]')
    expect(home.text()).toContain('Amarr VIII')
    expect(wrapper.findAll('.character-clones-group-list')).toHaveLength(2)
  })

  it('keeps successful clone state usable when active implants require authorization', async () => {
    const authorizeUrl =
      'http://localhost/auth/eve/reauthorize/7?returnTo=%2Fcharacters%2F7%2Fclones'
    const wrapper = await mountWorkspace({
      clones,
      implantState: {
        status: 'authorization',
        message: 'Authorize implant access.',
        authorizeUrl,
      },
    })

    expect(wrapper.text()).toContain('Active implant authorization required')
    expect(wrapper.get('.character-authorization-state a').attributes('href')).toBe(authorizeUrl)
    expect(wrapper.text()).toContain('Industry clone')
    expect(wrapper.find('.character-clones-card').exists()).toBe(true)
  })

  it('keeps active implants usable when clone state fails and emits only its retry', async () => {
    const wrapper = await mountWorkspace({
      implants,
      cloneState: { status: 'error', message: 'Clone state failed.', authorizeUrl: '' },
    })

    expect(wrapper.text()).toContain('Ocular Filter')
    expect(wrapper.text()).toContain('Clone state unavailable')
    expect(wrapper.find('.character-clones-stored').exists()).toBe(false)
    await wrapper.get('.character-clones-active .ui-action-secondary').trigger('click')
    expect(wrapper.emitted('retryClones')).toHaveLength(1)
    expect(wrapper.emitted('retryImplants')).toBeUndefined()
  })

  it('communicates independent loading and implant failure states', async () => {
    const wrapper = await mountWorkspace({
      cloneState: { status: 'loading', message: '', authorizeUrl: '' },
      implantState: { status: 'error', message: 'Implants failed.', authorizeUrl: '' },
    })

    expect(wrapper.get('.character-clones-active [role="status"]').text()).toContain(
      'Resolving Home Station and jump clone records',
    )
    expect(wrapper.get('.character-clones-rack [role="alert"]').text()).toContain(
      'Active implants unavailable',
    )
    await wrapper.get('.character-clones-rack .ui-action-secondary').trigger('click')
    expect(wrapper.emitted('retryImplants')).toHaveLength(1)
  })

  it('retains stale, empty, incomplete, and unknown-slot data', async () => {
    const staleClones = {
      ...clones,
      homeLocation: { locationId: null, locationType: 'station', name: null },
      jumpClones: [],
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    } satisfies CharacterClones
    const staleImplants = {
      ...implants,
      implants: [{ typeId: 999, name: 'Unknown implant 999', slot: null, bonuses: [] }],
      stale: true,
      refreshFailureClass: 'esi-cooldown',
    } satisfies CharacterImplants
    const wrapper = await mountWorkspace({ clones: staleClones, implants: staleImplants })

    expect(wrapper.get('.character-clones-home').text()).toContain('Home Station unavailable')
    expect(wrapper.text()).toContain('No jump clones installed')
    expect(wrapper.text()).toContain('Unknown implant 999')
    expect(wrapper.get('.character-clones-rack-unslotted').text()).toContain('SLOT UNKNOWN')
    expect(wrapper.findAll('.character-clones-stale')).toHaveLength(2)
    expect(wrapper.text()).not.toMatch(/jump-drive fatigue/i)
  })

  it('contains long clone, location, and implant names in identity-safe cards', async () => {
    const longValue = 'VERY-LONG-UNBROKEN-VALUE-'.repeat(12)
    const wrapper = await mountWorkspace({
      clones: {
        ...clones,
        jumpClones: [
          {
            jumpCloneId: 101,
            name: longValue,
            location: { locationId: 60_000_002, locationType: 'station', name: longValue },
            implants: [{ typeId: 202, name: longValue, slot: 6, bonuses: [] }],
          },
          {
            jumpCloneId: 102,
            name: longValue,
            location: { locationId: 60_000_002, locationType: 'station', name: longValue },
            implants: [{ typeId: 203, name: `${longValue}B`, slot: 7, bonuses: [] }],
          },
        ],
      },
      implants,
    })

    expect(wrapper.findAll('.character-clones-group-list')).toHaveLength(1)
    expect(wrapper.findAll('.character-clones-card')).toHaveLength(2)
    expect(wrapper.findAll('.character-clones-card-name').map((entry) => entry.text())).toEqual([
      longValue,
      longValue,
    ])
    for (const disclosure of wrapper.findAll('.character-clones-card-summary')) {
      await disclosure.trigger('click')
    }
    expect(
      wrapper.findAll('.character-clones-card .character-clones-implant-trigger'),
    ).toHaveLength(2)
  })
})

interface WorkspaceOverrides {
  clones?: CharacterClones
  cloneState?: CloneResourceState
  implants?: CharacterImplants
  implantState?: CloneResourceState
  skills?: CharacterSkills
}

async function mountWorkspace(overrides: WorkspaceOverrides) {
  const wrapper = await mountSuspended(CharacterClonesWorkspace, {
    global: {
      stubs: {
        UiTooltip: {
          name: 'UiTooltip',
          props: ['arrow', 'content'],
          template: '<span><slot /></span>',
        },
      },
    },
    props: {
      clones: overrides.clones,
      cloneState: overrides.cloneState ?? ready,
      implants: overrides.implants,
      implantState: overrides.implantState ?? ready,
      skills: overrides.skills,
    },
    route: false,
  })
  mountedWrappers.push(wrapper)
  return wrapper
}
