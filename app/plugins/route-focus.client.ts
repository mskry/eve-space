import { createMainContentFocusManager } from '../utils/main-content-focus'

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const focusManager = createMainContentFocusManager(document)
  let applicationMounted = false

  nuxtApp.hook('app:mounted', () => {
    applicationMounted = true
  })
  router.afterEach((to, from, failure) => {
    focusManager.recordNavigation(to.path, from.path, applicationMounted && !failure)
  })
  nuxtApp.hook('page:finish', () => {
    focusManager.focusFinishedPage(router.currentRoute.value.path)
  })
})
