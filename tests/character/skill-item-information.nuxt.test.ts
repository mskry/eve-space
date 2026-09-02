import { mountSuspended } from '@nuxt/test-utils/runtime'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import CharacterSkillsCatalogue from '../../app/components/character/skills/Catalogue.vue'
import type { CharacterSkillQueue, CharacterSkills } from '../../app/queries/characters'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []
const requestedPaths: string[] = []
const skills = {
  totalSp: 900_000,
  unallocatedSp: 0,
  injectedSkillCount: 2,
  groups: [
    {
      groupId: 255,
      name: 'Gunnery',
      trainedSp: 900_000,
      skills: [
        {
          typeId: 100,
          name: 'Motion Prediction',
          injected: true,
          activeLevel: 4,
          trainedLevel: 4,
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
      ],
    },
  ],
} satisfies CharacterSkills

const skillQueue = {
  state: 'paused',
  activeQueuePosition: null,
  entries: [
    {
      queuePosition: 0,
      typeId: 100,
      name: 'Motion Prediction',
      groupId: 255,
      groupName: 'Gunnery',
      finishedLevel: 5,
      levelStartSp: 256_000,
      levelEndSp: 512_000,
      trainingStartSp: null,
      startDate: null,
      finishDate: null,
      primaryAttribute: 'perception',
      secondaryAttribute: 'willpower',
    },
  ],
} satisfies CharacterSkillQueue

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function triggerButton(name: string) {
  const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
  expect(trigger, `trigger ${name} was not rendered`).not.toBeNull()
  return trigger!
}

function closeButton() {
  const close = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Close item information"]',
  )
  expect(close).not.toBeNull()
  return close!
}

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  requestedPaths.length = 0
  queryServer.resetHandlers()
  await settle()
  document.body.replaceChildren()
})

describe('Skills item-information integration', () => {
  it('loads only activated skills and preserves row semantics through dismissal', async () => {
    queryServer.use(
      http.get('*/api/universe/types/:typeId', ({ params, request }) => {
        requestedPaths.push(new URL(request.url).pathname)
        const typeId = Number(params.typeId)
        return HttpResponse.json({
          typeId,
          name: typeId === 100 ? 'Motion Prediction' : 'Sharpshooter',
          description: typeId === 100 ? 'Improves turret tracking.' : null,
          group: { id: 255, name: 'Gunnery' },
          category: { id: 16, name: 'Skill' },
          detail: {
            kind: 'skill',
            rank: typeId === 100 ? 3 : null,
            primaryAttribute: typeId === 100 ? 'perception' : null,
            secondaryAttribute: typeId === 100 ? 'willpower' : null,
          },
        })
      }),
    )
    const wrapper = await mountSuspended(CharacterSkillsCatalogue, {
      attachTo: document.body,
      props: { skillQueue, skillQueueStatus: 'idle', skills },
      route: false,
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.findAll('.skill-list > li')).toHaveLength(2)
    expect(wrapper.findAll('.skill-row-trigger')).toHaveLength(2)
    expect(wrapper.get('.skill-level-track').attributes('aria-label')).toContain('Active level 4')
    expect(wrapper.get('.skill-row-sp').attributes('aria-label')).toContain('trained skill points')

    const motionTrigger = triggerButton('View item information for Motion Prediction')
    const statusDescriptionId = motionTrigger.getAttribute('aria-describedby')
    expect(statusDescriptionId).toBeTruthy()
    expect(document.getElementById(statusDescriptionId!)?.textContent).toContain(
      'Active level 4; trained level 4 of 5; queued to level 5',
    )
    expect(document.getElementById(statusDescriptionId!)?.textContent).toContain(
      '500,000 trained skill points',
    )
    expect(document.getElementById(statusDescriptionId!)?.textContent).toContain('trained level IV')
    motionTrigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    await settle()
    expect(requestedPaths).toEqual([])

    motionTrigger.focus()
    motionTrigger.click()
    await vi.waitFor(() => expect(requestedPaths).toEqual(['/api/universe/types/100']))
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Motion Prediction'),
    )
    const header = document.querySelector('.eve-item-information-header')
    expect(header?.querySelector('h2')?.textContent).toBe('Motion Prediction')
    expect(header?.querySelector('.ui-eyebrow')?.textContent).toBe('Gunnery')
    expect(header?.textContent).not.toContain('Skill')

    const descriptionTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (tab) => tab.textContent?.trim() === 'Description',
    )
    const attributesTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (tab) => tab.textContent?.trim() === 'Attributes',
    )
    expect(descriptionTab?.getAttribute('aria-selected')).toBe('true')
    expect(attributesTab?.getAttribute('aria-selected')).toBe('false')
    expect(
      document.querySelector('.skill-item-information-details')?.closest('[role="tabpanel"]'),
    ).toHaveProperty('hidden', true)

    attributesTab!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await settle()
    expect(attributesTab?.getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('.skill-item-information-details')?.textContent).toContain(
      'Training multiplier3x',
    )
    expect(document.querySelector('.skill-item-information-details')?.textContent).toContain(
      'Primary attributePerception',
    )
    expect(document.querySelector('.skill-item-information-details')?.textContent).toContain(
      'Secondary attributeWillpower',
    )
    expect(
      document.querySelector(
        'img[data-skill-detail-icon="training-multiplier"][src="/images/22_32_16.png"]',
      ),
    ).not.toBeNull()
    expect(
      document.querySelector('img[src="/images/eve-attributes/perception.png"]'),
    ).not.toBeNull()
    expect(document.querySelector('img[src="/images/eve-attributes/willpower.png"]')).not.toBeNull()
    expect(requestedPaths.some((path) => path.includes('/skills'))).toBe(false)

    closeButton().click()
    await settle()
    expect(document.activeElement).toBe(motionTrigger)

    motionTrigger.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    motionTrigger.click()
    await settle()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(requestedPaths).toEqual(['/api/universe/types/100'])
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(motionTrigger)

    const sharpshooterTrigger = triggerButton('View item information for Sharpshooter')
    sharpshooterTrigger.focus()
    sharpshooterTrigger.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
    sharpshooterTrigger.click()
    await vi.waitFor(() => expect(requestedPaths).toHaveLength(2))
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Sharpshooter'),
    )
    const sharpshooterAttributesTab = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((tab) => tab.textContent?.trim() === 'Attributes')
    sharpshooterAttributesTab!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0 }),
    )
    await settle()
    expect(document.querySelector('.skill-item-information-details')?.textContent).toContain(
      'Training multiplierUnavailable',
    )
    expect(document.querySelector('.skill-item-information-details')?.textContent).toContain(
      'Primary attributeUnavailable',
    )
    expect(document.body.textContent).toContain('No description is available for this item.')
  })
})
