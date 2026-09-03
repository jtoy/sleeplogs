/**
 * INTEGRATION tests — run against a SEPARATE test database.
 *
 * These exercise the REAL route handlers with the REAL pg pool (no db mock),
 * so they prove migrations + SQL behavior (upsert/merge/delete) against an
 * actual Postgres. They SKIP automatically if TEST_DATABASE_URL is not set,
 * so plain `npm test` stays fast and never touches a real DB.
 *
 * Run:  npm run test:integration   (reads TEST_DATABASE_URL from .env.test)
 *
 * Auth is mocked (requireDashboardAuth) — auth logic is covered in unit tests;
 * here we're testing the data layer.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import fs from "fs"
import path from "path"

// Auth is unit-tested elsewhere; keep the data-layer tests focused.
vi.mock("../lib/auth", () => ({
  requireDashboardAuth: vi.fn(async () => ({ ok: true })),
}))

const TEST_DB = process.env.TEST_DATABASE_URL || ""

// We need process.env.DATABASE_URL pointing at the test DB BEFORE the pool is
// created, so we load the routes and db lazily after setting it.
let writeLogPOST: typeof import("../app/api/write_log/route").POST
let logsGET: typeof import("../app/api/logs/route").GET
let logsDELETE: typeof import("../app/api/logs/route").DELETE
let columnsGET: typeof import("../app/api/columns/route").GET
let columnsPOST: typeof import("../app/api/columns/route").POST
let columnsPATCH: typeof import("../app/api/columns/route").PATCH
let columnsDELETE: typeof import("../app/api/columns/route").DELETE
let query: typeof import("../lib/db").query
let pool: { end: () => Promise<void> } | undefined

function jsonReq(url: string, opts: { method?: string; body?: unknown } = {}): Request {
  const headers = new Headers({ Authorization: "Bearer test" })
  const init: RequestInit = { method: opts.method || "GET", headers }
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
    headers.set("Content-Type", "application/json")
  }
  return new Request(url, init)
}

const skip = !TEST_DB

describe.skipIf(skip)("DB integration (test database)", () => {
  beforeAll(async () => {
    if (!TEST_DB) return
    process.env.DATABASE_URL = TEST_DB
    // Force a fresh pool bound to the test DB.
    ;(globalThis as any)._sleepLogsPool = undefined

    const db = await import("../lib/db")
    query = db.query
    pool = db.getPool()

    // Run migrations (idempotent).
    const migrations = ["001_create_columns.sql", "002_create_sleep_logs.sql", "003_seed_columns.sql", "004_add_day_to_sleep_logs.sql"]
    for (const f of migrations) {
      const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", f), "utf8")
      await query(sql)
    }

    // Start clean: reset both tables, then re-seed the base columns.
    await query("TRUNCATE sleep_logs")
    await query("TRUNCATE columns")
    const seedSql = fs.readFileSync(path.join(__dirname, "..", "migrations", "003_seed_columns.sql"), "utf8")
    await query(seedSql)

    writeLogPOST = (await import("../app/api/write_log/route")).POST
    logsGET = (await import("../app/api/logs/route")).GET
    logsDELETE = (await import("../app/api/logs/route")).DELETE
    columnsGET = (await import("../app/api/columns/route")).GET
    columnsPOST = (await import("../app/api/columns/route")).POST
    columnsPATCH = (await import("../app/api/columns/route")).PATCH
    columnsDELETE = (await import("../app/api/columns/route")).DELETE
  })

  afterAll(async () => {
    if (pool) await pool.end()
  })

  it("GET /api/columns returns the seeded columns in order", async () => {
    const res = await columnsGET(new Request("http://localhost/api/columns", { headers: { Authorization: "Bearer t" } }))
    expect(res.status).toBe(200)
    const { columns } = await res.json()
    expect(columns.length).toBe(8)
    expect(columns[0].key).toBe("sleep_rating")
    const order = columns.map((c: any) => c.sort_order)
    expect([...order].sort((a: number, b: number) => a - b)).toEqual(order)
  })

  it("POST /api/write_log inserts a new log", async () => {
    const res = await writeLogPOST(jsonReq("http://localhost/api/write_log", {
      method: "POST",
      body: { night_of: "1999-01-01", day: "1999-01-02", data: { sleep_rating: 5, notes: "integration test" } },
    }))
    expect(res.status).toBe(200)
    const rows = (await query("SELECT night_of::text, day::text, data FROM sleep_logs WHERE night_of = '1999-01-01'")).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].data.sleep_rating).toBe(5)
    expect(rows[0].day.slice(0, 10)).toBe("1999-01-02")
  })

  it("POST /api/write_log defaults day to night_of + 1 when omitted", async () => {
    const res = await writeLogPOST(jsonReq("http://localhost/api/write_log", {
      method: "POST",
      body: { night_of: "1999-01-10", data: { sleep_rating: 4 } },
    }))
    expect(res.status).toBe(200)
    const rows = (await query("SELECT day::text FROM sleep_logs WHERE night_of = '1999-01-10'")).rows
    expect(rows[0].day.slice(0, 10)).toBe("1999-01-11")
  })

  it("POST /api/write_log MERGES instead of replacing (the incident scenario)", async () => {
    const res = await writeLogPOST(jsonReq("http://localhost/api/write_log", {
      method: "POST",
      body: { night_of: "1999-01-01", data: { woke_up_times: 2 } },
    }))
    expect(res.status).toBe(200)
    const rows = (await query("SELECT data FROM sleep_logs WHERE night_of = '1999-01-01'")).rows
    expect(rows[0].data.sleep_rating).toBe(5) // preserved
    expect(rows[0].data.notes).toBe("integration test") // preserved
    expect(rows[0].data.woke_up_times).toBe(2) // added
    const count = (await query("SELECT count(*)::int AS n FROM sleep_logs WHERE night_of = '1999-01-01'")).rows[0].n
    expect(count).toBe(1)
  })

  it("DELETE /api/logs removes a log by night_of", async () => {
    const res = await logsDELETE(new Request("http://localhost/api/logs?night_of=1999-01-01", {
      method: "DELETE",
      headers: { Authorization: "Bearer t" },
    }))
    expect(res.status).toBe(200)
    const rows = (await query("SELECT night_of FROM sleep_logs WHERE night_of = '1999-01-01'")).rows
    expect(rows).toHaveLength(0)
  })

  it("DELETE /api/logs returns 404 for missing log", async () => {
    const res = await logsDELETE(new Request("http://localhost/api/logs?night_of=1999-01-02", {
      method: "DELETE",
      headers: { Authorization: "Bearer t" },
    }))
    expect(res.status).toBe(404)
  })

  it("column add, reorder, disable, delete round-trip", async () => {
    const addRes = await columnsPOST(jsonReq("http://localhost/api/columns", {
      method: "POST",
      body: { key: "stress_level", label: "Stress Level", field_type: "int", min_value: 0, max_value: 10 },
    }))
    expect(addRes.status).toBe(200)
    expect((await addRes.json()).column.sort_order).toBe(9)

    const patchRes = await columnsPATCH(jsonReq("http://localhost/api/columns", {
      method: "PATCH",
      body: { key: "stress_level", default_value: "3", sort_order: 1 },
    }))
    expect(patchRes.status).toBe(200)
    // Swap sleep_rating away from slot 1 (the UI's move-up swaps both rows).
    const patchSleep = await columnsPATCH(jsonReq("http://localhost/api/columns", {
      method: "PATCH",
      body: { key: "sleep_rating", sort_order: 9 },
    }))
    expect(patchSleep.status).toBe(200)

    const listRes = await columnsGET(new Request("http://localhost/api/columns?all=1", { headers: { Authorization: "Bearer t" } }))
    const { columns } = await listRes.json()
    expect(columns[0].key).toBe("stress_level")
    expect(columns[0].default_value).toBe("3")

    const delRes = await columnsDELETE(new Request("http://localhost/api/columns?key=stress_level", {
      method: "DELETE",
      headers: { Authorization: "Bearer t" },
    }))
    expect(delRes.status).toBe(200)
  })
})