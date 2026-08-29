import type { CharacterSkillQueue } from '../queries/characters'

export type SkillQueueEntry = CharacterSkillQueue['entries'][number]
export type SkillQueueState = CharacterSkillQueue['state']

export interface SkillQueueStatus {
  state: SkillQueueState
  activeQueuePosition: number | null
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A queue with less than this left is worth topping up before it drains. */
export const QUEUE_WARNING_MS = 3 * DAY

/**
 * Mirrors `resolveSkillQueueState` in the API. The response's state is correct at fetch time only,
 * so an open panel re-derives it as the clock advances past the training entry's finish date.
 */
export function resolveSkillQueueState(
  entries: readonly SkillQueueEntry[],
  now: number,
): SkillQueueStatus {
  if (entries.length === 0) return { state: 'empty', activeQueuePosition: null }
  if (entries.every((entry) => entry.startDate === null))
    return { state: 'paused', activeQueuePosition: null }

  const active = entries.find(
    (entry) => entry.finishDate === null || Date.parse(entry.finishDate) > now,
  )
  if (!active) return { state: 'lapsed', activeQueuePosition: null }
  return { state: 'training', activeQueuePosition: active.queuePosition }
}

/** Highest level each skill is queued toward, used to mark queued levels in the catalogue. */
export function queuedLevelsByType(
  queue: Pick<CharacterSkillQueue, 'entries'> | null | undefined,
): Map<number, number> {
  const levels = new Map<number, number>()
  for (const entry of queue?.entries ?? []) {
    const current = levels.get(entry.typeId)
    if (current === undefined || entry.finishedLevel > current)
      levels.set(entry.typeId, entry.finishedLevel)
  }
  return levels
}

export function trainingRatePerMinute(entry: SkillQueueEntry): number | null {
  const duration = entryDurationMs(entry)
  const { trainingStartSp, levelEndSp } = entry
  if (
    duration === null ||
    duration === 0 ||
    trainingStartSp === null ||
    levelEndSp === null ||
    levelEndSp < trainingStartSp
  ) {
    return null
  }
  return Math.round(((levelEndSp - trainingStartSp) / (duration / MINUTE)) * 100) / 100
}

export function entryRemainingMs(entry: SkillQueueEntry, now: number): number | null {
  if (!entry.finishDate) return null
  return Math.max(0, Date.parse(entry.finishDate) - now)
}

export function entryDurationMs(entry: SkillQueueEntry): number | null {
  if (!entry.startDate || !entry.finishDate) return null
  return Math.max(0, Date.parse(entry.finishDate) - Date.parse(entry.startDate))
}

export interface SkillQueueProgress {
  percent: number
  currentSp: number | null
  targetSp: number | null
}

export function entryProgress(entry: SkillQueueEntry, now: number): SkillQueueProgress {
  const start = entry.startDate ? Date.parse(entry.startDate) : null
  const finish = entry.finishDate ? Date.parse(entry.finishDate) : null
  const temporalProgress =
    start === null || finish === null || finish <= start
      ? 0
      : Math.max(0, Math.min(1, (now - start) / (finish - start)))
  const { levelStartSp, levelEndSp } = entry
  const trainingStartSp = entry.trainingStartSp ?? levelStartSp
  const currentSpValue =
    trainingStartSp === null || levelEndSp === null
      ? null
      : trainingStartSp + (levelEndSp - trainingStartSp) * temporalProgress
  const levelProgress =
    currentSpValue === null ||
    levelStartSp === null ||
    levelEndSp === null ||
    levelEndSp <= levelStartSp
      ? temporalProgress
      : (currentSpValue - levelStartSp) / (levelEndSp - levelStartSp)
  const percent = Math.max(0, Math.min(100, Math.round(levelProgress * 100)))
  const currentSp = currentSpValue === null ? null : Math.round(currentSpValue)
  return { percent, currentSp, targetSp: levelEndSp }
}

/** Time until the last dated entry finishes, or null when nothing in the queue is scheduled. */
export function queueRemainingMs(entries: readonly SkillQueueEntry[], now: number): number | null {
  const finishes = entries
    .map((entry) => (entry.finishDate ? Date.parse(entry.finishDate) : null))
    .filter((value): value is number => value !== null)
  if (finishes.length === 0) return null
  return Math.max(0, Math.max(...finishes) - now)
}

export interface SkillQueueSegment {
  queuePosition: number
  flex: number
}

/** Proportional widths for the queue's duration bar; entries without a duration are skipped. */
export function queueSegments(entries: readonly SkillQueueEntry[]): SkillQueueSegment[] {
  const durations = entries.flatMap((entry) => {
    const duration = entryDurationMs(entry)
    return duration === null || duration === 0 ? [] : [{ entry, duration }]
  })
  const totalDuration = durations.reduce((total, segment) => total + segment.duration, 0)
  return durations.map(({ entry, duration }) => ({
    queuePosition: entry.queuePosition,
    flex: duration / totalDuration,
  }))
}

export function formatQueueDuration(milliseconds: number | null): string {
  if (milliseconds === null) return 'UNSCHEDULED'
  if (milliseconds <= 0) return 'DONE'

  const days = Math.floor(milliseconds / DAY)
  if (days > 0) return `${days}d ${Math.floor((milliseconds % DAY) / HOUR)}h`
  const hours = Math.floor(milliseconds / HOUR)
  if (hours > 0) return `${hours}h ${Math.floor((milliseconds % HOUR) / MINUTE)}m`
  return `${Math.max(1, Math.floor(milliseconds / MINUTE))}m`
}

export function romanLevel(level: number): string {
  return ['0', 'I', 'II', 'III', 'IV', 'V'][level] ?? String(level)
}
