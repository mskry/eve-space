import { mountSuspended } from '@nuxt/test-utils/runtime'
import { TooltipProvider } from 'reka-ui'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import CharacterRosterCard from '../../app/components/CharacterRosterCard.vue'
import type { CharacterRosterEntry } from '../../app/queries/characters'

const character = {
  alliance: null,
  allianceId: null,
  birthday: '2020-01-01T00:00:00.000Z',
  characterId: 7,
  corporation: { id: 98_000_001, name: 'Roster Corporation' },
  corporationId: 98_000_001,
  isMain: true,
  location: {
    locationType: 'station',
    solarSystemId: 30_000_142,
    solarSystemName: 'Jita',
    solarSystemSecurityStatus: 0.945,
    stationId: 60_003_768,
    stationName: 'Jita IV - Moon 4',
  },
  name: 'Roster Pilot',
  raceFactionId: 500_001,
  securityStatus: 1.2,
  ship: { groupId: 29, name: 'Roster One', typeId: 670, typeName: 'Capsule' },
  totalSp: 5_000_000,
  walletBalance: 9_876_543.21,
} satisfies CharacterRosterEntry

describe('CharacterRosterCard', () => {
  it('renders the character destination and emits navigation intent', async () => {
    const prefetch = vi.fn()
    const Host = defineComponent({
      setup: () => () =>
        h(TooltipProvider, null, {
          default: () => h(CharacterRosterCard, { character, onPrefetch: prefetch }),
        }),
    })
    const wrapper = await mountSuspended(Host, { route: false })

    expect(wrapper.get('.roster-card-link').attributes('href')).toBe('/characters/7')
    expect(wrapper.get('.roster-portrait img').attributes('alt')).toBe(
      'Roster Pilot character portrait',
    )
    expect(wrapper.get('.system-security-status').text()).toBe('System security: 0.9')
    expect(wrapper.get('.system-security-status').classes()).toContain('system-security-status--9')
    expect(wrapper.find('.security-status').exists()).toBe(false)
    expect(wrapper.get('.roster-location-icon').attributes()).toMatchObject({
      alt: '',
      'aria-hidden': 'true',
      height: '16',
      src: '/images/eve-brackets/station.png',
      width: '16',
    })
    expect(wrapper.get('.roster-ship-icon').attributes()).toMatchObject({
      alt: '',
      'aria-hidden': 'true',
      height: '16',
      src: '/images/eve-brackets/capsule_16.png',
      width: '16',
    })

    await wrapper.get('.roster-card-link').trigger('pointerenter')
    expect(prefetch).toHaveBeenCalledWith(7)
  })
})
