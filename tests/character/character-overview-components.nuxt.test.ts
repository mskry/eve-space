import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import CharacterOverviewDetails from '../../app/components/character/CharacterOverviewDetails.vue'

const profile = {
  achievementScore: 12,
  birthday: '2020-01-01T00:00:00.000Z',
  bloodline: 'Deteis',
  corporationTitle: 'Scout',
  factionId: null,
  gender: 'male',
  race: 'Caldari',
  securityStatus: 1.2,
}

describe('CharacterOverviewDetails', () => {
  it('renders public identity and progression without private skill points', async () => {
    const wrapper = await mountSuspended(CharacterOverviewDetails, { props: { profile } })

    expect(
      wrapper.findAll('.character-overview-detail-section--identity dt').map((term) => term.text()),
    ).toEqual([
      'SECURITY STATUS',
      'RACE',
      'BLOODLINE',
      'DATE OF BIRTH',
      'GENDER',
      'CORPORATION TITLE',
    ])
    expect(wrapper.get('.character-overview-detail-section--progression').text()).toContain(
      'ACHIEVEMENT SCORE',
    )
    expect(wrapper.text()).not.toContain('TOTAL SKILL POINTS')
  })

  it('adds skill points when the owned-character route supplies them', async () => {
    const wrapper = await mountSuspended(CharacterOverviewDetails, {
      props: { profile, skillPointsLabel: '5,000,000' },
    })

    expect(wrapper.get('.character-detail-primary').text()).toContain('TOTAL SKILL POINTS')
    expect(wrapper.get('.character-detail-primary').text()).toContain('5,000,000')
  })
})
