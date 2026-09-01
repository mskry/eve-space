import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const route = source('app/pages/characters/[characterId]/skills.vue')
const summary = source('app/components/character/skills/SummaryCard.vue')
const catalogue = source('app/components/character/skills/Catalogue.vue')
const queue = source('app/components/character/skills/Queue.vue')
const page = [route, summary, catalogue, queue].join('\n')
const features = source('app/assets/css/features/skills.css')
const responsive = source('app/assets/css/responsive/skills.css')

describe('skills catalogue markup', () => {
  it('keeps the route focused on orchestration and composes feature components', () => {
    expect(route).toContain('<CharacterSkillsSummaryCard')
    expect(route).toContain('<CharacterSkillsCatalogue')
    expect(route).toContain('<CharacterSkillsQueue')
    expect(route).not.toContain('new Fuse(')
    expect(route).not.toContain('setInterval(')
  })

  it('uses the shared summary card with a group selector and a single list', () => {
    expect(page).toContain('skill-group-chips')
    expect(page).toContain('<fieldset class="skill-group-chips">')
    expect(page).toContain('<legend class="sr-only">Skill groups</legend>')
    expect(page).toContain('skill-list-panel')
    expect(page).not.toContain('UiCollapsible')
    expect(page).not.toContain('TransitionGroup')
    expect(page).not.toContain('skillGroupColumns')
    expect(page).toContain('CharacterSummaryCard')
  })

  it('gives every group chip a decorative category glyph in a three-column grid', () => {
    expect(page).toContain('<CharacterSkillsGroupIcon :name="group.icon" />')
    expect(features).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(features).toContain('grid-template-columns: auto minmax(0, 1fr) auto')
    expect(responsive).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
  })

  it('marks selection and vacancy on group chips programmatically', () => {
    expect(page).toContain(':aria-pressed="group.key === activeGroupKey"')
    expect(page).toContain(':disabled="group.count === 0"')
    expect(page).toContain("'is-vacant': group.count === 0")
  })

  it('exposes the trained-level filter as a labelled native fieldset', () => {
    expect(page).toContain('<fieldset class="skills-level-filter">')
    expect(page).toContain('<legend class="sr-only">Filter skills by trained level</legend>')
    expect(page).not.toContain('role="group"')
    expect(page).toContain(':aria-pressed="levelFilter === filter.id"')
    expect(page).toContain("{ id: 'partial', label: 'BELOW V' }")
    expect(page).toContain("{ id: 'v', label: 'AT V' }")
  })

  it('announces the changing result count politely', () => {
    expect(page).toContain('aria-live="polite"')
    expect(page).toContain('{{ matchLabel }}')
  })

  it('keeps both empty states and names the search term', () => {
    expect(page).toContain('No trained skills returned')
    expect(page).toContain('00 / NO MATCHES')
    expect(page).toContain('No skills match "{{ searchTerm }}".')
  })

  it('builds one search index rather than one per candidate name', () => {
    expect(page).toContain('new Fuse(indexedSkills.value, fuseOptions)')
    expect(page).not.toContain('new Fuse([{ name }]')
  })

  it('retargets search highlighting at the new row and chip markup', () => {
    expect(page).toContain("selector: '.skill-row-name, .skill-group-chip-name'")
  })
})

describe('training queue markup', () => {
  it('renders the queue as a labelled region beside the catalogue', () => {
    expect(page).toContain('aria-labelledby="skill-queue-title"')
    expect(page).toContain('Training Queue')
    expect(features).toContain('grid-template-columns: minmax(0, 1fr) minmax(18.75rem, 22rem)')
  })

  it('renders the training state with progress, remaining time and totals', () => {
    expect(page).toContain('<progress')
    expect(page).toContain(':value="activeQueueProgress?.percent ?? 0"')
    expect(page).not.toContain('role="progressbar"')
    expect(page).toContain('formatQueueDuration(activeQueueRemaining)')
    expect(page).toContain('formatQueueDuration(queueTotalRemaining)')
    expect(page).toContain('skill-queue-segments')
  })

  it('covers every queue state including lapsed', () => {
    expect(page).toContain("training: 'TRAINING'")
    expect(page).toContain("paused: 'PAUSED'")
    expect(page).toContain("empty: 'EMPTY'")
    expect(page).toContain("lapsed: 'COMPLETED'")
    expect(page).toContain('Queue finished. Trained levels update at next login.')
    expect(page).toContain('Training is paused. Restart the queue in game.')
    expect(page).toContain('Nothing queued. Training time is going to waste.')
  })

  it('warns without relying on colour alone', () => {
    expect(page).toContain('! UNDER 3 DAYS')
    expect(features).toContain('.skill-queue-warning.is-warning')
  })

  it('advances relative values on a client timer that is cleared on unmount', () => {
    expect(page).toContain('onMounted(')
    expect(page).toContain('setInterval(')
    expect(page).toContain('30_000')
    expect(page).toContain('onUnmounted(')
    expect(page).toContain('clearInterval(queueTicker)')
  })

  it('re-derives queue state from the clock rather than trusting the fetched value', () => {
    expect(page).toContain('resolveSkillQueueState(queueEntries.value, nowMs.value)')
  })
})

describe('independent authorization', () => {
  it('gives the queue its own scope prompt without gating the catalogue', () => {
    expect(page).toContain('Skill queue authorization required')
    expect(page).toContain(':authorize-url="skillQueueAuthorizeUrl"')
    expect(page).toContain('Skills authorization required')
    expect(page).toContain(':authorize-url="skillsAuthorizeUrl"')
  })

  it('gives the queue and attributes their own retry affordances', () => {
    expect(route).toContain('@retry="skillQueueQuery.refetch()"')
    expect(route).toContain('@retry-attributes="attributesQuery.refetch()"')
    expect(queue).toContain("emit('retry')")
    expect(summary).toContain("emit('retryAttributes')")
  })

  it('refreshes every source from the single reauthorization subscription', () => {
    expect(route).toContain('useCharacterReauthorization(')
    expect(route.match(/useCharacterReauthorization\(/g)).toHaveLength(1)
    expect(route).toContain(
      'void Promise.all([skillsQuery.refetch(), attributesQuery.refetch(), skillQueueQuery.refetch()])',
    )
  })

  it('keeps every request client-gated and character-bound', () => {
    expect(route).toContain('canRunProtectedQuery(import.meta.client')
    expect(route).toContain('enabled: protectedQueryEnabled.value')
    expect(route.match(/enabled: protectedQueryEnabled\.value/g)).toHaveLength(3)
  })
})

describe('responsive layout', () => {
  it('collapses the rail below the catalogue rather than hiding it', () => {
    expect(responsive).toContain('@media (max-width: 1100px)')
    expect(responsive).toContain('grid-template-columns: 1fr')
    expect(responsive).not.toContain('display: none')
  })

  it('keeps long names inside their columns instead of overflowing the page', () => {
    for (const selector of ['.skill-row-name', '.skill-group-chip-name', '.skill-queue-entry-name'])
      expect(features).toContain(selector)
    expect(features.match(/text-overflow: ellipsis/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })
})

describe('theme tokens', () => {
  it('styles the view from semantic tokens rather than literal colours', () => {
    expect(features).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(responsive).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(features).toContain('var(--ui-primary)')
    expect(features).toContain('var(--ui-warning)')
  })
})
