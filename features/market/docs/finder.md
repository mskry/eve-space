# Market finder and browse interaction

The public `/market` page pairs a Browse/Quickbar rail with item details, order books, and price history. The module is enabled by default and can be disabled in module settings. Static SDE data does not imply current prices or a collected market.

## Browse and search

- SSR transfers the current SDE revision and complete group tree through Pinia Colada and the Hono client; hydration reuses that cache. Shared Reka tree primitives provide selection, expansion, and keyboard navigation.
- Groups use SDE names and hierarchy, with English-name sorting before the 100-subgroup window. Expanding a group loads only its directly assigned types in revision/group/cursor-keyed pages of 100. Scrolling appends pages; collapsing stops observation and preserves cached pages.
- Search replaces the tree at four non-space characters with up to 20 results from a lazily loaded, revision-keyed index. Shorter input restores Browse; Ctrl/Cmd+K focuses search. Once loaded, the index serves keystrokes without HTTP requests.
- Market-owned workers rank exact ID/name, prefix, substring, multi-token, then bounded fuzzy matches, with deterministic name/ID ties. Query-sequence and revision guards discard stale replies. Revision changes clear old group-page bindings and warm the replacement index; worker failure shows unavailable rather than searching the corpus on the main thread.
- Selection persists in the route's `typeId`. Category icons are bundled by SDE icon ID with a folder fallback; type images use `useEveImages`. The rail stacks above details on narrow screens.

## Quickbar

Quickbar supports pinning, nested folders, inline rename, moves, reordering, deletion that promotes contents, confirmed clearing, and EVE Quickbar text import/export through the clipboard. Duplicate or ambiguous imported type names are rejected. Its public index loads only when Quickbar opens; missing IDs remain removable after catalogue changes.

Validated state lives in `eve-space-market-quickbar-v1` localStorage, independently of sessions and query persistence. Limits are 100 distinct types, 50 folders, eight nested levels, and 20 KB of serialized input. Legacy flat arrays and trees without ordering metadata remain readable; mixed item/folder order survives reload and clipboard round-trips.

Shared `UiSortableTreeRoot`/`UiSortableTreeItem` primitives own accessible tree and client-only drag behavior; Market owns move validation and serialization. Dragging supports insertion, nesting, outdenting, delayed folder expansion, and edge scrolling. Alt+Up/Down reorders, Alt+Right nests in the previous folder, and Alt+Left moves after the parent. Moves preserve focus and announce destinations; cycles and excessive depth are rejected. An inline move list provides a keyboard/mobile alternative.

## Item details and order books

- The header shows the type image, category path, name, enabled market profiles, and pin action. PLEX (`44992`) uses only Global PLEX Market and omits the selector; regional links cannot request regional PLEX data. Missing global configuration shows unavailable.
- Opening `/market` without `typeId` restores the last resolved item after mount from `eve-space-market-last-item-v1`; explicit links win. Storage holds only a validated positive safe-integer type ID and is never read during SSR or initial hydration.
- Summary values show best sell/buy, spread, and listed units from the first page, with “+” when more exist. Compact prices retain exact ISK in accessible labels and titles.
- Sell/buy tables sort by exact decimal price, then issued time and order ID. Secondary sorting applies only to the loaded window. Scroll edges load adjacent 100-row keyset pages, with at most 100 rows mounted.
- Rows show relative price, cumulative quantity in default first-page order, security status, station, buy range/minimum-volume tags, and expiry. Prices copy exactly; lowball buys at or below half the best buy are dimmed with an accessible explanation. Expiry uses fixed UTC during SSR. Prices describe individual orders, not quantity-aware quotes.

## Price history

History is keyed by profile revision and type, with its own `validatedAt`. Opening regional history records demand; accepted but uncollected history polls every four seconds for up to 90 seconds, then offers Check again. Profile demand limits (256 distinct types) and other failures have distinct messages. Watched-types profiles never send demand.

Daily Average is the source average, not a median. Five-/twenty-day moving averages and the twenty-day Donchian band require consecutive valid days; gaps break windows and are never interpolated. The lazy Canvas chart supports range selection, price zoom/pan, separately scaled volume, and exact-value pointer/keyboard inspection. It redraws only on changes. One valid day renders as text; none shows no history.
