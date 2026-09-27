import { useQueryCache } from '@pinia/colada'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import { computed, ref, watch } from 'vue'

export const useMemberAuditManagementAction = (
  props: PlatformReviewerPanelProps,
  refresh: () => Promise<void>,
  clearForm: () => void,
) => {
  const queryCache = useQueryCache()
  const pending = ref(false)
  const message = ref('')
  let revision = 0
  const authorized = computed(
    () =>
      props.queryAccess.authenticated &&
      props.queryAccess.authorized &&
      props.queryAccess.moduleEnabled,
  )
  const identity = computed(() =>
    JSON.stringify([
      props.organizationVersion,
      props.target,
      props.sectionId,
      props.queryAccess.authenticated,
      props.queryAccess.authorized,
      props.queryAccess.moduleEnabled,
    ]),
  )

  watch(
    identity,
    () => {
      revision += 1
      pending.value = false
      message.value = ''
      clearForm()
    },
    { flush: 'sync' },
  )

  const run = async (request: () => Promise<void>, success: string, failure: string) => {
    if (pending.value || !authorized.value) return
    pending.value = true
    message.value = ''
    const started = revision
    try {
      await request()
      if (started !== revision || !authorized.value) return
      clearForm()
      message.value = success
      try {
        await Promise.all([
          refresh(),
          queryCache.invalidateQueries({
            key: ['private', 'organization', 'reviewer', props.organizationVersion],
          }),
        ])
      } catch {
        if (started === revision)
          message.value = `${success} Refresh review data to see the latest state.`
      }
    } catch (error) {
      if (started === revision) message.value = error instanceof Error ? error.message : failure
    } finally {
      if (started === revision) pending.value = false
    }
  }

  return { authorized, message, pending, run }
}
