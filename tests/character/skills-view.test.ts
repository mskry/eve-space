import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const route = source('app/pages/characters/[characterId]/skills.vue')
const summary = source('app/components/character/skills/SummaryCard.vue')
const catalogue = source('app/components/character/skills/Catalogue.vue')
const queue = source('app/components/character/skills/Queue.vue')
const page = [route, summary, catalogue, queue].join('\n')
const summaryStyles = source('app/assets/css/features/character-summary.css')
const features = source('app/assets/css/features/skills.css')
const responsive = source('app/assets/css/responsive/skills.css')

describe('skills catalogue markup', () => {
  it('keeps the route focused on orchestration and composes feature components', () => {
    expect(route).toContain('<CharacterSkillsSummaryCard')
    expect(route).toContain('<CharacterSkillsCatalogue')
    expect(route).toContain(':key="characterId"')
    expect(route).toContain(':skill-queue-status="skillQueueStatus"')
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
    expect(page).toContain('AppSummaryCard')
  })

  it('keeps shared summary cards free of diagonal hatching', () => {
    expect(summaryStyles).not.toContain('repeating-linear-gradient')
    expect(features).not.toMatch(/\.character-summary-card\.skills-hero \{[^}]*background:/s)
  })

  it('gives every group chip a decorative category glyph in three columns', () => {
    expect(page).toContain('<CharacterSkillsGroupIcon :name="group.icon" />')
    expect(features).toMatch(/\.skill-group-chips \{[^}]*columns: 3;[^}]*column-gap: 0\.3125rem/s)
    expect(features).toContain('grid-template-columns: auto minmax(0, 1fr) auto')
    expect(responsive).toMatch(/\.skill-group-chips \{[^}]*columns: 2;/s)
    expect(features).toContain('.skill-group-chip::after')
    expect(features).toContain('clip-path: var(--skill-chip-shape)')
    expect(features).toContain('border-shape: var(--skill-chip-shape)')
    expect(features).toMatch(
      /\.skill-group-chip::before \{[^}]*calc\(var\(--skill-chip-notch\) - 0\.0625rem\)/s,
    )
    expect(features).not.toMatch(/\.skill-group-chip \{[^}]*overflow: hidden/s)
  })

  it('flows alphabetical groups and skills down balanced columns', () => {
    expect(page).not.toContain('skillGroupColumns')
    expect(features).toMatch(/\.skill-group-chip \{[^}]*break-inside: avoid;/s)
    expect(features).toMatch(/\.skill-list \{[^}]*columns: 2;[^}]*column-gap: 0\.125rem/s)
    expect(features).toMatch(/\.skill-row \{[^}]*break-inside: avoid;/s)
    expect(responsive).toMatch(/\.skill-list \{[^}]*columns: 1;/s)
    expect(responsive).toMatch(
      /@media \(max-width: 520px\) \{[\s\S]*\.skill-group-chips \{[^}]*columns: 1;/,
    )
  })

  it('marks selection and vacancy on group chips programmatically', () => {
    expect(page).toContain(':aria-pressed="group.key === activeGroupKey"')
    expect(page).toContain(':aria-label="groupLabel(group)"')
    expect(page).toContain(':disabled="group.count === 0"')
    expect(page).toContain("'is-vacant': group.count === 0")
  })

  it('uses shared Reka-backed toggles for the catalogue filters', () => {
    expect(page).toContain('<UiToggleGroup')
    expect(page).toContain('class="skills-level-filter"')
    expect(page).toContain('label="Filter skills by trained level"')
    expect(page).toContain("{ value: 'untrained', label: 'UNTRAINED' }")
    expect(page).toContain("{ value: 'progress', label: 'IN PROGRESS' }")
    expect(page).toContain("{ value: 'v', label: 'AT V' }")
    expect(page).toContain('<UiToggle\n          v-model="queuedOnly"')
    expect(page).toContain('class="skills-queued-filter"')
    expect(features).not.toContain('.skills-level-filter button')
    expect(features).not.toContain('.skills-queued-filter {')
  })

  it('keeps the result label beside search and aligns filter controls to the right', () => {
    const search = catalogue.indexOf('<UiToolbar class="skills-toolbar"')
    const status = catalogue.indexOf('class="app-search-status skills-match-status"')
    const controls = catalogue.indexOf('<div class="skills-filter-controls">')

    expect(search).toBeGreaterThan(-1)
    expect(search).toBeLessThan(status)
    expect(status).toBeLessThan(controls)
    expect(features).toMatch(/\.skills-filter-controls \{[^}]*margin-left: auto/s)
    expect(features).toMatch(/\.skills-filter-controls \{[^}]*justify-content: flex-end/s)
  })

  it('announces the changing result count politely', () => {
    expect(page).toContain('aria-live="polite"')
    expect(page).toContain('{{ announcedResult }}')
    expect(page).toContain('}, 300)')
    expect(page).toContain('{{ compactResultStatus }}')
    expect(page).toContain("'is-visible': resultsRefined")
    expect(page).toContain('CATALOGUE SKILLS')
  })

  it('keeps the no-injected notice non-blocking and names an empty search', () => {
    expect(page).toContain('skills.injectedSkillCount === 0 && skills.groups.length > 0')
    expect(page).toContain('This character has no injected skills.')
    expect(page).toContain('skills.groups.length === 0')
    expect(page).toContain('Skill catalogue unavailable')
    expect(page).toContain('00 / NO MATCHES')
    expect(page).toContain('No skills match "{{ searchTerm }}".')
  })

  it('labels catalogue counts, trained points, and trained levels explicitly', () => {
    expect(page).toContain("'catalogue skill' : 'catalogue skills'")
    expect(page).toContain('TRAINED SP')
    expect(page).toContain('trained skill points')
    expect(page).toContain(':aria-label="`Trained level ${skill.trainedLevel}`"')
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
    expect(responsive).toContain('min-height: min(42rem, calc(100dvh - 12rem))')
  })

  it('renders the training state with level indicators, remaining time and totals', () => {
    expect(page).not.toContain('<UiProgress')
    expect(page).not.toContain('<progress')
    expect(page).toContain('class="skill-level-track skill-queue-current-levels"')
    expect(page).toContain('v-for="level in 5"')
    expect(page).toContain("'is-active': level === activeQueueEntry.finishedLevel")
    expect(page).toContain('class="skill-queue-chevron-field"')
    expect(page).toContain('v-for="chevron in 32"')
    expect(features).toContain('clip-path: polygon(')
    expect(features).toContain('animation: skill-queue-chevron-alternate 8s ease-in-out infinite')
    expect(features).toContain('animation-delay: -4s')
    expect(features).toMatch(
      /\.skill-queue-chevron-field \{[^}]*position: absolute;[^}]*inset: 0;/s,
    )
    expect(page).toContain('formatQueueDuration(activeQueueRemaining)')
    expect(page).toContain('formatQueueDuration(queueTotalRemaining)')
    expect(page).toContain('skill-queue-segments')
    expect(page).toContain('queueRemainingSp(queueEntries.value, nowMs.value)')
    expect(page).toContain('class="skill-queue-sp-summary"')
    expect(route).toContain(':unallocated-sp="skills.unallocatedSp"')
    expect(queue).toContain('class="skill-queue-unallocated"')
    expect(queue).toContain('class="skill-queue-unallocated-label"')
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
    expect(page).toContain('href: skillsAuthorizeUrl.value')
    expect(page).toContain('<EsiResourceBoundary')
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
    expect(page).toContain(':data-full-name="skill.name"')
    expect(page).toContain('name.scrollWidth > name.clientWidth')
    expect(features).toMatch(/\.skill-row-name\.is-revealed::after \{[^}]*position: absolute/s)
    expect(features).toMatch(/\.skill-row-name\.is-revealed::after \{[^}]*white-space: nowrap/s)
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
