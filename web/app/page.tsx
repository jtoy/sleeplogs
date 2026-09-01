"use client"

import { useState, useEffect, useCallback } from "react"

interface Column {
  key: string
  label: string
  field_type: string
  default_value: string | null
  min_value: number | null
  max_value: number | null
  sort_order: number
  enabled?: boolean
}

interface SleepLog {
  id: number
  night_of: string
  data: Record<string, unknown>
  created_at: string
}

export default function Dashboard() {
  const [token, setToken] = useState("")
  const [loggedIn, setLoggedIn] = useState(false)
  const [columns, setColumns] = useState<Column[]>([])
  const [allColumns, setAllColumns] = useState<Column[]>([])
  const [logs, setLogs] = useState<SleepLog[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // Restore token from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("sleeplogs_token")
    if (saved) {
      setToken(saved)
      setLoggedIn(true)
    }
  }, [])

  const headers = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }), [token])

  // Fetch data when logged in
  useEffect(() => {
    if (!loggedIn || !token) return
    fetchData()
  }, [loggedIn, token]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchData() {
    setLoading(true)
    setError("")
    try {
      const [colRes, logRes, allColRes] = await Promise.all([
        fetch("/api/columns", { headers: headers() }),
        fetch("/api/logs", { headers: headers() }),
        fetch("/api/columns?all=1", { headers: headers() }),
      ])

      if (!colRes.ok || !logRes.ok) {
        if (colRes.status === 401 || logRes.status === 401) {
          setError("Invalid token")
          setLoggedIn(false)
          localStorage.removeItem("sleeplogs_token")
          return
        }
        throw new Error("Failed to fetch data")
      }

      const colJson = await colRes.json()
      const logJson = await logRes.json()
      setColumns(colJson.columns)
      setLogs(logJson.logs)

      if (allColRes.ok) {
        const allColJson = await allColRes.json()
        setAllColumns(allColJson.columns)
      }
    } catch (e: any) {
      setError(e.message || "Unknown error")
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim()) return
    setLoading(true)
    setError("")

    const res = await fetch("/api/columns", {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    })

    if (res.ok) {
      localStorage.setItem("sleeplogs_token", token)
      setLoggedIn(true)
    } else {
      setError("Invalid token")
    }
    setLoading(false)
  }

  function handleLogout() {
    localStorage.removeItem("sleeplogs_token")
    setToken("")
    setLoggedIn(false)
    setColumns([])
    setLogs([])
    setAllColumns([])
  }

  async function toggleColumn(key: string, currentEnabled: boolean) {
    await fetch("/api/columns", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ key, enabled: !currentEnabled }),
    })
    fetchData()
  }

  function formatValue(val: unknown, fieldType: string): string {
    if (val === null || val === undefined) return "—"
    if (fieldType === "bool") return val ? "Yes" : "No"
    return String(val)
  }

  function exportCSV() {
    if (!logs.length || !columns.length) return
    const header = ["night_of", ...columns.map((c) => c.key)].join(",")
    const rows = logs.map((log) => {
      const vals = [log.night_of, ...columns.map((c) => {
        const v = log.data[c.key]
        if (v === null || v === undefined) return ""
        return String(v)
      })]
      return vals.map((v) => `"${v}"`).join(",")
    })
    const csv = [header, ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `sleeplogs_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Login Screen ──────────────────────────────────────────

  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-lg shadow-md w-96">
          <h1 className="text-2xl font-bold mb-6">SleepLogs</h1>
          <label className="block text-sm font-medium mb-2">Distark ORC Token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full border rounded px-3 py-2 mb-4"
            placeholder="Enter your ORC API token"
          />
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Checking..." : "Login"}
          </button>
        </form>
      </div>
    )
  }

  // ─── Dashboard ─────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">SleepLogs</h1>
        <div className="flex gap-3">
          <button onClick={exportCSV} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm">
            Export CSV
          </button>
          <button onClick={handleLogout} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm">
            Logout
          </button>
        </div>
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {/* Column Toggles */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">COLUMNS (toggle on/off — changes watch app in real time)</h2>
        <div className="flex flex-wrap gap-3">
          {allColumns.map((col) => (
            <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={col.enabled !== false}
                onChange={() => toggleColumn(col.key, col.enabled !== false)}
                className="rounded"
              />
              {col.label}
            </label>
          ))}
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left font-semibold">Night Of</th>
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3 text-left font-semibold">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-gray-400">
                  No logs yet. Submit from your watch to get started.
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{log.night_of}</td>
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    {formatValue(log.data[col.key], col.field_type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && <p className="text-center text-gray-400 mt-4">Loading...</p>}
    </div>
  )
}
