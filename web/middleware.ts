import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * CORS for the Pebble phone app.
 *
 * The watch's PKJS layer runs inside the phone companion (a webview), so its
 * XMLHttpRequest to this API is cross-origin. Without these headers the request
 * is silently blocked and the watch shows "No connection".
 *
 * Applies to /api/* only. Auth is still enforced per-route via Bearer tokens;
 * allowing any origin is fine because the token itself grants access.
 */
function corsHeaders(): Headers {
  const headers = new Headers()
  headers.set("Access-Control-Allow-Origin", "*")
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
  headers.set("Access-Control-Max-Age", "86400")
  return headers
}

export function middleware(request: NextRequest) {
  // Respond directly to CORS preflights.
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders() })
  }

  // Attach CORS headers to normal responses.
  const response = NextResponse.next()
  corsHeaders().forEach((value, key) => {
    response.headers.set(key, value)
  })
  return response
}

export const config = {
  matcher: ["/api/:path*"],
}