import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { login, logout, getToken, getStoredUser, authenticatedFetch } from "../lib/api-client"

describe("api-client auth", () => {
  const ORIG_LOCAL_STORAGE = globalThis.localStorage
  const ORIG_DOCUMENT = globalThis.document

  beforeEach(() => {
    // Minimal localStorage + document stubs (node env)
    const store = new Map<string, string>()
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    }
    ;(globalThis as any).document = {
      cookie: "",
    }
  })

  afterEach(() => {
    ;(globalThis as any).localStorage = ORIG_LOCAL_STORAGE
    ;(globalThis as any).document = ORIG_DOCUMENT
    vi.unstubAllGlobals()
  })

  it("login stores token on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: "abc123" }),
    })
    vi.stubGlobal("fetch", mockFetch)

    const ok = await login("test@distark.com", "password")
    expect(ok).toBe(true)
    expect(getToken()).toBe("abc123")

    // Called with form-urlencoded body
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe("https://orca.distark.com/api/v1/auth")
    expect(opts.method).toBe("POST")
    expect(opts.body.toString()).toContain("email=test%40distark.com")
    expect(opts.body.toString()).toContain("password=password")
  })

  it("login returns false on bad credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
    const ok = await login("test@distark.com", "wrong")
    expect(ok).toBe(false)
    expect(getToken()).toBeNull()
  })

  it("login stores user profile from me.json", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: "tok1" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 7, email: "jane@distark.com", name: "Jane" }),
      })
    vi.stubGlobal("fetch", mockFetch)

    const ok = await login("jane@distark.com", "pw")
    expect(ok).toBe(true)

    const user = getStoredUser()
    expect(user).not.toBeNull()
    expect(user!.id).toBe(7)
    expect(user!.name).toBe("Jane")
    expect(user!.roles).toEqual([])
  })

  it("logout clears token and user", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ token: "t" }) })
    vi.stubGlobal("fetch", mockFetch)
    await login("a@b.com", "pw")
    expect(getToken()).toBe("t")

    logout()
    expect(getToken()).toBeNull()
    expect(getStoredUser()).toBeNull()
  })

  it("authenticatedFetch attaches Bearer token", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal("fetch", mockFetch)

    // Seed a token
    ;(globalThis as any).localStorage.setItem("distark_token", "sekrit")

    await authenticatedFetch("/api/columns")
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe("/api/columns")
    expect((opts.headers as any).Authorization).toBe("Bearer sekrit")
  })

  it("authenticatedFetch works without token", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal("fetch", mockFetch)

    await authenticatedFetch("/api/columns")
    const [, opts] = mockFetch.mock.calls[0]
    expect((opts.headers as any).Authorization).toBeUndefined()
  })

  it("login returns false when ORC has no token field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user: 1 }) }))
    const ok = await login("a@b.com", "pw")
    expect(ok).toBe(false)
    expect(getToken()).toBeNull()
  })

  it("login falls back to a stub user when me.json fails", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: "t1" }) })
      .mockRejectedValueOnce(new Error("network down"))
    vi.stubGlobal("fetch", mockFetch)

    const ok = await login("jane@distark.com", "pw")
    expect(ok).toBe(true)
    const user = getStoredUser()
    expect(user!.email).toBe("jane@distark.com")
    expect(user!.name).toBe("jane")
  })

  it("login handles network failure returning false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    const ok = await login("a@b.com", "pw")
    expect(ok).toBe(false)
  })

  it("login handles non-200 auth response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    const ok = await login("a@b.com", "wrong")
    expect(ok).toBe(false)
  })

  it("getStoredUser returns null when storage corrupted", async () => {
    ;(globalThis as any).localStorage.setItem("distark_user", "{bad json")
    expect(getStoredUser()).toBeNull()
  })

  it("authenticatedFetch preserves caller headers and adds Content-Type", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal("fetch", mockFetch)
    ;(globalThis as any).localStorage.setItem("distark_token", "tok")

    await authenticatedFetch("/api/columns", { headers: { "X-Custom": "v" } })
    const [, opts] = mockFetch.mock.calls[0]
    const h = opts.headers as any
    expect(h.Authorization).toBe("Bearer tok")
    expect(h["X-Custom"]).toBe("v")
    expect(h["Content-Type"]).toBe("application/json")
  })
})
