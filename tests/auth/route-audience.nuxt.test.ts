import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useRouter } from '#app'
import { platformCoreNavigation } from '@eve-space/platform-module-contract/nuxt'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { resolveRouteAudience } from '../../app/utils/route-audience'

const corePages = platformCoreNavigation.filter(
  ({ placement, path }) => placement === 'dashboard' && !path.includes(':'),
)

const RouteAudienceProbe = defineComponent({
  render: () => h('div'),
  setup() {
    const routes = useRouter().getRoutes()
    const routeAudiences = corePages.map((page) => {
      const route = routes.find(({ path }) => path === page.path)
      return {
        actual: route ? resolveRouteAudience(page.path, route.meta.platformAudience) : null,
        expected: page.audience,
        path: page.path,
      }
    })
    return { routeAudiences }
  },
})

describe('core route audience contract', () => {
  it('matches routed page metadata to canonical navigation audiences', async () => {
    const wrapper = await mountSuspended(RouteAudienceProbe, { route: '/' })
    expect(wrapper.vm.routeAudiences).toStrictEqual(
      corePages.map(({ audience, path }) => ({ actual: audience, expected: audience, path })),
    )
    wrapper.unmount()
  })

  it('keeps the organization-review workspace authenticated without global navigation', async () => {
    const wrapper = await mountSuspended(
      defineComponent({
        setup() {
          const route = useRouter()
            .getRoutes()
            .find(({ path }) => path === '/organization/review')
          return () =>
            h(
              'span',
              route
                ? resolveRouteAudience('/organization/review', route.meta.platformAudience)
                : 'missing',
            )
        },
      }),
      { route: '/' },
    )
    expect(wrapper.text()).toBe('authenticated')
    expect(platformCoreNavigation.some(({ path }) => path === '/organization/review')).toBe(false)
    wrapper.unmount()
  })
})
