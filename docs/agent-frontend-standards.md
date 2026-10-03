# EVE Space Frontend Standards

### Vue

These rules compile the official Vue Style Guide's [Priority A](https://vuejs.org/style-guide/rules-essential.html), [Priority B](https://vuejs.org/style-guide/rules-strongly-recommended.html), and [Priority C](https://vuejs.org/style-guide/rules-recommended.html) guidance. Preserve a more specific repository convention where one is documented.

#### Essential

- Use multi-word component names except for the root `App` component.
- Define props with explicit TypeScript types; do not use untyped string-array prop declarations in committed code. Mark mandatory props as required and give optional props a type-checked default whenever the component has a meaningful fallback.
- In `<script setup>`, prefer type-based `defineProps<Props>()`. Use reactive destructure defaults when destructuring props, or `withDefaults(defineProps<Props>(), defaults)` when retaining the props object so defaults are checked and defaulted properties become non-optional.
- Wrap mutable array or object defaults in factory functions when using `withDefaults` or runtime prop declarations so each component instance receives its own value. Outside `<script setup>`, use `defineComponent()` for prop inference and `PropType` for complex runtime prop types.
- Give every `v-for` a stable, unique `:key` based on item identity rather than an index or a potentially duplicated destination/value.
- Never place `v-if` and `v-for` on the same element. Filter through a computed value or move the conditional to a wrapper.
- Scope component styles through `<style scoped>`, CSS modules, or distinctive component/feature classes. Layout and root application styles may be global; reusable UI library primitives should use the repository's class-based styling strategy.

#### Strongly Recommended

- Keep each Vue component in its own file.
- Name SFC files in PascalCase consistently.
- Prefix reusable visual primitives with the established `Ui` prefix and app-level shell primitives with `App`; do not introduce competing `Base` or `V` prefixes.
- Prefix a tightly coupled child component with its parent component's full name.
- Order component-name words from the highest-level concept to descriptive modifiers so related components group together.
- Self-close components with no content in SFC templates; do not self-close native non-void HTML elements.
- Use PascalCase component names in SFC templates and JavaScript/TypeScript.
- Prefer full words over uncommon abbreviations in component names.
- Declare prop names in camelCase and use kebab-case when binding them in templates.
- Put elements with multiple attributes on multiple lines, one attribute per line, relying on the repository formatter for the final layout.
- Keep template expressions simple. Move transformations, branching, or multi-step calculations into computed values or methods.
- Split complex computed state into focused, descriptively named computed values when that improves readability, testability, or reuse; do not fragment a simple expression merely to satisfy this rule.
- Quote every non-empty HTML attribute value.
- Use Vue directive shorthands consistently: `:`, `@`, and `#` rather than mixing shorthand and long-form directives.

#### Recommended

- In Options API components, order options consistently: identity/compiler, dependencies, composition, interface, `setup`, state/computed, watchers/lifecycle, methods, then rendering. In `<script setup>`, keep the analogous flow: macros and interface, injected/composable dependencies, local state/computed state, watchers/lifecycle, then handlers.
- Order template attributes consistently: definition, `v-for`, conditionals, render modifiers, global identity, `ref`/`:key`, `v-model`, other attributes, events, then content directives.
- Use blank lines to separate multi-line component options or logical `<script setup>` sections when it improves scanning; avoid mechanical spacing that fragments tightly related declarations.
- Keep SFC top-level blocks in the repository order: `<script>`, `<template>`, then `<style>`.

### Nuxt

These rules compile Nuxt 4's official best-practice guidance for [accessibility](https://nuxt.com/raw/docs/4.x/guide/best-practices/accessibility.md), [hydration](https://nuxt.com/raw/docs/4.x/guide/best-practices/hydration.md), [performance](https://nuxt.com/raw/docs/4.x/guide/best-practices/performance.md), and [plugins](https://nuxt.com/raw/docs/4.x/guide/best-practices/plugins.md).

#### Accessibility

- Prefer native HTML semantics over recreating them with ARIA roles. Use `<output>` for result or status messages instead of placing `role="status"` on a generic element; use ARIA only when no native element supplies the required semantics.
- Keep `NuxtRouteAnnouncer` mounted at the application root and give every route a distinct, meaningful document title so client-side navigation is announced.
- Use `NuxtAnnouncer`/`useAnnouncer` for important in-page status changes such as validation or asynchronous results; do not misuse route announcements for ordinary updates.
- Use `NuxtLink` for internal navigation so links retain native focus, keyboard, new-tab, and `aria-current` behavior. Mark public files or same-origin destinations outside Vue Router as `external`.
- Preserve a first-tab-stop skip link to the main content region. Keep the main target identifiable and programmatically focusable with `tabindex="-1"`; never introduce positive tabindex values.
- When changing focus after client navigation, do so after rendering and only for actual page changes. Do not steal focus for query/hash-only updates without a specific accessibility reason.
- Preserve Nuxt's default route scroll behavior unless the product requires an override. Any smooth scrolling or motion must respect `prefers-reduced-motion`.
- Treat semantic HTML, labels, form errors, keyboard access, visible focus, ARIA correctness, and sufficient contrast as acceptance requirements, not visual polish.

#### Hydration

- Treat every hydration mismatch as a defect. Do not suppress warnings or accept client re-rendering as a fix; mismatches can break interactivity, state, SEO, and layout stability.
- Never read browser-only APIs such as `window`, `document`, `localStorage`, or viewport state during SSR setup/rendering. Use universal state such as `useCookie`/`useState`, CSS media queries, or defer browser work to `onMounted`.
- Ensure SSR and initial client rendering consume the same deterministic data. Transfer SSR-safe fetch results through Nuxt payload-aware APIs or the repository's established query infrastructure rather than issuing duplicate server/client requests.
- Do not render `Math.random()`, current-time branches, locale-dependent values, or other nondeterministic output independently on server and client. Seed shared state, use `NuxtTime`, or render a stable fallback until mount.
- Prefer responsive CSS over client-only viewport conditionals. Use `ClientOnly` only when content genuinely cannot render on the server, and provide a stable fallback when layout or meaning would otherwise disappear.
- Initialize DOM-mutating or browser-dependent third-party libraries in client-only plugins or `onMounted`, after hydration; do not run side effects during component setup.

#### Performance

- Use `NuxtLink` for internal routes and rely on its smart prefetching. Change global or per-link prefetch behavior only from measured network or interaction evidence.
- Apply route rules deliberately: prerender stable public pages, use SWR/ISR only where cache semantics are correct, and disable SSR only for routes that cannot benefit from it. Never move protected data across an execution boundary to gain performance.
- Lazy-load components that are conditional, heavy, or below the fold. Consider delayed/lazy hydration for non-critical interactive components, but keep primary content and controls available without delay.
- For SSR-safe public data, prefer payload-aware `useFetch`/`useAsyncData` or the established query-prefetch infrastructure to avoid duplicate fetching. Protected queries must still obey this repository's explicit client/authentication/cookie-forwarding rules.
- Keep image dimensions explicit to prevent layout shift. Continue using `UiEveImage`/`useEveImages` for EVE assets; optimize other images with appropriate responsive formats, eager high-priority loading for measured LCP images, and lazy low-priority loading elsewhere.
- Keep fonts local or self-hosted where practical, preload only critical faces, and preserve fallback metrics to limit layout shift. Do not add external font requests without a measured need.
- Load third-party scripts only when needed and through an SSR-aware, privacy-conscious strategy. Delay non-critical analytics, embeds, and integrations so they do not degrade LCP or INP.
- Avoid unused dependencies, broad imports, and code included on every route without need. Use bundle analysis before large dependency additions and lazy-load or replace measured large blocks.
- Minimize reactive overhead only where profiling justifies it; consider `shallowRef`, `v-once`, or `v-memo` for large stable structures rather than applying them speculatively.
- Deliver critical content and controls first, then progressively enhance secondary presentation and features. Measure with production builds, Nuxt DevTools, Chrome Performance/Lighthouse, and field data where available.

#### Plugins

- Keep plugins few and cheap because plugin setup runs during application startup/hydration. Move feature-local behavior to composables or utilities whenever global injection or lifecycle hooks are unnecessary.
- Do not perform expensive computation, broad data fetching, or avoidable blocking I/O in plugin setup.
- Mark independent asynchronous plugins with `parallel: true`; leave ordering dependencies explicit rather than relying on incidental registration order.
- Use `.client`/`.server` plugin suffixes for environment-specific behavior and keep browser-only side effects out of universal plugins.
