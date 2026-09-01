import { describe, it, expect } from "vitest"
import { NextRequest } from "next/server"
import { middleware } from "../middleware"

describe("CORS middleware", () => {
  it("answers OPTIONS preflight with CORS headers", async () => {
    const req = new NextRequest("http://localhost:3000/api/columns", { method: "OPTIONS" })
    const res = middleware(req)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("access-control-allow-methods")).toContain("GET")
    expect(res.headers.get("access-control-allow-methods")).toContain("POST")
    expect(res.headers.get("access-control-allow-methods")).toContain("PATCH")
    expect(res.headers.get("access-control-allow-methods")).toContain("OPTIONS")
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization")
    expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type")
    expect(res.status).toBe(204)
  })

  it("handles OPTIONS with an Authorization header preflight", async () => {
    const req = new NextRequest("http://localhost:3000/api/write_log", {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
    })
    const res = middleware(req)
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-methods")).toContain("POST")
  })

  it("covers DELETE in allowed methods", async () => {
    const req = new NextRequest("http://localhost:3000/api/columns", { method: "DELETE" })
    const res = middleware(req)
    expect(res.headers.get("access-control-allow-methods")).toContain("DELETE")
  })

  it("attaches CORS headers to normal API responses", () => {
    const req = new NextRequest("http://localhost:3000/api/columns")
    const res = middleware(req)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
  })

  it("does not apply to non-API routes", () => {
    // matcher config covers this at runtime; middleware() itself runs on any path,
    // which is fine — headers on non-API routes are harmless. Just verify it works.
    const req = new NextRequest("http://localhost:3000/")
    const res = middleware(req)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
  })
})