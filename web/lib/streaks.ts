/**
 * Streak computation for sleep logs.
 *
 * A "night" qualifies if the log's sleep_rating is >= 4.
 * A streak is a run of consecutive nights (by night_of) that all qualify.
 * Any missing or low-rated night breaks the run.
 *
 * The CURRENT streak is "live" only while the most recent qualifying night is
 * today or yesterday — if the user hasn't logged a 4+ night recently, the
 * streak is over and reports 0. Pass todayISO ("YYYY-MM-DD") for deterministic
 * tests; otherwise it defaults to the real current date.
 */

export interface StreaksResult {
  /** Length of the live run ending now (0 if the streak is dead/stale). */
  current: number
  /** Longest run found across all logs. */
  longest: number
  /** Start date (YYYY-MM-DD) of the longest run, or null. */
  longestStart: string | null
  /** End date of the longest run, or null. */
  longestEnd: string | null
}

export interface StreakLog {
  night_of: string
  data: Record<string, unknown>
}

const DAY_MS = 86400000

/** Parse "YYYY-MM-DD" to a UTC midnight timestamp. Returns NaN on bad input. */
function toDayTs(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function qualifies(log: StreakLog): boolean {
  const v = Number(log.data?.sleep_rating)
  return Number.isFinite(v) && v >= 4
}

function todayString(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

export function computeStreaks(logs: StreakLog[], todayISO?: string): StreaksResult {
  const empty: StreaksResult = { current: 0, longest: 0, longestStart: null, longestEnd: null }
  if (!logs || logs.length === 0) return empty

  const today = toDayTs(todayISO ?? todayString())
  const activeFloor = Number.isNaN(today) ? Number.NaN : today - DAY_MS // today or yesterday

  // Qualifying nights, sorted ascending, deduped by date.
  const days: { ts: number; date: string }[] = []
  const seen = new Set<string>()
  for (const log of logs) {
    if (!qualifies(log)) continue
    const ts = toDayTs(log.night_of)
    if (Number.isNaN(ts) || seen.has(log.night_of)) continue
    seen.add(log.night_of)
    days.push({ ts, date: log.night_of })
  }
  days.sort((a, b) => a.ts - b.ts)
  if (days.length === 0) return empty

  let best: { start: string; end: string; len: number } | null = null
  let runStart = days[0].date
  let runLen = 1

  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1]
    const cur = days[i]
    if (cur.ts - prev.ts === DAY_MS) {
      runLen++
    } else {
      if (!best || runLen >= best.len) best = { start: runStart, end: days[i - 1].date, len: runLen }
      runStart = cur.date
      runLen = 1
    }
  }
  if (!best || runLen >= best.len) best = { start: runStart, end: days[days.length - 1].date, len: runLen }

  // Current streak: consecutive qualifying nights ending at the most recent
  // qualifying night — but only "live" while that night is today or yesterday.
  let current = 0
  const lastIdx = days.length - 1
  if (!Number.isNaN(activeFloor) && days[lastIdx].ts >= activeFloor) {
    let i = lastIdx
    while (i >= 0) {
      if (i < lastIdx && days[i + 1].ts - days[i].ts !== DAY_MS) break
      current++
      i--
    }
  }

  return {
    current,
    longest: best.len,
    longestStart: best.start,
    longestEnd: best.end,
  }
}