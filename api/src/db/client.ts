import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.js'
import * as schema from './schema.js'

// Raw client: kept for connectivity pings (health.ts, system-status-service.ts)
// and graceful shutdown (server.ts). All table queries go through `db`.
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
})

export const db = drizzle(sql, { schema })
