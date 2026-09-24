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
    if (cursor.before === checkpoint.before) {
      throw new Error('ESI cursor did not advance')
    }
    return {
      checkpoint: { before: cursor.before, initialAfter },
      complete: false,
      replaceExisting: false,
    }
  }
  if (itemCount > 0 && !walkingBefore && cursor?.after) {
    if (cursor.after === checkpoint.after) {
      throw new Error('ESI cursor did not advance')
    }
    return {
      checkpoint: { after: cursor.after },
      complete: false,
      replaceExisting: true,
    }
  }
  return {
    checkpoint: { after: walkingBefore ? initialAfter : checkpoint.after },
    complete: true,
    replaceExisting: !walkingBefore,
  }
}
