import {
  computed,
  inject,
  onScopeDispose,
  provide,
  ref,
  shallowRef,
  toValue,
  type InjectionKey,
  type MaybeRefOrGetter,
} from 'vue'

export interface UiConfirmDialogOptions {
  cancelLabel?: MaybeRefOrGetter<string>
  confirmLabel?: MaybeRefOrGetter<string>
  description: MaybeRefOrGetter<string>
  onClose?: () => void
  onConfirm: () => boolean | void | Promise<boolean | void>
  pending?: MaybeRefOrGetter<boolean>
  pendingLabel?: MaybeRefOrGetter<string>
  title: MaybeRefOrGetter<string>
  tone?: 'default' | 'danger'
}

interface ConfirmDialogController {
  closeConfirmDialog: (key?: number) => void
  openConfirmDialog: (options: UiConfirmDialogOptions) => number
}

const confirmDialogKey: InjectionKey<ConfirmDialogController> = Symbol('ui-confirm-dialog')

export function provideConfirmDialog() {
  const dialogOpen = ref(false)
  const dialogKey = ref(0)
  const actionPending = ref(false)
  const actionError = ref('')
  const current = shallowRef<UiConfirmDialogOptions>()
  const cancelLabel = computed(() => toValue(current.value?.cancelLabel ?? 'Cancel'))
  const confirmLabel = computed(() => toValue(current.value?.confirmLabel ?? 'Confirm'))
  const description = computed(() => toValue(current.value?.description ?? ''))
  const pending = computed(
    () => actionPending.value || Boolean(toValue(current.value?.pending ?? false)),
  )
  const pendingLabel = computed(() => toValue(current.value?.pendingLabel ?? 'Confirming...'))
  const title = computed(() => toValue(current.value?.title ?? 'Confirm action'))
  const tone = computed(() => current.value?.tone ?? 'default')

  function closeConfirmDialog(key?: number) {
    if (key !== undefined && dialogKey.value !== key) return
    if (!dialogOpen.value && !current.value) return
    dialogOpen.value = false
    current.value?.onClose?.()
    current.value = undefined
    actionPending.value = false
    actionError.value = ''
  }

  function openConfirmDialog(options: UiConfirmDialogOptions) {
    if (current.value) closeConfirmDialog()
    dialogKey.value += 1
    current.value = options
    actionError.value = ''
    actionPending.value = false
    dialogOpen.value = true
    return dialogKey.value
  }

  async function confirmDialog() {
    const options = current.value
    const key = dialogKey.value
    if (!options || pending.value) return
    actionPending.value = true
    actionError.value = ''
    try {
      const shouldClose = await options.onConfirm()
      if (shouldClose !== false) closeConfirmDialog(key)
    } catch (error) {
      if (dialogKey.value === key) {
        actionError.value =
          error instanceof Error ? error.message : 'The action could not be completed.'
      }
    } finally {
      if (dialogKey.value === key) actionPending.value = false
    }
  }

  const controller = { closeConfirmDialog, openConfirmDialog }
  provide(confirmDialogKey, controller)

  return {
    actionError,
    cancelLabel,
    confirmDialog,
    confirmLabel,
    controller,
    description,
    dialogOpen,
    pending,
    pendingLabel,
    title,
    tone,
  }
}

export function useConfirmDialog() {
  const controller = inject(confirmDialogKey)
  if (!controller) throw new Error('useConfirmDialog must be used under UiProvider.')
  const ownedDialogs = new Set<number>()
  let scopeActive = true

  onScopeDispose(() => {
    scopeActive = false
    for (const key of ownedDialogs) controller.closeConfirmDialog(key)
    ownedDialogs.clear()
  })

  return {
    closeConfirmDialog(key?: number) {
      const ownedKey = key ?? [...ownedDialogs].at(-1)
      if (ownedKey === undefined || !ownedDialogs.has(ownedKey)) return
      controller.closeConfirmDialog(ownedKey)
      ownedDialogs.delete(ownedKey)
    },
    openConfirmDialog(options: UiConfirmDialogOptions) {
      if (!scopeActive) return 0
      let key = 0
      key = controller.openConfirmDialog({
        ...options,
        onClose: () => {
          ownedDialogs.delete(key)
          options.onClose?.()
        },
      })
      ownedDialogs.add(key)
      return key
    },
  }
}
