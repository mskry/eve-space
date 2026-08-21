// The side-effect import keeps this a module so the declaration augments,
// rather than replaces, @pinia/colada's types.
// oxlint-disable-next-line import/no-unassigned-import -- Required for external module augmentation.
import '@pinia/colada'

declare module '@pinia/colada' {
  interface TypesConfig {
    queryMeta: {
      globalErrorMessage?: string
    }
  }
}
