<script setup lang="ts">
import type { EveFormattedText as EveFormattedTextValue } from '../../api/src/text/eve-formatted-text'

const { value } = defineProps<{ value: EveFormattedTextValue }>()

const hasCustomColor = computed(() => value.runs.some((run) => run.color !== undefined))
const formattedLines = computed(() => splitFormattedLines(value.runs))

interface FormattedLine {
  compact: boolean
  runs: EveFormattedTextValue['runs']
  start: number
}

function splitFormattedLines(runs: EveFormattedTextValue['runs']): readonly FormattedLine[] {
  const lines: { runs: EveFormattedTextValue['runs'][number][]; start: number }[] = [
    { runs: [], start: 0 },
  ]

  for (const run of runs) {
    let offset = 0
    while (offset <= run.text.length) {
      const newline = run.text.indexOf('\n', offset)
      const end = newline === -1 ? run.text.length : newline
      const text = run.text.slice(offset, end)
      if (text) {
        lines.at(-1)!.runs.push({
          start: run.start + offset,
          text,
          ...(run.color && { color: run.color }),
        })
      }
      if (newline === -1) {
        break
      }

      lines.push({ runs: [], start: run.start + newline + 1 })
      offset = newline + 1
    }
  }

  return lines.map((line) => ({
    compact: isBlockElementLine(line.runs.map((run) => run.text).join('')),
    runs: line.runs,
    start: line.start,
  }))
}

function isBlockElementLine(text: string) {
  let hasBlockElement = false
  for (const character of text) {
    if (character === ' ' || character === '\t') {
      continue
    }
    const codePoint = character.codePointAt(0)!
    if (codePoint < 0x25_80 || codePoint > 0x25_9f) {
      return false
    }
    hasBlockElement = true
  }
  return hasBlockElement
}
</script>

<template>
  <span class="eve-formatted-text" :class="{ 'eve-formatted-text--colored': hasCustomColor }">
    <span
      v-for="line in formattedLines"
      :key="line.start"
      class="eve-formatted-text__line"
      :class="{ 'eve-formatted-text__line--compact': line.compact }"
    >
      <span v-for="run in line.runs" :key="run.start" :style="{ color: run.color }">{{
        run.text
      }}</span>
    </span>
  </span>
</template>

<style scoped>
.eve-formatted-text {
  white-space: normal;
}

.eve-formatted-text--colored {
  display: block;
  padding: 0.5rem;
  color: var(--ui-eve-formatted-text-color);
  font-family: var(--ui-font-mono);
}

.eve-formatted-text__line {
  display: block;
  min-height: 1lh;
}

.eve-formatted-text__line--compact > span {
  display: inline-block;
  transform: scaleY(1.25);
}
</style>
