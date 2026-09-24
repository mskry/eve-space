import type {
  UniverseRouteEntry,
  UniverseRouteRequest,
  UniverseRouteResult,
  UniverseTopologySnapshot,
} from './route-types.js'
import { getUniverseTopology } from './topology.js'

export async function calculateUniverseRoutes(
  request: UniverseRouteRequest,
): Promise<UniverseRouteResult> {
  if (request.policy.kind !== 'shortest') {
    throw new Error('Unsupported universe route policy')
  }
  const topology = await getUniverseTopology()
  return {
    originSystemId: request.originSystemId,
    policy: request.policy,
    routes: shortestRoutes(topology, request.originSystemId, request.destinationSystemIds),
    sdeBuildNumber: topology.revision.buildNumber,
  }
}

function shortestRoutes(
  topology: UniverseTopologySnapshot,
  originSystemId: number,
  destinationSystemIds: readonly number[],
): UniverseRouteEntry[] {
  const destinations = new Set(destinationSystemIds)
  const distances = new Map<number, number>()
  const origin = topology.systems.get(originSystemId)
  if (origin) {
    distances.set(originSystemId, 0)
    const queue = [originSystemId]
    for (let index = 0; index < queue.length && destinations.size > 0; index += 1) {
      const currentId = queue[index]!
      destinations.delete(currentId)
      const nextDistance = distances.get(currentId)! + 1
      for (const neighborId of topology.systems.get(currentId)!.neighbors) {
        if (distances.has(neighborId)) {
          continue
        }
        distances.set(neighborId, nextDistance)
        queue.push(neighborId)
      }
    }
  }

  return destinationSystemIds
    .map((destinationSystemId) => ({
      destinationSystemId,
      jumps: distances.get(destinationSystemId) ?? null,
    }))
    .toSorted(compareRouteDistance)
}

function compareRouteDistance(left: UniverseRouteEntry, right: UniverseRouteEntry) {
  if (left.jumps === null && right.jumps === null) {
    return left.destinationSystemId - right.destinationSystemId
  }
  if (left.jumps === null) {
    return 1
  }
  if (right.jumps === null) {
    return -1
  }
  return left.jumps - right.jumps || left.destinationSystemId - right.destinationSystemId
}
