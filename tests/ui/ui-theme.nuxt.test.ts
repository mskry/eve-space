import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import UiThemeSwitcher from '../../layers/ui/app/components/ui/UiThemeSwitcher.vue'
import { useTheme } from '../../layers/ui/app/composables/useTheme'

const ThemeHost = defineComponent({
  props: {
    initialTheme: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const preference = useCookie<string>('eve-space-theme')
    preference.value = props.initialTheme
    const { setTheme, theme, themes } = useTheme()

    return () =>
      h(
        'button',
        {
          'data-labels': themes.map((option) => option.label).join(','),
          'data-options': themes.map((option) => option.value).join(','),
          'data-theme': theme.value,
          onClick: () => setTheme('caldari'),
          onContextmenu: () => setTheme('invalid'),
        },
        theme.value,
      )
  },
})

afterEach(() => {
  document.cookie = 'eve-space-theme=; Max-Age=0; path=/'
  document.body.replaceChildren()
})

describe('UI themes', () => {
  it('maps the legacy void preference to Gallente and persists new selections', async () => {
    const wrapper = await mountSuspended(ThemeHost, {
      props: { initialTheme: 'void' },
      route: false,
    })

    expect(wrapper.get('button').attributes('data-theme')).toBe('gallente')
    expect(wrapper.get('button').attributes('data-options')).toBe(
      'amarr,gallente,caldari,high-sec,minmatar',
    )
    expect(wrapper.get('button').attributes('data-labels')).toBe(
      'Amarr Gold,Gallente Green,Caldari Steel,CONCORD Daylight,Minmatar Rust',
    )

    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').attributes('data-theme')).toBe('caldari')
    expect(document.cookie).toContain('eve-space-theme=caldari')

    await wrapper.get('button').trigger('contextmenu')
    expect(wrapper.get('button').attributes('data-theme')).toBe('caldari')
  })

  it('falls back to Gallente for an unknown stored preference', async () => {
    const wrapper = await mountSuspended(ThemeHost, {
      props: { initialTheme: 'unknown' },
      route: false,
    })

    expect(wrapper.get('button').attributes('data-theme')).toBe('gallente')
  })

  it('labels the theme options without a visible menu heading', async () => {
    const wrapper = await mountSuspended(UiThemeSwitcher, {
      attachTo: document.body,
      route: false,
    })

    await wrapper.get('.ui-theme-trigger').trigger('click')
    await nextTick()

    expect(document.querySelector('[aria-label="Interface theme"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('INTERFACE THEME')
  })
})
