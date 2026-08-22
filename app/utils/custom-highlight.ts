// Pure Custom Highlight API helpers — no Vue dependency.
// Use directly or via app/composables/useCustomHighlight.ts wrapper.

export function supportsCustomHighlight(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

function normalizeBase(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function findRangesForElement(element: Element, term: string): Range[] {
  if (!term) return []
  const termNorm = normalizeBase(term.trim())
  if (!termNorm) return []
  const ranges: Range[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node: Text | null = walker.nextNode() as Text | null
  while (node) {
    const text = node.textContent ?? ''
    const textNorm = normalizeBase(text)
    let from = 0
    while (from < textNorm.length) {
      const idx = textNorm.indexOf(termNorm, from)
      if (idx === -1) break
      const range = new Range()
      try {
        range.setStart(node, Math.min(idx, node.length))
        range.setEnd(node, Math.min(idx + term.length, node.length))
        ranges.push(range)
      } catch {
        // e.g. term extends past text node — skip
      }
      from = idx + termNorm.length
    }
    node = walker.nextNode() as Text | null
  }
  return ranges
}

export function createSearchHighlight(name: string): Highlight | null {
  if (!supportsCustomHighlight()) return null
  const highlight = new Highlight()
  CSS.highlights.set(name, highlight)
  return highlight
}

export function clearSearchHighlight(name: string, highlight?: Highlight | null) {
  if (!supportsCustomHighlight()) return
  if (highlight) highlight.clear()
  else CSS.highlights.delete(name)
}

export function deleteSearchHighlight(name: string) {
  if (!supportsCustomHighlight()) return
  CSS.highlights.delete(name)
}

export function applySearchHighlight(
  highlight: Highlight,
  elements: Iterable<Element>,
  term: string,
) {
  highlight.clear()
  const raw = term.trim()
  if (!raw) return
  const tokens = raw.split(/\s+/).filter(Boolean)
  for (const el of elements) {
    for (const token of tokens) {
      for (const range of findRangesForElement(el, token)) {
        highlight.add(range)
      }
    }
  }
}

export function highlightSelector(
  highlight: Highlight,
  selector: string,
  term: string,
  root: ParentNode = document,
) {
  const elements = root.querySelectorAll(selector)
  applySearchHighlight(highlight, elements, term)
}
