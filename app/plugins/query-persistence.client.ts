import {
  awaitQueryPersistenceRestoration,
  signalNuxtHydrationFinished,
} from '../query-persistence/runtime'

export default defineNuxtPlugin({
  dependsOn: ['Pinia Colada'],
  name: 'query-persistence-ready',
  async setup(nuxtApp) {
    const queryCache = useQueryCache()
    await awaitQueryPersistenceRestoration(queryCache)
    const finishHydration = () => signalNuxtHydrationFinished(queryCache)
    if (nuxtApp.isHydrating) {
      onNuxtReady(finishHydration)
    } else {
      finishHydration()
    }
  },
})
