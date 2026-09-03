import { NextRequest, NextResponse } from "next/server"
import { query } from "../../../lib/db"
import { requireDashboardAuth } from "../../../lib/auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireDashboardAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status })
  }

  const nightOf = new URL(request.url).searchParams.get("night_of")
  const result = nightOf
    ? await query(
        `SELECT id, night_of, data, created_at, updated_at
         FROM sleep_logs
         WHERE night_of = $1
         ORDER BY night_of DESC`,
        [nightOf]
      )
    : await query(
        `SELECT id, night_of, data, created_at, updated_at
         FROM sleep_logs
         ORDER BY night_of DESC`
      )

  return NextResponse.json({ logs: result.rows })
}

/** Delete a log by ?night_of=YYYY-MM-DD (or by id). */
export async function DELETE(request: NextRequest) {
  const auth = await requireDashboardAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status })
  }

  const params = new URL(request.url).searchParams
  const nightOf = params.get("night_of")
  const id = params.get("id")

  if (!nightOf && !id) {
    return NextResponse.json({ error: "night_of (date) or id query param required" }, { status: 400 })
  }

  const result = nightOf
    ? await query(`DELETE FROM sleep_logs WHERE night_of = $1 RETURNING id, night_of`, [nightOf])
    : await query(`DELETE FROM sleep_logs WHERE id = $1 RETURNING id, night_of`, [Number(id)])

  if (result.rowCount === 0 || result.rows.length === 0) {
    return NextResponse.json({ error: "Log not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, deleted: result.rows[0] })
}