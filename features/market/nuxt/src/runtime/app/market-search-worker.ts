import { FuseWorker } from 'fuse.js/worker'
import workerUrl from 'fuse.js/worker-script?url'
import type { MarketType } from './market-catalogue-types'

export const createMarketSearchWorker = (items: readonly MarketType[], numWorkers: number) =>
  new FuseWorker(
    items,
    {
      keys: ['name'],
      threshold: 0.36,
      ignoreLocation: true,
      includeScore: true,
    },
    { numWorkers, workerUrl },
  )
