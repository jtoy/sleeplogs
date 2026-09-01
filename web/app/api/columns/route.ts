import { NextRequest, NextResponse } from "next/server"
import { query } from "../../../lib/db"
import { requireDashboardAuth } from "../../../lib/auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireDashboardAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status })
  }

  const url = new URL(request.url)
  const showAll = url.searchParams.get("all") === "1"

  const result = showAll
    ? await query(
        `SELECT key, label, field_type, default_value, min_value, max_value, sort_order, enabled
         FROM columns
         ORDER BY sort_order ASC`
      )
    : await query(
        `SELECT key, label, field_type, default_value, min_value, max_value, sort_order
         FROM columns
         WHERE enabled = true
         ORDER BY sort_order ASC`
      )

  return NextResponse.json({ columns: result.rows })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireDashboardAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status })
  }

  const body = await request.json()
  const { key, enabled } = body

  if (!key || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "key (string) and enabled (boolean) required" }, { status: 400 })
  }

  const result = await query(
    `UPDATE columns SET enabled = $1, updated_at = NOW() WHERE key = $2 RETURNING key, enabled`,
    [enabled, key]
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, column: result.rows[0] })
}
