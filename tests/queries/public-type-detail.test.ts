import { describe, expect, it } from 'vitest'
import { PUBLIC_QUERY_KEYS } from '../../app/queries/query-keys'
import { QUERY_POLICY } from '../../app/queries/query-policy'
import { publicTypeDetailQuery } from '../../app/queries/universe'
import { createApiClient } from '../../app/utils/api-client'

describe('public type-detail query', () => {
  it('uses a hierarchical public key scoped only by type ID', () => {
    expect(PUBLIC_QUERY_KEYS.universeType(34)).toEqual(['public', 'universe', 'types', 34])
    expect(PUBLIC_QUERY_KEYS.universeType(34)).not.toEqual(PUBLIC_QUERY_KEYS.universeType(35))

    const apiClient = createApiClient('http://localhost:8788')
    expect(publicTypeDetailQuery({ apiClient, typeId: 34 }).key).toEqual(
      PUBLIC_QUERY_KEYS.universeType(34),
    )
  })

  it('uses the named static-detail freshness and bounded collection policy', () => {
    const options = publicTypeDetailQuery({
      apiClient: createApiClient('http://localhost:8788'),
      typeId: 34,
    })

    expect(options.staleTime).toBe(24 * 60 * 60_000)
    expect(options.gcTime).toBe(QUERY_POLICY.staticTypeDetail.gcTime)
  })
})
