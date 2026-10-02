import { renderGraphiQL } from '@graphql-yoga/render-graphiql'
import type { GraphiQLOptions } from 'graphql-yoga'

const editCallback = '__EVE_SPACE_MEMORY_ONLY_EDIT__'

export const renderApplicationGraphiQL = (options: GraphiQLOptions) => {
  const viewerOptions = { ...options, storage: null, onEditQuery: editCallback }
  // Yoga's default edit callback writes documents into browser history.
  return renderGraphiQL(viewerOptions).replace(
    `"onEditQuery":"${editCallback}"`,
    '"onEditQuery":() => {}',
  )
}
