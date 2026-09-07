# Platform Nuxt module

The module entry orchestrates Nuxt Kit registration. Registration and file-resolution
adapters depend on pure navigation/page transformations and shared runtime types.
Pure transformations must not depend on registration adapters or Nuxt Kit.

Runtime composables and utilities must not import build-time modules, Nuxt Kit, or
Node APIs. Shared navigation types live in the runtime type module so both sides
can consume them without importing application execution.

The package build uses official Nuxt type re-exports from `build/nuxt-imports.d.ts`.
These declarations are compile-time support only. Runtime typechecking uses the
prepared fixture's generated Nuxt environment and excludes those build shims.
Keep custom runtime config and generated navigation declarations platform-owned.

`scripts/verify-nuxt-module-boundaries.ts` enforces the build/runtime dependency
direction. Its verifier owns the exact build-time file membership.
