export interface PlatformCursorCheckpoint {
  readonly after?: string
  readonly before?: string
  readonly initialAfter?: string
}

export function advancePlatformCursor(
  checkpoint: PlatformCursorCheckpoint,
  cursor: { readonly after?: string; readonly before?: string } | undefined,
  itemCount: number,
) {
  const walkingBefore = !checkpoint.after
  const initialAfter = checkpoint.initialAfter ?? cursor?.after
  if (itemCount > 0 && walkingBefore && cursor?.before) {
    if (cursor.before === checkpoint.before) throw new Error('ESI cursor did not advance')
    return {
      complete: false,
      checkpoint: { before: cursor.before, initialAfter },
      replaceExisting: false,
    }
  }
  if (itemCount > 0 && !walkingBefore && cursor?.after) {
    if (cursor.after === checkpoint.after) throw new Error('ESI cursor did not advance')
    return {
      complete: false,
      checkpoint: { after: cursor.after },
      replaceExisting: true,
    }
  }
  return {
    complete: true,
    checkpoint: { after: walkingBefore ? initialAfter : checkpoint.after },
    replaceExisting: !walkingBefore,
  }
}
