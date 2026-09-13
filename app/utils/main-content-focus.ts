export const MAIN_CONTENT_ID = 'main-content'

export function focusMainContent(document: Document) {
  document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true })
}

export function createMainContentFocusManager(document: Document) {
  let pendingPath: string | undefined

  return {
    recordNavigation(toPath: string, fromPath: string, applicationMounted: boolean) {
      pendingPath = applicationMounted && toPath !== fromPath ? toPath : undefined
    },
    focusFinishedPage(currentPath: string) {
      const completedPath = pendingPath
      pendingPath = undefined
      if (completedPath !== currentPath) return

      focusMainContent(document)
    },
  }
}
