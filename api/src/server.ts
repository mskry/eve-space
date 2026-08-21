import { serve } from '@hono/node-server'
import { app } from './index.js'
import { sql } from './db/client.js'
import { env } from './env.js'

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Hono API listening on http://localhost:${info.port}`)
})

async function shutdown() {
  server.close()
  await sql.end({ timeout: 5 })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
