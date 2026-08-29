import { onUnmounted, watch, nextTick, type Ref } from 'vue'
import {
  applySearchHighlight,
  createSearchHighlight,
  deleteSearchHighlight,
  supportsCustomHighlight,
} from '../utils/custom-highlight'

export interface UseCustomHighlightOptions {
  highlightName: string
  term: Ref<string>
  selector: string | (() => NodeListOf<Element> | Element[] | null)
  container?: Ref<HTMLElement | null> | (() => HTMLElement | null)
  className?: string
}

export function useCustomHighlight(options: UseCustomHighlightOptions) {
  const { highlightName, term, selector, container } = options

  if (!supportsCustomHighlight()) {
    return { supported: false as const, update: () => {}, clear: () => {} }
  }

  const highlight = createSearchHighlight(highlightName)!

  onUnmounted(() => {
    deleteSearchHighlight(highlightName)
  })

  async function update() {
    const rawTerm = term.value.trim()
    if (!rawTerm) {
      highlight.clear()
      return
    }
    await nextTick()
    let roots: Element[]
    if (typeof selector === 'function') {
      roots = Array.from(selector() ?? [])
    } else {
      const root = typeof container === 'function' ? container() : (container?.value ?? document)
      roots = Array.from(root?.querySelectorAll(selector) ?? [])
    }
    applySearchHighlight(highlight, roots, rawTerm)
  }

  watch(term, update, { flush: 'post' })

  // Also re-run when the DOM mutates (filtered groups enter/leave via TransitionGroup)
  let observer: MutationObserver | null = null
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => void update())
    const target =
      typeof container === 'function'
        ? container()
        : ((container as Ref<HTMLElement | null> | undefined)?.value ?? document.body)
    if (target) observer.observe(target, { childList: true, subtree: true })
    onUnmounted(() => observer?.disconnect())
  }

  return { supported: true as const, update, clear: () => highlight.clear() }
}
