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
import { GET as columnsGET, PATCH as columnsPATCH, POST as columnsPOST, DELETE as columnsDELETE } from "../app/api/columns/route"
import { POST as writeLogPOST } from "../app/api/write_log/route"
import { GET as logsGET, DELETE as logsDELETE } from "../app/api/logs/route"

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
    expect(sql).toContain("||")
  })

  it("merges existing data instead of replacing it", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 42 }] } as any)

    await writeLogPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { night_of: "2026-08-27", data: { sleep_rating: 4 } },
    }))
    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("COALESCE(sleep_logs.data, '{}'::jsonb) || EXCLUDED.data")
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

  it("stores data as JSON string", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 9 }] } as any)
    const data = { sleep_rating: 4, nap: false, notes: "he said \"hi\"" }
    await writeLogPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { night_of: "2026-08-27", data },
    }))
    const params = vi.mocked(query).mock.calls[0][1] as unknown[]
    expect(JSON.parse(params[1] as string)).toEqual(data)
  })

  it("accepts empty data object", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 10 }] } as any)
    const res = await writeLogPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { night_of: "2026-08-27" },
    }))
    expect(res.status).toBe(200)
  })

  it("rejects invalid JSON body", async () => {
    const req = new Request("http://localhost:3000/api/write_log", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: "{not json",
    })
    const res = await writeLogPOST(req as any)
    expect(res.status).toBe(400)
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

  it("filters by night_of for the watch silent-skip check", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 5, night_of: "2026-09-02" }] } as any)

    const res = await logsGET(mockRequest({
      headers: { Authorization: "Bearer tok" },
      url: "http://localhost:3000/api/logs?night_of=2026-09-02",
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.logs).toHaveLength(1)

    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("WHERE night_of = $1")
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(["2026-09-02"])
  })

  it("rejects 401 when unauthorized", async () => {
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: false, status: 401 })
    const res = await logsGET(mockRequest())
    expect(res.status).toBe(401)
  })
})

// ─── DELETE /api/logs ───────────────────────────────────────

describe("DELETE /api/logs", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
    vi.mocked(requireDashboardAuth).mockReset()
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: true })
  })

  it("deletes a log by night_of", async () => {
    vi.mocked(query).mockResolvedValue({ rowCount: 1, rows: [{ id: 3, night_of: "2026-09-01" }] } as any)

    const res = await logsDELETE(mockRequest({
      method: "DELETE",
      headers: { Authorization: "Bearer tok" },
      url: "http://localhost:3000/api/logs?night_of=2026-09-01",
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.deleted.night_of).toBe("2026-09-01")
    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("DELETE FROM sleep_logs")
  })

  it("deletes a log by id", async () => {
    vi.mocked(query).mockResolvedValue({ rowCount: 1, rows: [{ id: 9, night_of: "2026-09-02" }] } as any)
    const res = await logsDELETE(mockRequest({
      method: "DELETE",
      headers: { Authorization: "Bearer tok" },
      url: "http://localhost:3000/api/logs?id=9",
    }))
    expect(res.status).toBe(200)
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([9])
  })

  it("rejects missing identifiers", async () => {
    const res = await logsDELETE(mockRequest({ method: "DELETE" }))
    expect(res.status).toBe(400)
  })

  it("rejects 404 for unknown log", async () => {
    vi.mocked(query).mockResolvedValue({ rowCount: 0, rows: [] } as any)
    const res = await logsDELETE(mockRequest({
      method: "DELETE",
      url: "http://localhost:3000/api/logs?night_of=1999-01-01",
    }))
    expect(res.status).toBe(404)
  })

  it("rejects 401 when unauthorized", async () => {
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: false, status: 401 })
    const res = await logsDELETE(mockRequest({
      method: "DELETE",
      url: "http://localhost:3000/api/logs?night_of=2026-09-01",
    }))
    expect(res.status).toBe(401)
  })
})

// ─── POST /api/columns (add) ────────────────────────────────

describe("POST /api/columns", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
    vi.mocked(requireDashboardAuth).mockReset()
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: true })
  })

  it("creates a new column at the end of the order", async () => {
    // First call: get next sort_order (max+1). Second: insert.
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ max_order: 7 }] } as any)
      .mockResolvedValueOnce({
        rows: [{ key: "stress_level", label: "Stress Level", field_type: "int", enabled: true, sort_order: 8 }],
      } as any)

    const res = await columnsPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { key: "stress_level", label: "Stress Level", field_type: "int", min_value: 0, max_value: 10 },
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.column.key).toBe("stress_level")
    expect(json.column.sort_order).toBe(8)

    const insertSql = vi.mocked(query).mock.calls[1][0] as string
    expect(insertSql).toContain("INSERT INTO columns")
  })

  it("rejects missing key/label", async () => {
    const res = await columnsPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { label: "No Key" },
    }))
    expect(res.status).toBe(400)
  })

  it("rejects invalid field_type", async () => {
    const res = await columnsPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { key: "bad", label: "Bad", field_type: "banana" },
    }))
    expect(res.status).toBe(400)
  })

  it("rejects invalid key format", async () => {
    const res = await columnsPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { key: "Bad Key!", label: "Bad", field_type: "int" },
    }))
    expect(res.status).toBe(400)
  })

  it("accepts explicit sort_order", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ key: "x", sort_order: 3 }],
    } as any)
    const res = await columnsPOST(mockRequest({
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: { key: "x", label: "X", field_type: "bool", sort_order: 3 },
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).column.sort_order).toBe(3)
  })

  it("rejects 401 when unauthorized", async () => {
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: false, status: 401 })
    const res = await columnsPOST(mockRequest({ method: "POST" }))
    expect(res.status).toBe(401)
  })
})

// ─── PATCH /api/columns (update) ────────────────────────────

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

  it("updates sort_order for reordering", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ key: "nap", sort_order: 1 }],
    } as any)

    const res = await columnsPATCH(mockRequest({
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: { key: "nap", sort_order: 1 },
    }))
    expect(res.status).toBe(200)
    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("sort_order")
  })

  it("updates label and field metadata", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ key: "nap", label: "Napped?", min_value: 0, max_value: 3 }],
    } as any)

    const res = await columnsPATCH(mockRequest({
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: { key: "nap", label: "Napped?", min_value: 0, max_value: 3 },
    }))
    expect(res.status).toBe(200)
    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("label")
    expect(sql).toContain("min_value")
  })

  it("rejects empty update body", async () => {
    const res = await columnsPATCH(mockRequest({
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: { key: "nap" },
    }))
    expect(res.status).toBe(400)
  })

  it("rejects 404 for unknown column", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
    const res = await columnsPATCH(mockRequest({
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: { key: "ghost", enabled: false },
    }))
    expect(res.status).toBe(404)
  })

  it("updates default_value (web-app default editor)", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ key: "melatonin_mcg", default_value: "100" }],
    } as any)

    const res = await columnsPATCH(mockRequest({
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: { key: "melatonin_mcg", default_value: "100" },
    }))
    expect(res.status).toBe(200)
    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("default_value")
    expect(vi.mocked(query).mock.calls[0][1]).toContain("100")
  })

  it("clears default_value when set to null", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ key: "notes", default_value: null }] } as any)
    const res = await columnsPATCH(mockRequest({
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: { key: "notes", default_value: null },
    }))
    expect(res.status).toBe(200)
    const params = vi.mocked(query).mock.calls[0][1] as unknown[]
    expect(params[0]).toBeNull()
  })

  it("rejects invalid field_type on update", async () => {
    const res = await columnsPATCH(mockRequest({
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: { key: "nap", field_type: "weird" },
    }))
    expect(res.status).toBe(400)
  })

  it("rejects empty label on update", async () => {
    const res = await columnsPATCH(mockRequest({
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: { key: "nap", label: "" },
    }))
    expect(res.status).toBe(400)
  })
})

// ─── DELETE /api/columns (remove) ───────────────────────────

describe("DELETE /api/columns", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
    vi.mocked(requireDashboardAuth).mockReset()
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: true })
  })

  it("deletes a column by key", async () => {
    vi.mocked(query).mockResolvedValue({ rowCount: 1, rows: [{ key: "notes" }] } as any)

    const res = await columnsDELETE(mockRequest({
      method: "DELETE",
      headers: { Authorization: "Bearer tok" },
      url: "http://localhost:3000/api/columns?key=notes",
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    const sql = vi.mocked(query).mock.calls[0][0] as string
    expect(sql).toContain("DELETE FROM columns")
  })

  it("rejects missing key param", async () => {
    const res = await columnsDELETE(mockRequest({ method: "DELETE" }))
    expect(res.status).toBe(400)
  })

  it("rejects 404 for unknown column", async () => {
    vi.mocked(query).mockResolvedValue({ rowCount: 0, rows: [] } as any)
    const res = await columnsDELETE(mockRequest({
      method: "DELETE",
      url: "http://localhost:3000/api/columns?key=ghost",
    }))
    expect(res.status).toBe(404)
  })

  it("rejects 401 when unauthorized", async () => {
    vi.mocked(requireDashboardAuth).mockResolvedValue({ ok: false, status: 401 })
    const res = await columnsDELETE(mockRequest({
      method: "DELETE",
      url: "http://localhost:3000/api/columns?key=notes",
    }))
    expect(res.status).toBe(401)
  })
})
