import { mountSuspended } from '@nuxt/test-utils/runtime'
import { expect, test } from 'vitest'
import ApiExplorer from '../../app/pages/api-explorer.vue'

test('links to the standard GraphiQL endpoint', async () => {
  const wrapper = await mountSuspended(ApiExplorer)
  expect(wrapper.get('h1').text()).toBe('API Explorer')
  const link = wrapper.get('a')
  expect(link.text()).toBe('Open GraphiQL')
  expect(link.attributes('href')).toBe('http://localhost:8788/api/graphql')
  wrapper.unmount()
})
