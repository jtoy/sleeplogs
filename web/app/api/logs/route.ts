import { NextRequest, NextResponse } from "next/server"
import { query } from "../../../lib/db"
import { requireDashboardAuth } from "../../../lib/auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireDashboardAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status })
  }

  const result = await query(
    `SELECT id, night_of, data, created_at, updated_at
     FROM sleep_logs
     ORDER BY night_of DESC`
  )

  return NextResponse.json({ logs: result.rows })
}
