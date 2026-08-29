import { hc, type InferRequestType, type InferResponseType } from 'hono/client'
import { describe, expectTypeOf, test } from 'vitest'
import type { AppType } from '../../src/index.js'

const client = hc<AppType>('http://localhost:8788')
const mail = client.api.me.characters[':characterId'].mail
type MailGetRequest = InferRequestType<(typeof mail)['$get']>
type SendMailRequest = InferRequestType<(typeof mail)['$post']>
type UpdateMailRequest = InferRequestType<(typeof mail)[':mailId']['$put']>
type SendMailResponse = InferResponseType<(typeof mail)['$post'], 201>
type CreateLabelResponse = InferResponseType<(typeof mail)['labels']['$post'], 201>
type UpdateMailResponse = InferResponseType<(typeof mail)[':mailId']['$put'], 204>
type ResolveRecipientsRequest = InferRequestType<(typeof mail)['recipients']['resolve']['$post']>
type SearchRecipientsRequest = InferRequestType<(typeof mail)['recipients']['search']['$get']>
type CspaRequest = InferRequestType<(typeof mail)['cspa']['$post']>

describe('mounted mail contract', () => {
  test('retains all methods and relevant inferred inputs and outcomes', () => {
    expectTypeOf(mail.$get).toBeFunction()
    expectTypeOf(mail.$post).toBeFunction()
    expectTypeOf(mail.labels.$get).toBeFunction()
    expectTypeOf(mail.labels.$post).toBeFunction()
    expectTypeOf(mail.labels[':labelId'].$delete).toBeFunction()
    expectTypeOf(mail.lists.$get).toBeFunction()
    expectTypeOf(mail.recipients.resolve.$post).toBeFunction()
    expectTypeOf(mail.recipients.search.$get).toBeFunction()
    expectTypeOf(mail.cspa.$post).toBeFunction()
    expectTypeOf(mail[':mailId'].$get).toBeFunction()
    expectTypeOf(mail[':mailId'].$put).toBeFunction()
    expectTypeOf(mail[':mailId'].$delete).toBeFunction()

    const query: MailGetRequest['query'] = { labels: ['1', '2'], lastMailId: '7001' }
    expectTypeOf(query).toMatchTypeOf<MailGetRequest['query']>()
    expectTypeOf<SendMailRequest['json']>().toMatchTypeOf<{
      recipients: Array<{
        id: number
        type: 'alliance' | 'character' | 'corporation' | 'mailing_list'
      }>
      subject: string
      body: string
      approvedCost?: number
    }>()
    expectTypeOf<UpdateMailRequest['json']>().toMatchTypeOf<{
      read?: boolean
      labels?: number[]
    }>()
    expectTypeOf<ResolveRecipientsRequest['json']>().toEqualTypeOf<{ names: string[] }>()
    expectTypeOf<SearchRecipientsRequest['query']>().toEqualTypeOf<{ search: string }>()
    expectTypeOf<CspaRequest['json']>().toEqualTypeOf<{ characterIds: number[] }>()
    expectTypeOf<SendMailResponse>().toEqualTypeOf<{
      characterId: number
      mailId: number
    }>()
    expectTypeOf<CreateLabelResponse>().toEqualTypeOf<{
      characterId: number
      labelId: number
    }>()
    expectTypeOf<UpdateMailResponse>().toEqualTypeOf<null>()
  })
})
