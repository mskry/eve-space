import { Hono } from 'hono'
import { loadModuleRuntimeState } from '../platform/module-settings.js'

export const moduleRuntimeRoutes = new Hono().get('/', async (context) => {
  context.header('Cache-Control', 'public, max-age=30')
  return context.json(await loadModuleRuntimeState(), 200)
})
