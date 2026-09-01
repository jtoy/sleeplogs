import { Pool } from "pg"

declare global {
  // eslint-disable-next-line no-var
  var _sleepLogsPool: Pool | undefined
}

export function getPool(): Pool {
  if (!global._sleepLogsPool) {
    global._sleepLogsPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    })
  }
  return global._sleepLogsPool
}

export async function query(text: string, params?: unknown[]) {
  const pool = getPool()
  const res = await pool.query(text, params)
  return res
}

export type Row = Record<string, any>
