import { NextRequest, NextResponse } from "next/server"
import { query } from "../../../lib/db"
import { requireDashboardAuth } from "../../../lib/auth"

export const dynamic = "force-dynamic"

const VALID_FIELD_TYPES = ["rating", "int", "bool", "text"]
const KEY_RE = /^[a-z][a-z0-9_]*$/

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

/** Add a new column. sort_order defaults to (max + 1). */
export async function POST(request: NextRequest) {
  const auth = await requireDashboardAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status })
  }

  const body = await request.json()
  const { key, label, field_type, default_value, min_value, max_value, sort_order } = body

  if (!key || !label) {
    return NextResponse.json({ error: "key and label are required" }, { status: 400 })
  }
  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: "key must start with a lowercase letter and contain only [a-z0-9_]" }, { status: 400 })
  }
  if (!field_type || !VALID_FIELD_TYPES.includes(field_type)) {
    return NextResponse.json({ error: `field_type must be one of: ${VALID_FIELD_TYPES.join(", ")}` }, { status: 400 })
  }

  let finalOrder: number
  let order: number | null = null
  if (sort_order !== undefined && sort_order !== null) {
    finalOrder = Number(sort_order)
  } else {
    const maxRes = await query(`SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM columns`)
    finalOrder = Number(maxRes.rows[0].max_order) + 1
  }
  void order

  const result = await query(
    `INSERT INTO columns (key, label, field_type, default_value, min_value, max_value, sort_order, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)
     RETURNING key, label, field_type, default_value, min_value, max_value, sort_order, enabled`,
    [
      key,
      label,
      field_type,
      default_value === undefined || default_value === null ? null : String(default_value),
      min_value === undefined || min_value === null ? null : Number(min_value),
      max_value === undefined || max_value === null ? null : Number(max_value),
      finalOrder,
    ]
  )

  return NextResponse.json({ ok: true, column: result.rows[0] })
}

/** Update one or more fields of an existing column (partial update). */
const PATCH_FIELDS: Record<string, string> = {
  label: "label",
  enabled: "enabled",
  sort_order: "sort_order",
  default_value: "default_value",
  min_value: "min_value",
  max_value: "max_value",
  field_type: "field_type",
}

export async function PATCH(request: NextRequest) {
  const auth = await requireDashboardAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status })
  }

  const body = await request.json()
  const key = body.key
  if (!key) {
    return NextResponse.json({ error: "key (string) required" }, { status: 400 })
  }

  const sets: string[] = []
  const params: unknown[] = []
  let idx = 1

  for (const [field, col] of Object.entries(PATCH_FIELDS)) {
    if (body[field] === undefined) continue
    switch (field) {
      case "field_type":
        if (!VALID_FIELD_TYPES.includes(body[field])) {
          return NextResponse.json({ error: `field_type must be one of: ${VALID_FIELD_TYPES.join(", ")}` }, { status: 400 })
        }
        params.push(body[field])
        break
      case "enabled":
        params.push(!!body[field])
        break
      case "sort_order":
      case "min_value":
      case "max_value":
        params.push(body[field] === null ? null : Number(body[field]))
        break
      case "label":
        if (!body[field]) {
          return NextResponse.json({ error: "label cannot be empty" }, { status: 400 })
        }
        params.push(body[field])
        break
      case "default_value":
        params.push(body[field] === null ? null : String(body[field]))
        break
    }
    sets.push(`${col} = $${idx++}`)
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "at least one field to update required" }, { status: 400 })
  }

  params.push(key)
  const result = await query(
    `UPDATE columns SET ${sets.join(", ")}, updated_at = NOW() WHERE key = $${idx} RETURNING key, label, field_type, default_value, min_value, max_value, sort_order, enabled`,
    params
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, column: result.rows[0] })
}

/** Delete a column by ?key=... */
export async function DELETE(request: NextRequest) {
  const auth = await requireDashboardAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status })
  }

  const key = new URL(request.url).searchParams.get("key")
  if (!key) {
    return NextResponse.json({ error: "key query param required" }, { status: 400 })
  }

  const result = await query(`DELETE FROM columns WHERE key = $1 RETURNING key`, [key])

  if (result.rowCount === 0 || result.rows.length === 0) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, deleted: result.rows[0].key })
}