const attempts = new Map<string, Promise<void>>()

export const schedulePendingRecoveryOnce = (
  characterId: number,
  subjectLifecycleId: string,
  recover: () => Promise<void>,
  onFailure: (error: Error) => void,
) => {
  const identity = `${characterId}:${subjectLifecycleId}`
  if (attempts.has(identity)) {
    return
  }
  const attempt = Promise.resolve()
    .then(recover)
    .catch((error) =>
      onFailure(error instanceof Error ? error : new Error('Pending recovery failed')),
    )
    .finally(() => {
      if (attempts.get(identity) === attempt) {
        attempts.delete(identity)
      }
    })
  attempts.set(identity, attempt)
}
