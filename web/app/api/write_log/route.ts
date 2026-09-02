import { NextRequest, NextResponse } from "next/server"
import { query } from "../../../lib/db"
import { requireDashboardAuth } from "../../../lib/auth"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const auth = await requireDashboardAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const { night_of, data } = body

  if (!night_of) {
    return NextResponse.json({ error: "night_of is required" }, { status: 400 })
  }

  const result = await query(
    `INSERT INTO sleep_logs (night_of, data)
     VALUES ($1, $2)
     ON CONFLICT (night_of) DO UPDATE
       SET data = COALESCE(sleep_logs.data, '{}'::jsonb) || EXCLUDED.data,
           updated_at = NOW()
     RETURNING id`,
    [night_of, JSON.stringify(data || {})]
  )

  return NextResponse.json({ ok: true, id: result.rows[0].id })
}
