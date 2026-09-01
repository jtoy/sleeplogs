import type { NextRequest } from "next/server"

const ORC_ME_URL = "https://orchestrator.distark.com/api/v1/me.json"

/** Validate a bearer token against ORC. Returns true when valid. */
export async function validateOrcToken(token: string): Promise<boolean> {
  if (!token) return false
  try {
    const res = await fetch(ORC_ME_URL, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Require dashboard-level auth for an API route (ORC bearer token only).
 * Returns { ok: false } with a 401 status when unauthorized.
 */
export async function requireDashboardAuth(request: NextRequest): Promise<{ ok: true } | { ok: false; status: number }> {
  const authHeader = request.headers.get("Authorization") || ""
  if (authHeader.startsWith("Bearer ")) {
    const valid = await validateOrcToken(authHeader.substring(7))
    if (valid) return { ok: true }
  }
  return { ok: false, status: 401 }
}
