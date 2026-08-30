import { useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mailLabelsQuery } from '../../app/queries/mail'
import { canRunProtectedQuery } from '../../app/queries/query-cache'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'
import {
  mailUnreadBadgeValue,
  resolveMailUnreadBadge,
  resolveMailUnreadCount,
} from '../../app/utils/mail-unread-badge'

describe('mail unread badge derivation', () => {
  it('reads the count only from labels matching the requested character', () => {
    expect(resolveMailUnreadCount(7, { characterId: 7, totalUnreadCount: 4 })).toBe(4)
    expect(resolveMailUnreadCount(7, { characterId: 8, totalUnreadCount: 4 })).toBeUndefined()
    expect(
      resolveMailUnreadCount(undefined, { characterId: 7, totalUnreadCount: 4 }),
    ).toBeUndefined()
    expect(resolveMailUnreadCount(7, undefined)).toBeUndefined()
    expect(resolveMailUnreadCount(7, { characterId: 7, totalUnreadCount: null })).toBeUndefined()
  })

  it('builds a badge only for a positive count on a known character', () => {
    expect(resolveMailUnreadBadge(7, 4)).toEqual({ count: 4, label: '4 unread mails' })
    expect(resolveMailUnreadBadge(7, 1)).toEqual({ count: 1, label: '1 unread mail' })
    expect(resolveMailUnreadBadge(7, 247)).toEqual({ count: 247, label: '247 unread mails' })
    expect(resolveMailUnreadBadge(7, 0)).toBeUndefined()
    expect(resolveMailUnreadBadge(7, undefined)).toBeUndefined()
    expect(resolveMailUnreadBadge(undefined, 4)).toBeUndefined()
  })

  it('caps the visible value at 99+', () => {
    expect(mailUnreadBadgeValue(1)).toBe('1')
    expect(mailUnreadBadgeValue(99)).toBe('99')
    expect(mailUnreadBadgeValue(100)).toBe('99+')
    expect(mailUnreadBadgeValue(247)).toBe('99+')
  })
})

describe('mail unread badge retrieval', () => {
  const apiClient = createApiClient('http://localhost')
  const characterId = 7

  function badgeConsumer() {
    return defineComponent({
      setup() {
        const { data } = useQuery(() => ({
          ...mailLabelsQuery({ apiClient, characterId }),
          enabled: canRunProtectedQuery(true, true, characterId),
        }))
        return () => h('span', String(resolveMailUnreadCount(characterId, data.value) ?? 'none'))
      },
    })
  }

  it('shares one labels request between the shell badge and the mailbox', async () => {
    const labelRequests = vi.fn()
    const headerRequests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail/labels', () => {
        labelRequests()
        return HttpResponse.json(labelsResponse(5))
      }),
      http.get('http://localhost/api/me/characters/7/mail', () => {
        headerRequests()
        return HttpResponse.json({ characterId, messages: [], nextLastMailId: null })
      }),
    )
    const Consumer = badgeConsumer()
    const Root = defineComponent({ setup: () => () => h('div', [h(Consumer), h(Consumer)]) })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(labelRequests).toHaveBeenCalledTimes(1)
    expect(headerRequests).not.toHaveBeenCalled()
    expect(wrapper.text()).toBe('55')
    wrapper.unmount()
  })

  it('does not refetch on a timer while the shell stays mounted', async () => {
    vi.useFakeTimers()
    const labelRequests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail/labels', () => {
        labelRequests()
        return HttpResponse.json(labelsResponse(5))
      }),
    )
    const { wrapper } = mountWithQueryPlugins(badgeConsumer())
    await flushPromises()
    expect(labelRequests).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await flushPromises()

    expect(labelRequests).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    vi.useRealTimers()
  })

  function labelsResponse(totalUnreadCount: number) {
    return {
      characterId,
      labels: [{ color: '#ffffff', labelId: 1, name: 'Inbox', unreadCount: totalUnreadCount }],
      totalUnreadCount,
    }
  }
})
