export interface UiToastOptions {
  actionHref?: string
  actionLabel?: string
  description?: string
  duration?: number
  title: string
}

interface UiToastState {
  actionHref: string
  actionLabel: string
  description: string
  duration: number
  key: number
  open: boolean
  title: string
}

const defaultDuration = 5000

export function useToast() {
  const toast = useState<UiToastState>('ui-toast', () => ({
    actionHref: '',
    actionLabel: 'Open',
    description: '',
    duration: defaultDuration,
    key: 0,
    open: false,
    title: '',
  }))
  const toastOpen = computed({
    get: () => toast.value.open,
    set: (open: boolean) => {
      toast.value = { ...toast.value, open }
    },
  })

  function showToast(options: UiToastOptions) {
    const key = toast.value.key + 1
    toast.value = {
      actionHref: options.actionHref ?? '',
      actionLabel: options.actionLabel ?? 'Open',
      description: options.description ?? '',
      duration: options.duration ?? defaultDuration,
      key,
      open: true,
      title: options.title,
    }
    return key
  }

  function dismissToast(key?: number) {
    if (key !== undefined && toast.value.key !== key) return
    toastOpen.value = false
  }

  return { dismissToast, showToast, toast, toastOpen }
}
