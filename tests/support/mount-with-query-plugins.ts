import { PiniaColada, useQueryCache } from '@pinia/colada'
import { mount, type MountingOptions } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { Component } from 'vue'
import { coladaOptions } from '../../app/utils/colada-options'

export function mountWithQueryPlugins(component: Component, options: MountingOptions<never> = {}) {
  const pinia = createPinia()
  const wrapper = mount(component, {
    ...options,
    global: {
      ...options.global,
      plugins: [...(options.global?.plugins ?? []), pinia, [PiniaColada, coladaOptions]],
    },
  })

  return {
    pinia,
    queryCache: useQueryCache(pinia),
    wrapper,
  }
}
