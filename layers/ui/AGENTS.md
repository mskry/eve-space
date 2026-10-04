<!-- bmad:context -->
<!-- Verified 2026-10-03 against 35bf357129965cbf18751d290bc0b29f1a6c5fe7. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## UI layer

The UI layer owns reusable visual primitives and their accessible interaction behavior. The root application and installed features consume these primitives. Shared frontend standards live in `docs/agent-frontend-standards.md`.

## Where things are

- Primitives and their Reka adapters: `layers/ui/app/components/ui/`.
- Theme values and component styling: `layers/ui/app/assets/css/tokens.css` and `layers/ui/app/assets/css/components.css`.
- Theme application: `layers/ui/app/plugins/theme.ts`; EVE images: `layers/ui/app/composables/useEveImages.ts`.

## Running and verifying

- This layer has no separate workspace package or package test runner. Select relevant pure or Nuxt/UI tests using the configurations in `docs/agent-verification.md`.
- For drawer/modal, menu, selection, or focus behavior changes, verify the affected interaction and keyboard/focus behavior; do not substitute unrelated API or integration suites.

## Conventions that differ from defaults

- Apply the root UI/app ownership, Reka-wrapper, semantic-token, runtime-theme, and EVE-image rules to layer changes and consumers.
- Keep product-shell state with the application, including navigation expansion and its persistence; the drawer primitive supplies interaction behavior.
- Use the established `Ui` component prefix and the layer's class-based styling strategy; follow shared Vue/Nuxt standards for props, SSR, and accessibility.

<!-- /bmad:context -->
