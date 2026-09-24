export const MAIN_CONTENT_ID = 'main-content'

export function focusMainContent(document: Document) {
  document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true })
}

interface MainContentFocusDependencies {
  readonly cancelScheduled?: (handle: unknown) => void
  readonly createObserver?: (
    callback: () => void,
  ) => Pick<MutationObserver, 'disconnect' | 'observe'>
  readonly currentPath?: () => string
  readonly schedule?: (callback: () => void, delay: number) => unknown
}

export function createMainContentFocusManager(
  document: Document,
  dependencies: MainContentFocusDependencies = {},
) {
  let pendingPath: string | undefined
  let replacedMain: HTMLElement | undefined
  let observer: Pick<MutationObserver, 'disconnect' | 'observe'> | undefined
  let scheduled: unknown
  const schedule = dependencies.schedule ?? ((callback, delay) => setTimeout(callback, delay))
  const cancelScheduled =
    dependencies.cancelScheduled ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const currentPath = dependencies.currentPath ?? (() => pendingPath ?? '')
  const createObserver =
    dependencies.createObserver ?? ((callback) => new MutationObserver(callback))

  return {
    cancelNavigation,
    focusFinishedPage(finishedPath: string) {
      if (pendingPath !== finishedPath) {
        cancelNavigation()
        return
      }
      if (replacedMain) {
        waitForReplacement(finishedPath, replacedMain)
        return
      }
      scheduled = schedule(() => focusCurrentMain(finishedPath), 0)
    },
    recordNavigation(
      toPath: string,
      fromPath: string,
      options: { readonly applicationMounted: boolean; readonly replacesMain: boolean },
    ) {
      stopWaiting()
      pendingPath = options.applicationMounted && toPath !== fromPath ? toPath : undefined
      replacedMain =
        pendingPath && options.replacesMain
          ? (document.getElementById(MAIN_CONTENT_ID) ?? undefined)
          : undefined
    },
  }

  function waitForReplacement(completedPath: string, previousMain: HTMLElement) {
    observer = createObserver(() => focusReplacement())
    observer.observe(document.body, { childList: true, subtree: true })
    scheduled = schedule(cancelNavigation, 5000)
    focusReplacement()

    function focusReplacement() {
      if (currentPath() !== completedPath) {
        cancelNavigation()
        return
      }
      const main = document.getElementById(MAIN_CONTENT_ID)
      if (!main || main === previousMain) {
        return
      }
      focusCurrentMain(completedPath)
    }
  }

  function focusCurrentMain(completedPath: string) {
    if (pendingPath !== completedPath || currentPath() !== completedPath) {
      cancelNavigation()
      return
    }
    stopWaiting()
    pendingPath = undefined
    replacedMain = undefined
    focusMainContent(document)
  }

  function cancelNavigation() {
    stopWaiting()
    pendingPath = undefined
    replacedMain = undefined
  }

  function stopWaiting() {
    observer?.disconnect()
    observer = undefined
    if (scheduled !== undefined) {
      cancelScheduled(scheduled)
    }
    scheduled = undefined
  }
}
