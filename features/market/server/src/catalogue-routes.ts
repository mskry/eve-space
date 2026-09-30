import type {
  PlatformPublicRouteCapabilities,
  PlatformPublicRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono, type Context } from 'hono'
import { z } from 'zod'

const revisionParams = z.object({ revision: z.string().regex(/^[\w-]{1,192}$/) })
const groupParams = z.object({
  revision: z.string().regex(/^[\w-]{1,192}$/),
  groupId: z.coerce.number().int().positive().safe(),
})
const typeParams = z.object({
  revision: z.string().regex(/^[\w-]{1,192}$/),
  typeId: z.coerce.number().int().positive().safe(),
})
const pageQuery = z.object({
  cursor: z
    .string()
    .regex(/^t_[\da-z]{1,12}$/)
    .refine((cursor) => {
      const id = Number.parseInt(cursor.slice(2), 36)
      return Number.isSafeInteger(id) && id > 0
    }, 'Invalid market group cursor')
    .optional(),
})
const discoveryCache = 'public, max-age=30, must-revalidate'
const bodyCache = 'public, max-age=31536000, immutable'

type CatalogueCapabilities = PlatformPublicRouteCapabilities<readonly ['market-catalogue']>
type CatalogueResult = Awaited<ReturnType<CatalogueCapabilities['coreData']['marketCatalogue']>>

const revisionKey = ({ revision }: CatalogueResult) => {
  const ingestion = [...revision.ingestedAt]
    .map((character) => character.codePointAt(0)!.toString(16).padStart(2, '0'))
    .join('')
  return `${revision.buildNumber}-${revision.ingestVersion}-${ingestion}`
}

const matchesEtag = (context: Context, etag: string) =>
  context.req
    .header('If-None-Match')
    ?.split(',')
    .some((candidate) => candidate.trim() === etag) ?? false

export const catalogueRoutes = ({ coreData }: CatalogueCapabilities) =>
  new Hono<PlatformPublicRouteEnv>()
    .get('/revision', async (context) => {
      const result = await coreData.marketCatalogue({ kind: 'tree' }).catch(() => null)
      if (!result) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: 'MARKET_CATALOGUE_UNAVAILABLE' }, 503)
      }
      const key = revisionKey(result)
      const etag = `W/"${key}"`
      context.header('Cache-Control', discoveryCache)
      context.header('ETag', etag)
      if (matchesEtag(context, etag)) return context.body(null, 304)
      return context.json({ key, revision: result.revision }, 200)
    })
    .get('/body/:revision/tree', zValidator('param', revisionParams), async (context) => {
      const requested = context.req.valid('param').revision
      const result = await coreData.marketCatalogue({ kind: 'tree' }).catch(() => null)
      if (!result) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: 'MARKET_CATALOGUE_UNAVAILABLE' }, 503)
      }
      const key = revisionKey(result)
      if (requested !== key) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: 'MARKET_CATALOGUE_REVISION_MISSING' }, 404)
      }
      const etag = `W/"${key}-tree"`
      context.header('Cache-Control', bodyCache)
      context.header('ETag', etag)
      if (matchesEtag(context, etag)) return context.body(null, 304)
      return context.json(result, 200)
    })
    .get(
      '/body/:revision/groups/:groupId/types',
      zValidator('param', groupParams),
      zValidator('query', pageQuery),
      async (context) => {
        const { revision, groupId } = context.req.valid('param')
        const { cursor } = context.req.valid('query')
        const result = await coreData
          .marketCatalogue({ kind: 'group-types', groupId, cursor })
          .catch(() => null)
        if (!result) {
          context.header('Cache-Control', 'no-store')
          return context.json({ code: 'MARKET_CATALOGUE_UNAVAILABLE' }, 503)
        }
        const key = revisionKey(result)
        if (revision !== key) {
          context.header('Cache-Control', 'no-store')
          return context.json({ code: 'MARKET_CATALOGUE_REVISION_MISSING' }, 404)
        }
        const etag = `W/"${key}-group-${groupId}-${cursor ?? 'first'}"`
        context.header('Cache-Control', bodyCache)
        context.header('ETag', etag)
        if (matchesEtag(context, etag)) return context.body(null, 304)
        return context.json(result, 200)
      },
    )
    .get('/body/:revision/search-index', zValidator('param', revisionParams), async (context) => {
      const requested = context.req.valid('param').revision
      const result = await coreData.marketCatalogue({ kind: 'search-index' }).catch(() => null)
      if (!result) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: 'MARKET_CATALOGUE_UNAVAILABLE' }, 503)
      }
      const key = revisionKey(result)
      if (requested !== key) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: 'MARKET_CATALOGUE_REVISION_MISSING' }, 404)
      }
      const etag = `W/"${key}-search-index"`
      context.header('Cache-Control', bodyCache)
      context.header('ETag', etag)
      if (matchesEtag(context, etag)) return context.body(null, 304)
      return context.json(result, 200)
    })
    .get('/body/:revision/types/:typeId', zValidator('param', typeParams), async (context) => {
      const { revision, typeId } = context.req.valid('param')
      const result = await coreData
        .marketCatalogue({ kind: 'type-by-id', typeId })
        .catch(() => null)
      if (!result) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: 'MARKET_CATALOGUE_UNAVAILABLE' }, 503)
      }
      if (revision !== revisionKey(result)) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: 'MARKET_CATALOGUE_REVISION_MISSING' }, 404)
      }
      if (result.kind !== 'type-by-id' || !result.item) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: 'MARKET_TYPE_UNAVAILABLE' }, 404)
      }
      const etag = `W/"${revision}-type-${typeId}"`
      context.header('Cache-Control', bodyCache)
      context.header('ETag', etag)
      if (matchesEtag(context, etag)) return context.body(null, 304)
      return context.json(result, 200)
    })
