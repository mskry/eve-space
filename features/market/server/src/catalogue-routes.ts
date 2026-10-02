import type {
  PlatformPublicRouteCapabilities,
  PlatformPublicRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { readMarketCatalogue } from './catalogue-reads.js'
import { marketCatalogueCursor } from './read-input.js'

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
  cursor: z.optional(marketCatalogueCursor),
})
const discoveryCache = 'public, max-age=30, must-revalidate'
const bodyCache = 'public, max-age=31536000, immutable'

type CatalogueCapabilities = PlatformPublicRouteCapabilities<readonly ['market-catalogue']>
const matchesEtag = (context: Context, etag: string) =>
  context.req
    .header('If-None-Match')
    ?.split(',')
    .some((candidate) => candidate.trim() === etag) ?? false

export const catalogueRoutes = ({ coreData }: CatalogueCapabilities) =>
  new Hono<PlatformPublicRouteEnv>()
    .get('/revision', async (context) => {
      const outcome = await readMarketCatalogue(coreData, { kind: 'tree' })
      if (!outcome.ok) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: outcome.code }, outcome.status)
      }
      const { value: result, key } = outcome
      const etag = `W/"${key}"`
      context.header('Cache-Control', discoveryCache)
      context.header('ETag', etag)
      if (matchesEtag(context, etag)) return context.body(null, 304)
      return context.json({ key, revision: result.revision }, 200)
    })
    .get('/body/:revision/tree', zValidator('param', revisionParams), async (context) => {
      const requested = context.req.valid('param').revision
      const outcome = await readMarketCatalogue(coreData, { kind: 'tree' }, requested)
      if (!outcome.ok) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: outcome.code }, outcome.status)
      }
      const { value: result, key } = outcome
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
        const outcome = await readMarketCatalogue(
          coreData,
          { kind: 'group-types', groupId, cursor },
          revision,
        )
        if (!outcome.ok) {
          context.header('Cache-Control', 'no-store')
          return context.json({ code: outcome.code }, outcome.status)
        }
        const { value: result, key } = outcome
        const etag = `W/"${key}-group-${groupId}-${cursor ?? 'first'}"`
        context.header('Cache-Control', bodyCache)
        context.header('ETag', etag)
        if (matchesEtag(context, etag)) return context.body(null, 304)
        return context.json(result, 200)
      },
    )
    .get('/body/:revision/search-index', zValidator('param', revisionParams), async (context) => {
      const requested = context.req.valid('param').revision
      const outcome = await readMarketCatalogue(coreData, { kind: 'search-index' }, requested)
      if (!outcome.ok) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: outcome.code }, outcome.status)
      }
      const { value: result, key } = outcome
      const etag = `W/"${key}-search-index"`
      context.header('Cache-Control', bodyCache)
      context.header('ETag', etag)
      if (matchesEtag(context, etag)) return context.body(null, 304)
      return context.json(result, 200)
    })
    .get('/body/:revision/types/:typeId', zValidator('param', typeParams), async (context) => {
      const { revision, typeId } = context.req.valid('param')
      const outcome = await readMarketCatalogue(coreData, { kind: 'type-by-id', typeId }, revision)
      if (!outcome.ok) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: outcome.code }, outcome.status)
      }
      const { value: result } = outcome
      const etag = `W/"${revision}-type-${typeId}"`
      context.header('Cache-Control', bodyCache)
      context.header('ETag', etag)
      if (matchesEtag(context, etag)) return context.body(null, 304)
      return context.json(result, 200)
    })
