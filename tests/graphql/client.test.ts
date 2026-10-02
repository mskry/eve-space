import { defineComponent, h } from 'vue'
import { disposePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { executeTypedGraphQL } from '../../app/graphql/graphql-client'
import { ExplorerMarketDocument } from '../../app/generated/graphql-operations'
import {
  applicationGraphQLQueryKey,
  marketGraphQLQuery,
  ownedAssetsGraphQLQuery,
  ownedCharactersGraphQLQuery,
} from '../../app/queries/graphql'
import { removeCharacterQueries } from '../../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { shouldPersistEsiQuery } from '../../app/query-persistence/envelope'
import {
  applyVerifiedQueryIdentity,
  awaitQueryPersistenceRestoration,
  invalidatePrivateQueryScope,
} from '../../app/query-persistence/runtime'
import { explorerMarketFixture } from '../support/graphql-fixtures'
import { queryServer } from '../support/query-server'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'

const session = {
  authenticated: true as const,
  account: { userId: 'owner', mainCharacter: { characterId: 7001, name: 'Test Pilot' } },
}

const admission = {
  userId: 'owner',
  characters: [
    { characterId: 7001, admissionRevision: 'revision' },
    { characterId: 7002, admissionRevision: 'revision' },
  ],
  organization: null,
}

const mountVerifiedGraphQLClient = async () => {
  const mounted = mountWithQueryPlugins(defineComponent({ setup: () => () => h('div') }))
  onTestFinished(() => {
    mounted.wrapper.unmount()
    disposePinia(mounted.pinia)
  })
  await awaitQueryPersistenceRestoration(mounted.queryCache)
  await applyVerifiedQueryIdentity(mounted.queryCache, session, async () => admission)
  const context = {
    baseUrl: 'http://localhost',
    queryCache: mounted.queryCache,
    ownerUserId: 'owner',
    characterId: '7001',
    admissionKey: 'revision',
    canRun: () => true,
  }
  return { ...mounted, context }
}

describe('generated application GraphQL client', () => {
  it('uses credentialed POST and preserves exact decimals and partial field errors', async () => {
    queryServer.use(
      http.post('http://localhost/api/graphql', async ({ request }) => {
        expect(request.credentials).toBe('include')
        expect(await request.json()).toMatchObject({ query: ExplorerMarketDocument.toString() })
        return HttpResponse.json({
          data: explorerMarketFixture,
          errors: [{ message: 'A source is unavailable.', path: ['market', 'profiles'] }],
        })
      }),
    )
    const { context, queryCache } = await mountVerifiedGraphQLClient()
    const options = marketGraphQLQuery({
      ...context,
      ownerUserId: null,
      characterId: undefined,
      admissionKey: null,
    })
    expect(options).toMatchObject({ enabled: false, retry: 0, gcTime: 0, staleTime: 0 })
    expect(options.key.slice(0, 2)).toEqual(['public', 'graphql'])
    expect(shouldPersistEsiQuery(queryCache.ensure(options))).toBe(false)
    const state = await queryCache.fetch(queryCache.ensure(options))
    expect(state.data?.data?.market?.referencePrices?.rows[0]?.averagePriceIsk).toBe(
      '123456789012345678.12345',
    )
    expect(state.data?.errors?.[0]?.message).toBe('A source is unavailable.')
  })

  it('preserves document errors and maps host errors without retry', async () => {
    const request = vi.fn(() =>
      HttpResponse.json({ errors: [{ message: 'Invalid query.' }] }, { status: 400 }),
    )
    queryServer.use(http.post('http://localhost/api/graphql', request))
    expect(
      (await executeTypedGraphQL('http://localhost', ExplorerMarketDocument, {})).errors,
    ).toEqual([{ message: 'Invalid query.' }])
    expect(request).toHaveBeenCalledOnce()
    queryServer.use(
      http.post('http://localhost/api/graphql', () =>
        HttpResponse.json({ message: 'Unavailable.' }, { status: 503 }),
      ),
    )
    await expect(
      executeTypedGraphQL('http://localhost', ExplorerMarketDocument, {}),
    ).rejects.toMatchObject({ status: 503 })
  })

  it('keeps identities distinct and typed options outside persistence and automatic execution', async () => {
    const mounted = mountWithQueryPlugins(defineComponent({ setup: () => () => h('div') }))
    const context = {
      baseUrl: 'http://localhost',
      queryCache: mounted.queryCache,
      ownerUserId: 'owner',
      characterId: '7001',
      admissionKey: 'revision',
      canRun: () => false,
    }
    const first = applicationGraphQLQueryKey(context, 'assets', { first: 25, after: null }, true)
    expect(applicationGraphQLQueryKey(context, 'assets', { after: null, first: 25 }, true)).toEqual(
      first,
    )
    for (const replacement of [
      { ownerUserId: 'new-owner' },
      { characterId: '7002' },
      { admissionKey: 'new-revision' },
    ]) {
      expect(
        applicationGraphQLQueryKey(
          { ...context, ...replacement },
          'assets',
          { first: 25, after: null },
          true,
        ),
      ).not.toEqual(first)
    }
    expect(
      applicationGraphQLQueryKey(context, 'assets', { first: 25, after: 'opaque-next' }, true),
    ).not.toEqual(first)
    const options = ownedAssetsGraphQLQuery(context, {
      characterId: '7001',
      first: 25,
      after: null,
    })
    expect(options).toMatchObject({ enabled: false, retry: 0 })
    const entry = mounted.queryCache.ensure(options)
    expect(shouldPersistEsiQuery(entry)).toBe(false)
    await expect(mounted.queryCache.fetch(entry)).rejects.toThrow('Verify the live session')
    mounted.wrapper.unmount()
  })

  it('passes cancellation to the transport without starting an aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      executeTypedGraphQL('http://localhost', ExplorerMarketDocument, {}, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each(['removal', 'invalidation', 'revision change'])(
    'clears owned GraphQL data on character %s and retains another character',
    async (transition) => {
      const { queryCache, context } = await mountVerifiedGraphQLClient()
      const assets = ownedAssetsGraphQLQuery(context, { characterId: '7001', first: 25 })
      const sibling = ownedAssetsGraphQLQuery(
        { ...context, characterId: '7002' },
        { characterId: '7002', first: 25 },
      )
      const selector = ownedCharactersGraphQLQuery(context)
      for (const options of [assets, sibling, selector]) {
        queryCache.ensure(options)
        queryCache.setQueryData(options.key, { data: {} })
      }
      expect(assets.key.slice(0, 3)).toEqual(PRIVATE_QUERY_KEYS.character(7001))

      if (transition === 'removal') {
        removeCharacterQueries(queryCache, 7001)
      } else if (transition === 'invalidation') {
        await invalidatePrivateQueryScope(queryCache, { kind: 'character', characterId: 7001 })
      } else {
        await applyVerifiedQueryIdentity(queryCache, session, async () => ({
          ...admission,
          characters: [
            { characterId: 7001, admissionRevision: 'new-revision' },
            admission.characters[1]!,
          ],
        }))
      }
      expect(queryCache.getQueryData(assets.key)).toBeUndefined()
      expect(queryCache.getQueryData(selector.key)).toBeUndefined()
      expect(queryCache.getQueryData(sibling.key)).toEqual({ data: {} })
    },
  )

  it('rejects unsafe or mismatched character scopes before issuing a request', async () => {
    const { context } = await mountVerifiedGraphQLClient()
    expect(() => ownedAssetsGraphQLQuery(context, { characterId: '7002', first: 25 })).toThrow(
      'match the admitted character',
    )
    for (const characterId of ['9007199254740993', '07001', '-1']) {
      expect(() =>
        ownedAssetsGraphQLQuery({ ...context, characterId }, { characterId, first: 25 }),
      ).toThrow('canonical, safe character ID')
    }
  })

  it.each(['assets', 'selector'])(
    'forwards HTTP 200 authentication denials from %s without losing the partial envelope',
    async (operation) => {
      const { context, queryCache } = await mountVerifiedGraphQLClient()
      const privateKey = PRIVATE_QUERY_KEYS.characterOverview(7002)
      queryCache.setQueryData(privateKey, { name: 'Retained private pilot' })
      const publicKey = ['public', 'graphql', 'retained']
      queryCache.setQueryData(publicKey, { name: 'Public pilot' })
      const envelope = {
        data: { ownedCharacter: { characterId: '7001', name: 'Test Pilot', assets: null } },
        errors: [
          { message: 'Reauthorize.', extensions: { code: 'EVE_REAUTH_REQUIRED', status: 403 } },
          { message: 'Log in.', extensions: { code: 'AUTH_REQUIRED', status: 401 } },
        ],
      }
      queryServer.use(http.post('http://localhost/api/graphql', () => HttpResponse.json(envelope)))
      const options =
        operation === 'assets'
          ? ownedAssetsGraphQLQuery(context, { characterId: '7001', first: 25 })
          : ownedCharactersGraphQLQuery({ ...context, characterId: undefined })

      expect(await options.query({ signal: new AbortController().signal })).toEqual(envelope)
      expect(queryCache.getQueryData(privateKey)).toBeUndefined()
      expect(queryCache.getQueryData(publicKey)).toEqual({ name: 'Public pilot' })
    },
  )

  it.each([
    { code: 'CHARACTER_AUTHORIZATION_CHANGED', cleared: true },
    { code: 'READ_AUTHORIZATION_CHANGED', cleared: true },
    { code: 'ESI_UNAVAILABLE', cleared: false },
    { code: 'ASSET_CURSOR_RESTART', cleared: false },
    { code: 'BAD_USER_INPUT', cleared: false },
  ])('handles $code without clearing an unrelated character', async ({ code, cleared }) => {
    const { context, queryCache } = await mountVerifiedGraphQLClient()
    const privateKey = PRIVATE_QUERY_KEYS.characterOverview(7001)
    const siblingKey = PRIVATE_QUERY_KEYS.characterOverview(7002)
    queryCache.setQueryData(privateKey, { name: 'Current pilot' })
    queryCache.setQueryData(siblingKey, { name: 'Other pilot' })
    queryServer.use(
      http.post('http://localhost/api/graphql', () =>
        HttpResponse.json({ errors: [{ message: code, extensions: { code } }] }),
      ),
    )

    const options = ownedAssetsGraphQLQuery(context, { characterId: '7001', first: 25 })
    await options.query({ signal: new AbortController().signal })
    expect(queryCache.getQueryData(privateKey) === undefined).toBe(cleared)
    expect(queryCache.getQueryData(siblingKey)).toEqual({ name: 'Other pilot' })
  })

  it('ignores field denials from a request canceled before its response is released', async () => {
    const { context, queryCache } = await mountVerifiedGraphQLClient()
    const controller = new AbortController()
    const privateKey = PRIVATE_QUERY_KEYS.characterOverview(7002)
    queryCache.setQueryData(privateKey, { name: 'Current owner data' })
    queryServer.use(
      http.post('http://localhost/api/graphql', () => {
        controller.abort()
        return HttpResponse.json({
          errors: [{ message: 'Log in.', extensions: { code: 'AUTH_REQUIRED' } }],
        })
      }),
    )
    const options = ownedAssetsGraphQLQuery(context, { characterId: '7001', first: 25 })
    await expect(options.query({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(queryCache.getQueryData(privateKey)).toEqual({ name: 'Current owner data' })
  })

  it('does not report an obsolete denial after the caller loses admission', async () => {
    const { context, queryCache } = await mountVerifiedGraphQLClient()
    let admitted = true
    const privateKey = PRIVATE_QUERY_KEYS.characterOverview(7002)
    queryCache.setQueryData(privateKey, { name: 'Current owner data' })
    queryServer.use(
      http.post('http://localhost/api/graphql', () => {
        admitted = false
        return HttpResponse.json({
          errors: [{ message: 'Log in.', extensions: { code: 'AUTH_REQUIRED' } }],
        })
      }),
    )
    const options = ownedAssetsGraphQLQuery(
      { ...context, canRun: () => admitted },
      { characterId: '7001', first: 25 },
    )
    await expect(options.query({ signal: new AbortController().signal })).rejects.toThrow(
      'Verify the live session',
    )
    expect(queryCache.getQueryData(privateKey)).toEqual({ name: 'Current owner data' })
  })
})
