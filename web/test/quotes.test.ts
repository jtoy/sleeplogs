import { describe, it, expect } from "vitest"
import { HEALTH_QUOTES, randomHealthQuote } from "../lib/quotes"

describe("HEALTH_QUOTES", () => {
  it("has exactly 30 quotes", () => {
    expect(HEALTH_QUOTES).toHaveLength(30)
  })

  it("every quote is a non-empty string", () => {
    HEALTH_QUOTES.forEach((q) => {
      expect(typeof q).toBe("string")
      expect(q.trim().length).toBeGreaterThan(0)
    })
  })

  it("quotes are unique", () => {
    const set = new Set(HEALTH_QUOTES)
    expect(set.size).toBe(HEALTH_QUOTES.length)
  })

  it("quotes are reasonably short (<= 120 chars for display)", () => {
    HEALTH_QUOTES.forEach((q) => {
      expect(q.length).toBeLessThanOrEqual(120)
    })
  })

  it("randomHealthQuote returns one of the quotes", () => {
    for (let i = 0; i < 20; i++) {
      const q = randomHealthQuote()
      expect(HEALTH_QUOTES).toContain(q)
    }
  })

  it("all quotes feel health/sleep themed (mention health, sleep, body, or habit words)", () => {
    const themeWords = ["health", "sleep", "body", "habit", "rest", "morning", "energy", "mind", "well", "drink", "walk", "food", "water", "self"]
    HEALTH_QUOTES.forEach((q) => {
      const lower = q.toLowerCase()
      const themed = themeWords.some((w) => lower.includes(w))
      expect(themed, `quote not clearly health-themed: "${q}"`).toBe(true)
    })
  })
})