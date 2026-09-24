import { createMainContentFocusManager } from '../utils/main-content-focus'

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const focusManager = createMainContentFocusManager(document, {
    currentPath: () => router.currentRoute.value.path,
  })

  router.beforeResolve((to, from) => {
    focusManager.recordNavigation(to.path, from.path, {
      applicationMounted: !nuxtApp.isHydrating,
      replacesMain: to.meta.layout !== from.meta.layout,
    })
  })
  router.afterEach((_to, _from, failure) => {
    if (failure) {
      focusManager.cancelNavigation()
    }
  })
  nuxtApp.hook('page:finish', () => {
    focusManager.focusFinishedPage(router.currentRoute.value.path)
  })
})
