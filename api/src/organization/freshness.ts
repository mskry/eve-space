export function earliestIsoTimestamp(timestamps: readonly string[]) {
  let earliest: { timestamp: string; time: number } | undefined
  for (const timestamp of timestamps) {
    const time = Date.parse(timestamp)
    if (!Number.isFinite(time) || (earliest && earliest.time <= time)) continue
    earliest = { timestamp, time }
  }
  return earliest?.timestamp
}
