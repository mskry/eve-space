export function buildHistoryTimeline<T extends { startDate: string }>(entries: readonly T[]) {
  const sorted = [...entries].toSorted(
    (left, right) => Date.parse(right.startDate) - Date.parse(left.startDate),
  )
  const timeline: Array<T & { endDate: string | undefined }> = []
  for (const [index, entry] of sorted.entries()) {
    timeline.push({
      ...entry,
      endDate: index === 0 ? undefined : sorted[index - 1]?.startDate,
    })
  }
  return timeline
}
