export const isTransportDependency = (specifier: string): boolean =>
  specifier === 'hono' ||
  specifier.startsWith('hono/') ||
  specifier === 'graphql' ||
  specifier === 'graphql-yoga'
