import { hostname } from 'node:os'
import { env } from '../env.js'

/**
 * This replica's heartbeat identity, so a stuck worker cannot be covered by a healthy sibling.
 * Defaults to the container hostname because `worker-health.js` runs as a separate process in the
 * same container and must resolve the same identity.
 */
export const workerId = env.WORKER_ID ?? hostname()
