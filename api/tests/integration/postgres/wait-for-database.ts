import type postgres from 'postgres'

export const waitForDatabase = async (connection: postgres.Sql) => {
  /* oxlint-disable no-await-in-loop -- Connection retries must wait for the preceding attempt. */
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await connection`select 1`
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  /* oxlint-enable no-await-in-loop */
  throw new Error('PostgreSQL test container did not become ready')
}
