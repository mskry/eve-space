import { mountSuspended } from '@nuxt/test-utils/runtime'
import { TooltipProvider } from 'reka-ui'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import CharacterRosterCard from '../../app/components/CharacterRosterCard.vue'
import type { CharacterRosterEntry } from '../../app/queries/characters'

const character = {
  characterId: 7,
  name: 'Roster Pilot',
  corporationId: 98_000_001,
  allianceId: null,
  isMain: true,
  birthday: '2020-01-01T00:00:00.000Z',
  securityStatus: 1.2,
  raceFactionId: 500_001,
  location: {
    solarSystemId: 30_000_142,
    solarSystemName: 'Jita',
    solarSystemSecurityStatus: 0.945,
    locationType: 'station',
    stationId: 60_003_768,
    stationName: 'Jita IV - Moon 4',
  },
  ship: { typeId: 670, typeName: 'Capsule', groupId: 29, name: 'Roster One' },
  walletBalance: 9_876_543.21,
  totalSp: 5_000_000,
  corporation: { id: 98_000_001, name: 'Roster Corporation' },
  alliance: null,
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
      src: '/images/eve-brackets/station.png',
      width: '16',
      height: '16',
      alt: '',
      'aria-hidden': 'true',
    })
    expect(wrapper.get('.roster-ship-icon').attributes()).toMatchObject({
      src: '/images/eve-brackets/capsule_16.png',
      width: '16',
      height: '16',
      alt: '',
      'aria-hidden': 'true',
    })

    await wrapper.get('.roster-card-link').trigger('pointerenter')
    expect(prefetch).toHaveBeenCalledWith(7)
  })
})
