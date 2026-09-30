import type { MarketPlottedDay } from './market-history-presentation'
import {
  marketDayTime,
  marketHistoryLayout,
  marketHistoryX,
  marketHistoryY,
  type MarketHistoryLayout,
  type MarketHistoryRange,
  type MarketPriceBounds,
} from './market-history-viewport'

export interface MarketChartColors {
  background: string
  grid: string
  label: string
  average: string
  five: string
  twenty: string
  range: string
  band: string
  volume: string
  overview: string
  selection: string
  accent: string
  font: string
}

const dayMillis = 86_400_000
const compactPrice = (price: number) => {
  if (price >= 1_000_000_000_000) return `${(price / 1_000_000_000_000).toFixed(2)}T`
  if (price >= 1_000_000_000) return `${(price / 1_000_000_000).toFixed(2)}B`
  if (price >= 1_000_000) return `${(price / 1_000_000).toFixed(2)}M`
  if (price >= 1_000) return `${(price / 1_000).toFixed(2)}K`
  return price.toFixed(price < 10 ? 2 : 0)
}

const priceTickStep = (bounds: MarketPriceBounds, height: number) => {
  const rough = (bounds.max - bounds.min) / Math.max(2, height / 70)
  const power = 10 ** Math.floor(Math.log10(rough))
  const factor = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= rough) ?? 10
  return factor * power
}

const drawPriceGrid = (
  context: CanvasRenderingContext2D,
  layout: MarketHistoryLayout,
  colors: MarketChartColors,
) => {
  context.font = `12px ${colors.font}`
  context.textAlign = 'right'
  context.textBaseline = 'middle'
  const step = priceTickStep(layout.price, layout.priceBottom - layout.top)
  const first = Math.ceil(layout.price.min / step) * step
  for (let index = 0; index < 16; index += 1) {
    const value = first + step * index
    if (value > layout.price.max) break
    const y = Math.round(marketHistoryY(value, layout)) + 0.5
    context.strokeStyle = colors.grid
    context.beginPath()
    context.moveTo(layout.left, y)
    context.lineTo(layout.right, y)
    context.stroke()
    context.fillStyle = colors.label
    context.fillText(compactPrice(value), layout.left - 7, y)
  }
}

const drawDateGrid = (
  context: CanvasRenderingContext2D,
  days: readonly MarketPlottedDay[],
  range: MarketHistoryRange,
  layout: MarketHistoryLayout,
  colors: MarketChartColors,
) => {
  context.font = `12px ${colors.font}`
  context.textAlign = 'center'
  context.textBaseline = 'bottom'
  const monthly = layout.endTime - layout.startTime > 50 * dayMillis
  let previousLabel = ''
  let lastX = -100
  for (let index = range.start; index <= range.end; index += 1) {
    const date = days[index]!.date
    const label = monthly ? date.slice(0, 7) : date
    if (monthly && label === previousLabel) continue
    previousLabel = label
    const x = marketHistoryX(date, layout)
    if (x < layout.left + 24 || x > layout.right - 24 || x - lastX < 65) continue
    lastX = x
    context.strokeStyle = colors.grid
    context.beginPath()
    context.moveTo(Math.round(x) + 0.5, layout.top)
    context.lineTo(Math.round(x) + 0.5, layout.volumeBottom)
    context.stroke()
    context.fillStyle = colors.label
    const display = monthly
      ? new Date(`${date}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
      : date.slice(5)
    context.fillText(display, x, layout.top - 5)
  }
}

const drawBand = (
  context: CanvasRenderingContext2D,
  days: readonly MarketPlottedDay[],
  range: MarketHistoryRange,
  layout: MarketHistoryLayout,
  color: string,
) => {
  let start = range.start
  while (start <= range.end) {
    if (days[start]!.donchianHigh20 === null || days[start]!.donchianLow20 === null) {
      start += 1
      continue
    }
    let end = start
    while (
      end < range.end &&
      days[end + 1]!.donchianHigh20 !== null &&
      days[end + 1]!.donchianLow20 !== null &&
      marketDayTime(days[end + 1]!.date) - marketDayTime(days[end]!.date) === dayMillis
    ) {
      end += 1
    }
    context.beginPath()
    for (let index = start; index <= end; index += 1) {
      const day = days[index]!
      const x = marketHistoryX(day.date, layout)
      const y = marketHistoryY(Number(day.donchianHigh20), layout)
      if (index === start) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    for (let index = end; index >= start; index -= 1) {
      const day = days[index]!
      context.lineTo(
        marketHistoryX(day.date, layout),
        marketHistoryY(Number(day.donchianLow20), layout),
      )
    }
    context.closePath()
    context.fillStyle = color
    context.globalAlpha = 0.16
    context.fill()
    context.globalAlpha = 1
    start = end + 1
  }
}

const drawSeries = (
  context: CanvasRenderingContext2D,
  days: readonly MarketPlottedDay[],
  range: MarketHistoryRange,
  layout: MarketHistoryLayout,
  field: 'movingAverage5' | 'movingAverage20',
  color: string,
) => {
  context.beginPath()
  context.strokeStyle = color
  context.lineWidth = 2
  let previousTime: number | null = null
  for (let index = range.start; index <= range.end; index += 1) {
    const day = days[index]!
    const value = day[field]
    const time = marketDayTime(day.date)
    if (value !== null) {
      const x = marketHistoryX(day.date, layout)
      const y = marketHistoryY(Number(value), layout)
      if (previousTime !== null && time - previousTime === dayMillis) context.lineTo(x, y)
      else context.moveTo(x, y)
    }
    previousTime = value === null ? null : time
  }
  context.stroke()
}

const drawVolume = (
  context: CanvasRenderingContext2D,
  days: readonly MarketPlottedDay[],
  range: MarketHistoryRange,
  layout: MarketHistoryLayout,
  colors: MarketChartColors,
  hovered: number | null,
) => {
  const visible = days.slice(range.start, range.end + 1)
  const maximum = Math.max(1, ...visible.map((day) => day.volume))
  const width = Math.max(1, Math.min(14, ((layout.right - layout.left) / visible.length) * 0.78))
  for (let index = range.start; index <= range.end; index += 1) {
    const day = days[index]!
    const height = (day.volume / maximum) * (layout.volumeBottom - layout.volumeTop)
    context.globalAlpha = index === hovered ? 0.85 : 0.5
    context.fillStyle = colors.volume
    context.fillRect(
      marketHistoryX(day.date, layout) - width / 2,
      layout.volumeBottom - height,
      width,
      height,
    )
  }
  context.globalAlpha = 1
  context.fillStyle = colors.label
  context.font = `11px ${colors.font}`
  context.textAlign = 'left'
  context.fillText('VOLUME', layout.left + 4, layout.volumeTop + 10)
}

const drawPrices = (
  context: CanvasRenderingContext2D,
  days: readonly MarketPlottedDay[],
  range: MarketHistoryRange,
  layout: MarketHistoryLayout,
  colors: MarketChartColors,
  hovered: number | null,
) => {
  drawBand(context, days, range, layout, colors.band)
  context.strokeStyle = colors.range
  context.lineWidth = 1
  for (let index = range.start; index <= range.end; index += 1) {
    const day = days[index]!
    const x = marketHistoryX(day.date, layout)
    context.beginPath()
    context.moveTo(x, marketHistoryY(Number(day.highIsk), layout))
    context.lineTo(x, marketHistoryY(Number(day.lowIsk), layout))
    context.stroke()
  }
  drawSeries(context, days, range, layout, 'movingAverage20', colors.twenty)
  drawSeries(context, days, range, layout, 'movingAverage5', colors.five)
  for (let index = range.start; index <= range.end; index += 1) {
    const day = days[index]!
    context.beginPath()
    context.arc(
      marketHistoryX(day.date, layout),
      marketHistoryY(Number(day.averageIsk), layout),
      index === hovered ? 4 : 2.5,
      0,
      2 * Math.PI,
    )
    context.fillStyle = colors.average
    context.fill()
  }
}

export const drawMarketHistory = (
  context: CanvasRenderingContext2D,
  days: readonly MarketPlottedDay[],
  range: MarketHistoryRange,
  price: MarketPriceBounds,
  hovered: number | null,
  width: number,
  height: number,
  colors: MarketChartColors,
) => {
  context.clearRect(0, 0, width, height)
  context.fillStyle = colors.background
  context.fillRect(0, 0, width, height)
  if (days.length < 2 || width < 110 || height < 180) return
  const layout = marketHistoryLayout(days, range, price, width, height)
  drawPriceGrid(context, layout, colors)
  drawDateGrid(context, days, range, layout, colors)
  context.save()
  context.beginPath()
  context.rect(layout.left, layout.top, layout.right - layout.left, layout.priceBottom - layout.top)
  context.clip()
  drawPrices(context, days, range, layout, colors, hovered)
  context.restore()
  drawVolume(context, days, range, layout, colors, hovered)
  if (hovered !== null && hovered >= range.start && hovered <= range.end) {
    const x = marketHistoryX(days[hovered]!.date, layout)
    context.strokeStyle = colors.accent
    context.globalAlpha = 0.65
    context.setLineDash([3, 4])
    context.beginPath()
    context.moveTo(x, layout.top)
    context.lineTo(x, layout.volumeBottom)
    context.stroke()
    context.setLineDash([])
    context.globalAlpha = 1
  }
}

export const overviewX = (days: readonly MarketPlottedDay[], index: number, width: number) =>
  4 +
  ((marketDayTime(days[index]!.date) - marketDayTime(days[0]!.date)) /
    Math.max(1, marketDayTime(days.at(-1)!.date) - marketDayTime(days[0]!.date))) *
    (width - 8)

export const drawMarketOverview = (
  context: CanvasRenderingContext2D,
  days: readonly MarketPlottedDay[],
  range: MarketHistoryRange,
  width: number,
  height: number,
  colors: MarketChartColors,
) => {
  context.clearRect(0, 0, width, height)
  context.fillStyle = colors.background
  context.fillRect(0, 0, width, height)
  if (days.length < 2 || width < 50) return
  const values = days.map((day) => Number(day.averageIsk))
  const low = Math.min(...values)
  const span = Math.max(0.01, Math.max(...values) - low)
  let segment = 0
  while (segment < days.length) {
    let end = segment
    while (
      end < days.length - 1 &&
      marketDayTime(days[end + 1]!.date) - marketDayTime(days[end]!.date) === dayMillis
    ) {
      end += 1
    }
    context.beginPath()
    context.moveTo(overviewX(days, segment, width), height - 4)
    for (let index = segment; index <= end; index += 1) {
      context.lineTo(
        overviewX(days, index, width),
        height - 6 - ((values[index]! - low) / span) * (height - 14),
      )
    }
    context.lineTo(overviewX(days, end, width), height - 4)
    context.closePath()
    context.fillStyle = colors.overview
    context.globalAlpha = 0.42
    context.fill()
    segment = end + 1
  }
  context.globalAlpha = 1
  const left = overviewX(days, range.start, width)
  const right = overviewX(days, range.end, width)
  context.fillStyle = colors.selection
  context.globalAlpha = 0.16
  context.fillRect(left, 2, right - left, height - 4)
  context.globalAlpha = 0.72
  context.strokeStyle = colors.accent
  context.strokeRect(left + 0.5, 2.5, right - left - 1, height - 5)
  context.globalAlpha = 1
  context.fillStyle = colors.accent
  context.fillRect(left, 2, 4, height - 4)
  context.fillRect(right - 4, 2, 4, height - 4)
  if (right - left > 50) {
    context.font = `12px ${colors.font}`
    context.textAlign = 'left'
    context.fillStyle = colors.label
    context.fillText(`${range.end - range.start + 1} days`, left + 10, height - 10)
  }
}
