import {
  awaitQueryPersistenceRestoration,
  signalNuxtHydrationFinished,
} from '../query-persistence/runtime'

export default defineNuxtPlugin({
  name: 'query-persistence-ready',
  dependsOn: ['Pinia Colada'],
  async setup(nuxtApp) {
    const queryCache = useQueryCache()
    await awaitQueryPersistenceRestoration(queryCache)
    const finishHydration = () => signalNuxtHydrationFinished(queryCache)
    if (nuxtApp.isHydrating) onNuxtReady(finishHydration)
    else finishHydration()
  },
})
