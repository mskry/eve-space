import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import { getEsiResilienceLayer } from '../esi-resilience/layer.js'
import { createEsiTransport } from '../esi-resilience/request-transport.js'

export function getUniverseSolarSystem(systemId: number) {
  return getEsiResilienceLayer().getPublic({
    operation: 'universe-solar-system',
    inputs: { systemId },
    load: (revalidation) =>
      createUniverseClient({ fetch: createEsiTransport('universe-solar-system') })
        .withMetadata()
        .getSolarSystem(systemId, revalidation),
  })
}

export function getUniverseStation(stationId: number) {
  return getEsiResilienceLayer().getPublic({
    operation: 'universe-station',
    inputs: { stationId },
    load: (revalidation) =>
      createUniverseClient({ fetch: createEsiTransport('universe-station') })
        .withMetadata()
        .getStation(stationId, revalidation),
  })
}
