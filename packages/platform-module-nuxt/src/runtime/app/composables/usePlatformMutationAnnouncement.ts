import { useAnnouncer } from '#imports'

export function usePlatformMutationAnnouncement() {
  const announcer = useAnnouncer()

  return {
    announceError(message: string) {
      announcer.assertive(message)
    },
    announceSuccess(message: string) {
      announcer.polite(message)
    },
  }
}
