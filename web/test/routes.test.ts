import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock DB + auth before importing the routes
vi.mock("../lib/db", () => ({
  query: vi.fn(),
}))
vi.mock("../lib/auth", () => ({
  requireDashboardAuth: vi.fn(async () => ({ ok: true })),
}))

import { query } from "../lib/db"
import { requireDashboardAuth } from "../lib/auth"
import { GET as columnsGET, PATCH as columnsPATCH } from "../app/api/columns/route"
import { POST as writeLogPOST } from "../app/api/write_log/route"
import { GET as logsGET } from "../app/api/logs/route"

function mockRequest(opts: {
  url?: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
} = {}): Request {
  const url = opts.url || "http://localhost:3000"
  const headers = new Headers(opts.headers || {})
  const init: RequestInit = { method: opts.method || "GET", headers }
  if (opts.body) {
    init.body = JSON.stringify(opts.body)
    headers.set("Content-Type", "application/json")
  }
  return new Request(url, init)
}

// ─── GET /api/columns ────────────────────────────────────────

describe("GET /api/columns", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
    vi.mocked(requireDashboardAuth).mockReset()
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: true })
  })

  it("returns enabled columns sorted by sort_order", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [
        { key: "sleep_rating", label: "Sleep Rating", field_type: "rating", default_value: null, min_value: 1, max_value: 5, sort_order: 1 },
        { key: "woke_up_times", label: "Wake-ups", field_type: "int", default_value: "0", min_value: 0, max_value: 20, sort_order: 2 },
      ],
    } as any)

    const res = await columnsGET(mockRequest({ headers: { Authorization: "Bearer tok" } }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.columns).toHaveLength(2)
    expect(json.columns[0].key).toBe("sleep_rating")
    expect(json.columns[1].key).toBe("woke_up_times")

    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("enabled = true")
    expect(sql).toContain("ORDER BY sort_order")
  })

  it("excludes disabled columns", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [
        { key: "sleep_rating", label: "Sleep Rating", field_type: "rating", default_value: null, min_value: 1, max_value: 5, sort_order: 1 },
      ],
    } as any)

    const res = await columnsGET(mockRequest({ headers: { Authorization: "Bearer tok" } }))
    const json = await res.json()
    expect(json.columns).toHaveLength(1)
    // The SQL query itself filters; just verify it was called with enabled = true
    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("enabled = true")
  })

  it("rejects 401 when unauthorized", async () => {
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: false, status: 401 })
    const res = await columnsGET(mockRequest())
    expect(res.status).toBe(401)
  })
})

// ─── POST /api/write_log ─────────────────────────────────────

describe("POST /api/write_log", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
    vi.mocked(requireDashboardAuth).mockReset()
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: true })
  })

  it("inserts a new log and returns {ok: true, id}", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 42 }] } as any)

    const res = await writeLogPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { night_of: "2026-08-27", data: { sleep_rating: 4 } },
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.id).toBe(42)

    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("INSERT INTO sleep_logs")
    expect(sql).toContain("ON CONFLICT")
  })

  it("upserts on same night_of", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 42 }] } as any)

    const res = await writeLogPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { night_of: "2026-08-27", data: { sleep_rating: 5 } },
    }))
    expect(res.status).toBe(200)
    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("ON CONFLICT (night_of)")
    expect(sql).toContain("DO UPDATE")
  })

  it("rejects missing night_of with 400", async () => {
    const res = await writeLogPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { data: { sleep_rating: 4 } },
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it("rejects 401 when unauthorized", async () => {
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: false, status: 401 })
    const res = await writeLogPOST(mockRequest({
      method: "POST",
      body: { night_of: "2026-08-27", data: {} },
    }))
    expect(res.status).toBe(401)
  })
})

// ─── GET /api/logs ───────────────────────────────────────────

describe("GET /api/logs", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
    vi.mocked(requireDashboardAuth).mockReset()
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: true })
  })

  it("returns logs sorted by night_of DESC", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [
        { id: 2, night_of: "2026-08-27", data: { sleep_rating: 5 }, created_at: "2026-08-28T06:00:00Z" },
        { id: 1, night_of: "2026-08-26", data: { sleep_rating: 3 }, created_at: "2026-08-27T06:00:00Z" },
      ],
    } as any)

    const res = await logsGET(mockRequest({ headers: { Authorization: "Bearer tok" } }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.logs).toHaveLength(2)
    expect(json.logs[0].night_of).toBe("2026-08-27")

    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("ORDER BY night_of DESC")
  })

  it("rejects 401 when unauthorized", async () => {
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: false, status: 401 })
    const res = await logsGET(mockRequest())
    expect(res.status).toBe(401)
  })
})

// ─── PATCH /api/columns ──────────────────────────────────────

describe("PATCH /api/columns", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
    vi.mocked(requireDashboardAuth).mockReset()
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: true })
  })

  it("toggles the enabled field", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ key: "nap", enabled: false }],
    } as any)

    const res = await columnsPATCH(mockRequest({
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: { key: "nap", enabled: false },
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("UPDATE columns")
    expect(sql).toContain("enabled")
  })

  it("rejects 401 when unauthorized", async () => {
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: false, status: 401 })
    const res = await columnsPATCH(mockRequest({
      method: "PATCH",
      body: { key: "nap", enabled: false },
    }))
    expect(res.status).toBe(401)
  })
})
