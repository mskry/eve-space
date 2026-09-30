<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  drawMarketHistory,
  drawMarketOverview,
  overviewX,
  type MarketChartColors,
} from '../market-history-canvas'
import {
  closestMarketDay,
  fitMarketPrice,
  initialHistoryRange,
  marketDayTime,
  marketHistoryLayout,
  marketHistoryX,
  marketHistoryY,
  moveHistoryRange,
  panMarketPrice,
  resizeHistoryRange,
  zoomMarketPrice,
  type MarketHistoryRange,
  type MarketPriceBounds,
} from '../market-history-viewport'
import { formatMarketIsk } from '../market-isk'
import type { MarketPlottedDay } from '../market-history-presentation'

type HoveredDay = { index: number; kind: 'price' | 'volume' }
type DragState = {
  kind: 'plot' | 'start' | 'end' | 'move'
  pointerId: number
  originX: number
  originY: number
  originIndex: number
  range: MarketHistoryRange
  price: MarketPriceBounds
  moved: boolean
}

const props = defineProps<{ days: readonly MarketPlottedDay[] }>()
const mainCanvas = ref<HTMLCanvasElement | null>(null)
const overviewCanvas = ref<HTMLCanvasElement | null>(null)
const range = ref<MarketHistoryRange>(initialHistoryRange(props.days.length, 800))
const manualPrice = ref<MarketPriceBounds | null>(null)
const selectedIndex = ref(props.days.length - 1)
const hovered = ref<HoveredDay | null>(null)
const overviewCursor = ref('grab')
const mainSize = ref({ width: 0, height: 0 })
const selected = computed(() => props.days[selectedIndex.value] ?? props.days.at(-1)!)
const selectedLabel = computed(
  () =>
    `${selected.value.date} UTC · Daily Average ${formatMarketIsk(selected.value.averageIsk)} · high ${formatMarketIsk(selected.value.highIsk)} · low ${formatMarketIsk(selected.value.lowIsk)} · volume ${selected.value.volume.toLocaleString('en-US')} · ${selected.value.orderCount.toLocaleString('en-US')} orders`,
)
const hoveredDay = computed(() => (hovered.value ? props.days[hovered.value.index] : null))
const priceBounds = computed(() => manualPrice.value ?? fitMarketPrice(props.days, range.value))
const firstDate = computed(() => props.days[0]!.date)
const lastDate = computed(() => props.days.at(-1)!.date)
let resizeObserver: ResizeObserver | undefined
let themeObserver: MutationObserver | undefined
let scheduledFrame: number | undefined
let drag: DragState | null = null

const color = (styles: CSSStyleDeclaration, token: string, fallback: string) =>
  styles.getPropertyValue(token).trim() || fallback

const chartColors = (element: Element): MarketChartColors => {
  const styles = getComputedStyle(element)
  return {
    background: color(styles, '--ui-control', '#080e12'),
    grid: color(styles, '--ui-border', '#344047'),
    label: color(styles, '--ui-text-muted', '#83919b'),
    average: color(styles, '--ui-warning', '#ff8a44'),
    five: color(styles, '--ui-system-security-08', '#4ecef8'),
    twenty: color(styles, '--ui-primary', '#51e0c1'),
    range: color(styles, '--ui-text-subtle', '#83919b'),
    band: color(styles, '--ui-text-muted', '#83919b'),
    volume: color(styles, '--ui-system-security-09', '#399aeb'),
    overview: color(styles, '--ui-text-muted', '#83919b'),
    selection: color(styles, '--ui-text', '#e8edf0'),
    accent: color(styles, '--ui-primary', '#51e0c1'),
    font: color(styles, '--ui-font-body', 'sans-serif'),
  }
}

const canvasContext = (element: HTMLCanvasElement) => {
  const context = element.getContext('2d')
  if (!context) return null
  const { width, height } = element.getBoundingClientRect()
  if (!width || !height) return null
  const ratio = Math.min(window.devicePixelRatio || 1, 3)
  const pixelWidth = Math.round(width * ratio)
  const pixelHeight = Math.round(height * ratio)
  if (element.width !== pixelWidth || element.height !== pixelHeight) {
    element.width = pixelWidth
    element.height = pixelHeight
  }
  context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0)
  return { context, width, height }
}

const draw = () => {
  scheduledFrame = undefined
  const main = mainCanvas.value && canvasContext(mainCanvas.value)
  const overview = overviewCanvas.value && canvasContext(overviewCanvas.value)
  if (!main || !overview || !mainCanvas.value) return
  const colors = chartColors(mainCanvas.value)
  drawMarketHistory(
    main.context,
    props.days,
    range.value,
    priceBounds.value,
    hovered.value?.index ?? null,
    main.width,
    main.height,
    colors,
  )
  drawMarketOverview(
    overview.context,
    props.days,
    range.value,
    overview.width,
    overview.height,
    colors,
  )
}

const scheduleDraw = () => {
  if (scheduledFrame === undefined) scheduledFrame = requestAnimationFrame(draw)
}

const plotLayout = () => {
  const bounds = mainCanvas.value?.getBoundingClientRect()
  return bounds
    ? marketHistoryLayout(props.days, range.value, priceBounds.value, bounds.width, bounds.height)
    : null
}

const plotPosition = (event: PointerEvent | WheelEvent) => {
  const rect = mainCanvas.value?.getBoundingClientRect()
  return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null
}

const inspectedIndex = (x: number) => {
  const layout = plotLayout()
  if (!layout) return null
  const ratio = (x - layout.left) / (layout.right - layout.left)
  const time = layout.startTime + ratio * (layout.endTime - layout.startTime)
  return Math.max(range.value.start, Math.min(range.value.end, closestMarketDay(props.days, time)))
}

const tooltipReference = computed(() => {
  const day = hoveredDay.value
  const layout = mainSize.value.width
    ? marketHistoryLayout(
        props.days,
        range.value,
        priceBounds.value,
        mainSize.value.width,
        mainSize.value.height,
      )
    : null
  const x = day && layout ? marketHistoryX(day.date, layout) : 0
  let y = 0
  if (layout && day) {
    y =
      hovered.value?.kind === 'volume'
        ? layout.volumeTop + (layout.volumeBottom - layout.volumeTop) / 2
        : Math.max(
            layout.top,
            Math.min(layout.priceBottom, marketHistoryY(Number(day.averageIsk), layout)),
          )
  }
  return {
    getBoundingClientRect: () => {
      const rect = mainCanvas.value?.getBoundingClientRect()
      return rect ? new DOMRect(rect.left + x, rect.top + y, 1, 1) : new DOMRect()
    },
    contextElement: mainCanvas.value ?? undefined,
  }
})

const inspectPlot = (event: PointerEvent) => {
  const position = plotPosition(event)
  const layout = plotLayout()
  if (
    !position ||
    !layout ||
    position.x < layout.left ||
    position.x > layout.right ||
    position.y < layout.top ||
    position.y > layout.volumeBottom
  ) {
    hovered.value = null
    return
  }
  const index = inspectedIndex(position.x)
  hovered.value =
    index === null
      ? null
      : {
          index,
          kind: position.y >= layout.volumeTop ? 'volume' : 'price',
        }
  scheduleDraw()
}

const onPlotDown = (event: PointerEvent) => {
  if (event.button !== 0) return
  const position = plotPosition(event)
  const layout = plotLayout()
  if (!position || !layout || position.y < layout.top || position.y > layout.volumeBottom) return
  inspectPlot(event)
  drag = {
    kind: 'plot',
    pointerId: event.pointerId,
    originX: position.x,
    originY: position.y,
    originIndex: hovered.value?.index ?? range.value.end,
    range: { ...range.value },
    price: { ...priceBounds.value },
    moved: false,
  }
  mainCanvas.value?.setPointerCapture(event.pointerId)
}

const keepSelectionVisible = () => {
  if (selectedIndex.value < range.value.start) selectedIndex.value = range.value.start
  if (selectedIndex.value > range.value.end) selectedIndex.value = range.value.end
}

const onPlotMove = (event: PointerEvent) => {
  const position = plotPosition(event)
  const layout = plotLayout()
  if (!position || !layout) return
  if (drag?.kind === 'plot' && drag.pointerId === event.pointerId) {
    const dx = position.x - drag.originX
    const dy = position.y - drag.originY
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4
    if (drag.moved) {
      const span = drag.range.end - drag.range.start
      range.value = moveHistoryRange(
        drag.range,
        (-dx / (layout.right - layout.left)) * span,
        props.days.length,
      )
      manualPrice.value = panMarketPrice(drag.price, dy / (layout.priceBottom - layout.top))
      keepSelectionVisible()
      hovered.value = null
      scheduleDraw()
    }
    return
  }
  if (event.pointerType !== 'touch') inspectPlot(event)
}

const onPlotUp = (event: PointerEvent) => {
  if (drag?.kind !== 'plot' || drag.pointerId !== event.pointerId) return
  if (!drag.moved) {
    inspectPlot(event)
    if (hovered.value) selectedIndex.value = hovered.value.index
  }
  drag = null
  mainCanvas.value?.releasePointerCapture(event.pointerId)
}

const overviewIndex = (event: PointerEvent) => {
  const rect = overviewCanvas.value?.getBoundingClientRect()
  if (!rect) return 0
  const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - 4) / (rect.width - 8)))
  const time =
    marketDayTime(firstDate.value) +
    fraction * (marketDayTime(lastDate.value) - marketDayTime(firstDate.value))
  return closestMarketDay(props.days, time)
}

const overviewMode = (event: PointerEvent) => {
  const rect = overviewCanvas.value?.getBoundingClientRect()
  if (!rect) return 'move' as const
  const x = event.clientX - rect.left
  const left = overviewX(props.days, range.value.start, rect.width)
  const right = overviewX(props.days, range.value.end, rect.width)
  if (Math.abs(x - left) <= 14) return 'start' as const
  if (Math.abs(x - right) <= 14) return 'end' as const
  return 'move' as const
}

const onOverviewDown = (event: PointerEvent) => {
  if (event.button !== 0) return
  const mode = overviewMode(event)
  const index = overviewIndex(event)
  if (mode === 'move' && (index < range.value.start || index > range.value.end)) {
    const center = Math.round((range.value.start + range.value.end) / 2)
    range.value = moveHistoryRange(range.value, index - center, props.days.length)
    keepSelectionVisible()
  }
  drag = {
    kind: mode,
    pointerId: event.pointerId,
    originX: event.clientX,
    originY: event.clientY,
    originIndex: index,
    range: { ...range.value },
    price: { ...priceBounds.value },
    moved: false,
  }
  overviewCanvas.value?.setPointerCapture(event.pointerId)
  scheduleDraw()
}

const onOverviewMove = (event: PointerEvent) => {
  if (!drag || drag.kind === 'plot' || drag.pointerId !== event.pointerId) {
    overviewCursor.value = overviewMode(event) === 'move' ? 'grab' : 'col-resize'
    return
  }
  const index = overviewIndex(event)
  drag.moved ||= Math.abs(event.clientX - drag.originX) > 3
  if (drag.kind === 'move') {
    range.value = moveHistoryRange(drag.range, index - drag.originIndex, props.days.length)
  } else {
    range.value = resizeHistoryRange(drag.range, drag.kind, index, props.days.length)
  }
  keepSelectionVisible()
  scheduleDraw()
}

const onOverviewUp = (event: PointerEvent) => {
  if (!drag || drag.kind === 'plot' || drag.pointerId !== event.pointerId) return
  drag = null
  overviewCanvas.value?.releasePointerCapture(event.pointerId)
}

const zoomPrice = (factor: number, position = 0.5) => {
  manualPrice.value = zoomMarketPrice(priceBounds.value, factor, position)
  scheduleDraw()
}

const onTooltipOpen = (open: boolean) => {
  if (!open) hovered.value = null
}

const onPlotLeave = () => {
  if (!drag) hovered.value = null
}

const resetView = () => {
  range.value = initialHistoryRange(props.days.length, mainCanvas.value?.clientWidth ?? 800)
  manualPrice.value = null
  selectedIndex.value = props.days.length - 1
  hovered.value = null
  scheduleDraw()
}

const onWheel = (event: WheelEvent) => {
  const position = plotPosition(event)
  const layout = plotLayout()
  if (!position || !layout || position.x < layout.left || position.x > layout.right) return
  if (Math.abs(event.deltaX) > 0 || event.shiftKey) {
    event.preventDefault()
    const delta = event.deltaX || event.deltaY
    const span = range.value.end - range.value.start
    range.value = moveHistoryRange(
      range.value,
      (delta / (layout.right - layout.left)) * span,
      props.days.length,
    )
    keepSelectionVisible()
    scheduleDraw()
  } else if (event.altKey || event.ctrlKey || event.metaKey) {
    event.preventDefault()
    zoomPrice(
      Math.exp(event.deltaY * 0.001),
      (position.y - layout.top) / (layout.priceBottom - layout.top),
    )
  }
}

const onChartKeydown = (event: KeyboardEvent) => {
  const step = event.key === 'PageDown' || event.key === 'PageUp' ? 7 : 1
  if (event.key === 'ArrowLeft' || event.key === 'PageDown')
    selectedIndex.value = Math.max(0, selectedIndex.value - step)
  else if (event.key === 'ArrowRight' || event.key === 'PageUp')
    selectedIndex.value = Math.min(props.days.length - 1, selectedIndex.value + step)
  else if (event.key === 'Home') selectedIndex.value = 0
  else if (event.key === 'End') selectedIndex.value = props.days.length - 1
  else return
  event.preventDefault()
  hovered.value = { index: selectedIndex.value, kind: 'price' }
  scheduleDraw()
}

watch(() => props.days, resetView)
watch(hovered, scheduleDraw)
watch(selectedIndex, (index) => {
  if (index < range.value.start)
    range.value = moveHistoryRange(range.value, index - range.value.start, props.days.length)
  if (index > range.value.end)
    range.value = moveHistoryRange(range.value, index - range.value.end, props.days.length)
  scheduleDraw()
})
onMounted(() => {
  resetView()
  resizeObserver = new ResizeObserver(() => {
    const rect = mainCanvas.value?.getBoundingClientRect()
    if (rect) mainSize.value = { width: rect.width, height: rect.height }
    scheduleDraw()
  })
  if (mainCanvas.value) resizeObserver.observe(mainCanvas.value)
  if (overviewCanvas.value) resizeObserver.observe(overviewCanvas.value)
  themeObserver = new MutationObserver(scheduleDraw)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})
onUnmounted(() => {
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  if (scheduledFrame !== undefined) cancelAnimationFrame(scheduledFrame)
})
</script>

<template>
  <div class="market-history-chart">
    <ul class="market-history-chart__legend" aria-label="Chart series">
      <li class="average">Daily Average</li>
      <li class="range">High–low range</li>
      <li class="five">5-day average</li>
      <li class="twenty">20-day average</li>
      <li class="band">20-day Donchian band</li>
      <li class="volume">Volume</li>
    </ul>
    <UiTooltip
      :open="hovered !== null"
      :reference="tooltipReference"
      :delay-duration="0"
      :arrow="false"
      content-class="market-history-chart__tooltip"
      @update:open="onTooltipOpen"
    >
      <canvas
        ref="mainCanvas"
        class="market-history-chart__plot"
        tabindex="0"
        :aria-label="`Daily regional price history. ${selectedLabel}. Use left and right arrow keys to inspect dates, Page Up and Page Down for a week, Home and End for the first and last day.`"
        @pointerdown="onPlotDown"
        @pointermove="onPlotMove"
        @pointerup="onPlotUp"
        @pointercancel="onPlotUp"
        @pointerleave="onPlotLeave"
        @keydown="onChartKeydown"
        @wheel="onWheel"
      />
      <template #content>
        <div v-if="hoveredDay" class="market-history-chart__tooltip-body">
          <strong>{{ hoveredDay.date }} UTC</strong>
          <template v-if="hovered?.kind === 'volume'">
            <span>Volume · {{ hoveredDay.volume.toLocaleString('en-US') }}</span>
            <span>Orders · {{ hoveredDay.orderCount.toLocaleString('en-US') }}</span>
          </template>
          <template v-else>
            <span>Daily Average · {{ formatMarketIsk(hoveredDay.averageIsk) }}</span>
            <span
              >High / low · {{ formatMarketIsk(hoveredDay.highIsk) }} /
              {{ formatMarketIsk(hoveredDay.lowIsk) }}</span
            >
            <span v-if="hoveredDay.movingAverage5"
              >5-day · {{ formatMarketIsk(hoveredDay.movingAverage5) }}</span
            >
            <span v-if="hoveredDay.movingAverage20"
              >20-day · {{ formatMarketIsk(hoveredDay.movingAverage20) }}</span
            >
          </template>
        </div>
      </template>
    </UiTooltip>
    <canvas
      ref="overviewCanvas"
      class="market-history-chart__overview"
      :style="{ cursor: overviewCursor }"
      aria-hidden="true"
      @pointerdown="onOverviewDown"
      @pointermove="onOverviewMove"
      @pointerup="onOverviewUp"
      @pointercancel="onOverviewUp"
    />
  </div>
</template>

<style scoped>
.market-history-chart {
  min-width: 0;
  display: grid;
  gap: 0.5rem;
}
.market-history-chart__legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35rem 1rem;
  padding: 0;
  margin: 0;
  list-style: none;
  color: var(--ui-text-muted);
  font-size: 0.8rem;
}
.market-history-chart__legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
}
.market-history-chart__legend li::before {
  content: '';
  display: inline-block;
  flex: 0 0 auto;
}
.market-history-chart__legend .average::before {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ui-warning);
}
.market-history-chart__legend .range::before {
  width: 1px;
  height: 12px;
  margin: 0 5px;
  background: var(--ui-text-subtle);
}
.market-history-chart__legend .five::before {
  width: 12px;
  height: 2px;
  background: var(--ui-system-security-08);
}
.market-history-chart__legend .twenty::before {
  width: 12px;
  height: 2px;
  background: var(--ui-primary);
}
.market-history-chart__legend .band::before {
  width: 12px;
  height: 12px;
  background: color-mix(in srgb, var(--ui-text-muted) 25%, transparent);
}
.market-history-chart__legend .volume::before {
  width: 12px;
  height: 12px;
  background: color-mix(in srgb, var(--ui-system-security-09) 50%, transparent);
}
canvas {
  display: block;
  width: 100%;
  background: var(--ui-control);
}
.market-history-chart__plot {
  height: clamp(24rem, 65vh, 42rem);
  cursor: crosshair;
  touch-action: pan-y;
}
.market-history-chart__plot:active {
  cursor: grabbing;
}
.market-history-chart__overview {
  height: 3.5rem;
  touch-action: none;
}
canvas:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}
:global(.ui-tooltip-content.market-history-chart__tooltip) {
  display: block;
  max-width: min(24rem, calc(100vw - 2rem));
  font: 12px/1.5 var(--ui-font-body);
  letter-spacing: normal;
}
.market-history-chart__tooltip-body {
  display: grid;
  gap: 0.2rem;
}
@media (max-width: 600px) {
  .market-history-chart__plot {
    height: 62vh;
    min-height: 20rem;
  }
}
</style>
