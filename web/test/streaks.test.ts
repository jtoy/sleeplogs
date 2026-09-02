import { describe, it, expect } from "vitest"
import { computeStreaks } from "../lib/streaks"

function log(night: string, rating: unknown) {
  return { night_of: night, data: { sleep_rating: rating } }
}

describe("computeStreaks", () => {
  it("returns zeros for no logs", () => {
    expect(computeStreaks([], "2026-09-10")).toEqual({ current: 0, longest: 0, longestStart: null, longestEnd: null })
  })

  it("single qualifying night -> longest and current are 1 (same day)", () => {
    const r = computeStreaks([log("2026-09-01", 4)], "2026-09-01")
    expect(r.longest).toBe(1)
    expect(r.current).toBe(1)
    expect(r.longestStart).toBe("2026-09-01")
    expect(r.longestEnd).toBe("2026-09-01")
  })

  it("single qualifying night counts the next morning (yesterday)", () => {
    expect(computeStreaks([log("2026-09-01", 4)], "2026-09-02").current).toBe(1)
  })

  it("single qualifying night is stale after two days -> current 0, longest 1", () => {
    const r = computeStreaks([log("2026-09-01", 4)], "2026-09-04")
    expect(r.longest).toBe(1)
    expect(r.current).toBe(0)
  })

  it("single low-rated night -> empty streak", () => {
    const r = computeStreaks([log("2026-09-01", 2)], "2026-09-02")
    expect(r.longest).toBe(0)
    expect(r.current).toBe(0)
  })

  it("two consecutive 4+ nights -> 2 night streak", () => {
    const r = computeStreaks([log("2026-09-01", 5), log("2026-09-02", 4)], "2026-09-02")
    expect(r.longest).toBe(2)
    expect(r.current).toBe(2)
  })

  it("current streak dies if no 4+ night logged recently", () => {
    const r = computeStreaks(
      [log("2026-09-01", 5), log("2026-09-02", 4), log("2026-09-03", 5)],
      "2026-09-06" // last good night was 09-03, three days ago
    )
    expect(r.longest).toBe(3)
    expect(r.current).toBe(0)
  })

  it("gap in dates breaks the streak", () => {
    const r = computeStreaks([log("2026-09-01", 5), log("2026-09-03", 4)], "2026-09-03")
    expect(r.longest).toBe(1)
    expect(r.current).toBe(1) // most recent qualifying night is isolated
  })

  it("low rating breaks the streak", () => {
    const r = computeStreaks(
      [log("2026-09-01", 5), log("2026-09-02", 3), log("2026-09-03", 4)],
      "2026-09-03"
    )
    expect(r.longest).toBe(1)
    expect(r.current).toBe(1)
  })

  it("finds the longest of several runs", () => {
    const r = computeStreaks(
      [
        log("2026-09-01", 4),
        log("2026-09-02", 5),
        log("2026-09-03", 4),
        log("2026-09-04", 2), // break
        log("2026-09-05", 4),
        log("2026-09-06", 5),
        log("2026-09-07", 4),
      ],
      "2026-09-07"
    )
    expect(r.longest).toBe(3)
    expect(r.longestStart).toBe("2026-09-05")
    expect(r.longestEnd).toBe("2026-09-07")
    expect(r.current).toBe(3)
  })

  it("current streak is the most recent run, longest can be older", () => {
    const r = computeStreaks(
      [
        log("2026-09-01", 4),
        log("2026-09-02", 4),
        log("2026-09-03", 4),
        log("2026-09-04", 2),
        log("2026-09-05", 5),
        log("2026-09-06", 5),
      ],
      "2026-09-06"
    )
    expect(r.longest).toBe(3)
    expect(r.current).toBe(2)
  })

  it("handles unsorted input", () => {
    const r = computeStreaks([log("2026-09-03", 4), log("2026-09-01", 4), log("2026-09-02", 4)], "2026-09-03")
    expect(r.longest).toBe(3)
    expect(r.longestStart).toBe("2026-09-01")
  })

  it("non-qualifying nights (no numeric rating) break the run", () => {
    const r = computeStreaks(
      [
        log("2026-09-01", 5),
        { night_of: "2026-09-02", data: {} },
        log("2026-09-03", 4),
        { night_of: "2026-09-04", data: { sleep_rating: "abc" } },
      ],
      "2026-09-04"
    )
    expect(r.longest).toBe(1)
    expect(r.current).toBe(1)
  })

  it("crosses month boundaries", () => {
    const r = computeStreaks([log("2026-01-31", 4), log("2026-02-01", 4), log("2026-02-02", 5)], "2026-02-02")
    expect(r.longest).toBe(3)
    expect(r.current).toBe(3)
  })

  it("crosses year boundaries", () => {
    const r = computeStreaks([log("2025-12-31", 4), log("2026-01-01", 4)], "2026-01-01")
    expect(r.longest).toBe(2)
    expect(r.current).toBe(2)
  })

  it("dedupes duplicate night_of entries", () => {
    const r = computeStreaks(
      [log("2026-09-01", 4), log("2026-09-01", 5), log("2026-09-02", 4)],
      "2026-09-02"
    )
    expect(r.longest).toBe(2)
    expect(r.current).toBe(2)
  })
})