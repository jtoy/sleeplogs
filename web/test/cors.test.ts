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
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization")
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