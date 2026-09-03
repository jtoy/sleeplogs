"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { login, logout, getStoredUser, getToken, authenticatedFetch, type User } from "../lib/api-client"
import { randomHealthQuote } from "../lib/quotes"
import { computeStreaks } from "../lib/streaks"

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
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [user, setUser] = useState<User | null>(null)
  const [columns, setColumns] = useState<Column[]>([])
  const [allColumns, setAllColumns] = useState<Column[]>([])
  const [logs, setLogs] = useState<SleepLog[]>([])
  const [error, setError] = useState("")
  const [copyMsg, setCopyMsg] = useState("")
  const [loading, setLoading] = useState(false)

  // Random health quote, picked once per page load
  const [quote] = useState(() => randomHealthQuote())

  // Streaks (rating >= 4 nights)
  const streaks = useMemo(() => computeStreaks(logs), [logs])

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = getStoredUser()
    if (stored) {
      setUser(stored)
      setEmail(stored.email)
    }
  }, [])

  // Fetch data when logged in
  useEffect(() => {
    if (!user) return
    fetchData()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchData() {
    setLoading(true)
    setError("")
    try {
      const [colRes, logRes, allColRes] = await Promise.all([
        authenticatedFetch("/api/columns"),
        authenticatedFetch("/api/logs"),
        authenticatedFetch("/api/columns?all=1"),
      ])

      if (!colRes.ok || !logRes.ok) {
        if (colRes.status === 401 || logRes.status === 401) {
          setError("Session expired — please log in again")
          logout()
          setUser(null)
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
    if (!email.trim() || !password) return
    setLoading(true)
    setError("")

    const ok = await login(email.trim(), password)
    if (ok) {
      setUser(getStoredUser())
      setPassword("")
    } else {
      setError("Invalid email or password")
    }
    setLoading(false)
  }

  function handleLogout() {
    logout()
    setUser(null)
    setColumns([])
    setLogs([])
    setAllColumns([])
  }

  async function toggleColumn(key: string, currentEnabled: boolean) {
    await authenticatedFetch("/api/columns", {
      method: "PATCH",
      body: JSON.stringify({ key, enabled: !currentEnabled }),
    })
    fetchData()
  }

  /** Move a column up/down by swapping sort_order with its neighbor. */
  async function moveColumn(key: string, dir: -1 | 1) {
    const sorted = [...allColumns].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex((c) => c.key === key)
    const neighbor = sorted[idx + dir]
    if (idx === -1 || !neighbor) return
    // Swap sort_orders with two PATCHes.
    const a = sorted[idx]
    const b = neighbor
    await Promise.all([
      authenticatedFetch("/api/columns", {
        method: "PATCH",
        body: JSON.stringify({ key: a.key, sort_order: b.sort_order }),
      }),
      authenticatedFetch("/api/columns", {
        method: "PATCH",
        body: JSON.stringify({ key: b.key, sort_order: a.sort_order }),
      }),
    ])
    fetchData()
  }

  async function deleteColumn(key: string) {
    if (!confirm(`Remove column \"${key}\"? Its data stays in the DB.`)) return
    await authenticatedFetch(`/api/columns?key=${encodeURIComponent(key)}`, { method: "DELETE" })
    fetchData()
  }

  // ─── Add/Edit log form state ────────────────────────────────
  const [editor, setEditor] = useState<{ night: string; values: Record<string, string>; editing: SleepLog | null } | null>(null)

  function openAddLog() {
    const values: Record<string, string> = {}
    for (const c of columns) {
      values[c.key] = c.default_value ?? (c.field_type === "bool" ? "false" : "")
      if (values[c.key] === null) values[c.key] = ""
    }
    setEditor({ night: new Date().toISOString().slice(0, 10), values, editing: null })
  }

  function openEditLog(log: SleepLog) {
    const values: Record<string, string> = {}
    for (const c of columns) {
      const v = log.data[c.key]
      values[c.key] = v === undefined || v === null ? "" : String(v)
    }
    setEditor({ night: String(log.night_of).slice(0, 10), values, editing: log })
  }

  function setEditorValue(key: string, v: string) {
    setEditor((prev) => (prev ? { ...prev, values: { ...prev.values, [key]: v } } : prev))
  }

  async function saveEditor(e: React.FormEvent) {
    e.preventDefault()
    if (!editor || !editor.night) return
    const data: Record<string, unknown> = {}
    for (const c of columns) {
      const raw = (editor.values[c.key] ?? "").trim()
      if (c.field_type === "bool") {
        data[c.key] = raw === "true" || raw === "1" || raw === "yes"
      } else if (c.field_type === "int" || c.field_type === "rating") {
        data[c.key] = raw === "" ? null : Number(raw)
      } else {
        data[c.key] = raw
      }
    }
    // Merge with any existing data so columns that are currently disabled/not
    // in the form keep their stored values (server also merges on conflict).
    if (editor.editing) {
      for (const key of Object.keys(editor.editing.data)) {
        if (data[key] === undefined) data[key] = editor.editing.data[key]
      }
    }
    await authenticatedFetch("/api/write_log", {
      method: "POST",
      body: JSON.stringify({ night_of: editor.night, data }),
    })
    setEditor(null)
    fetchData()
  }

  async function deleteLog(log: SleepLog) {
    if (!confirm(`Delete the log for ${String(log.night_of).slice(0, 10)}?`)) return
    await authenticatedFetch(`/api/logs?night_of=${encodeURIComponent(String(log.night_of).slice(0, 10))}`, { method: "DELETE" })
    fetchData()
  }

  // ─── Add column form state ─────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false)
  const [showColumnsPanel, setShowColumnsPanel] = useState(false)
  const [newCol, setNewCol] = useState({
    key: "",
    label: "",
    field_type: "int",
    min_value: "",
    max_value: "",
    default_value: "",
  })

  async function addColumn(e: React.FormEvent) {
    e.preventDefault()
    if (!newCol.key.trim() || !newCol.label.trim()) return
    await authenticatedFetch("/api/columns", {
      method: "POST",
      body: JSON.stringify({
        key: newCol.key.trim(),
        label: newCol.label.trim(),
        field_type: newCol.field_type,
        min_value: newCol.min_value === "" ? null : Number(newCol.min_value),
        max_value: newCol.max_value === "" ? null : Number(newCol.max_value),
        default_value: newCol.default_value === "" ? null : newCol.default_value,
      }),
    })
    setShowAddForm(false)
    setNewCol({ key: "", label: "", field_type: "int", min_value: "", max_value: "", default_value: "" })
    fetchData()
  }

  function formatValue(val: unknown, fieldType: string): string {
    if (val === null || val === undefined) return "—"
    if (fieldType === "bool") return val ? "Yes" : "No"
    return String(val)
  }

  function copyTokenForWatch() {
    const token = getToken()
    if (!token) return
    navigator.clipboard.writeText(token).then(() => {
      setCopyMsg("Copied! Paste into watch settings")
      setTimeout(() => setCopyMsg(""), 3000)
    })
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

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-lg shadow-md w-96">
          <h1 className="text-2xl font-bold mb-2">SleepLogs</h1>
          <p className="text-green-800 italic text-sm mb-6">"{quote}"</p>
          <label className="block text-sm font-medium mb-2">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2 mb-4"
            placeholder="you@distark.com"
            autoComplete="email"
          />
          <label className="block text-sm font-medium mb-2">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2 mb-4"
            placeholder="••••••••"
            autoComplete="current-password"
          />
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    )
  }

  // ─── Dashboard ─────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">SleepLogs</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={copyTokenForWatch} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm" title="Copy your ORC token for the watch app's settings">Get Watch Token</button>
          {copyMsg && <span className="text-xs text-green-600 self-center">{copyMsg}</span>}
          <button onClick={exportCSV} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm">
            Export CSV
          </button>
          <button onClick={handleLogout} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm">
            Logout
          </button>
        </div>
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {/* Inspirational quote */}
      <div className="bg-gradient-to-r from-green-50 to-teal-50 border border-green-100 rounded-lg p-4 mb-6 text-center">
        <p className="text-green-800 italic text-lg">"{quote}"</p>
      </div>

      {/* Streaks (rating 4+ nights) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-3xl font-bold text-orange-500">🔥 {streaks.current}</div>
          <div className="text-xs text-gray-500 mt-1">
            Current streak
            {streaks.current === 0 && logs.length > 0 && (
              <span className="block text-gray-400">log a 4+ night to restart</span>
            )}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-3xl font-bold text-green-600">🏆 {streaks.longest}</div>
          <div className="text-xs text-gray-500 mt-1">
            Longest streak
            {streaks.longestStart && (
              <span className="block text-gray-400">{streaks.longestStart} → {streaks.longestEnd}</span>
            )}
          </div>
        </div>
      </div>

      {/* Column Manager — collapsed by default, expand on demand */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-center justify-between">
          <button onClick={() => setShowColumnsPanel(!showColumnsPanel)} className="text-sm font-semibold text-gray-500 hover:text-gray-700">
            {showColumnsPanel ? "▾" : "▸"} COLUMNS
            <span className="text-gray-400 font-normal"> ({" "}{allColumns.filter((c) => c.enabled !== false).length}/{allColumns.length} active)</span>
          </button>
          {showColumnsPanel && (
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            >
              {showAddForm ? "Cancel" : "+ Add Column"}
            </button>
          )}
        </div>

        {showColumnsPanel && (<>
        {/* Add column form */}
        {showAddForm && (
          <form onSubmit={addColumn} className="border rounded p-3 mb-3 bg-gray-50 grid gap-2 md:grid-cols-6">
            <input value={newCol.key} onChange={(e) => setNewCol({ ...newCol, key: e.target.value })}
              placeholder="key (e.g. stress_level)" className="border rounded px-2 py-1 text-sm" />
            <input value={newCol.label} onChange={(e) => setNewCol({ ...newCol, label: e.target.value })}
              placeholder="Label" className="border rounded px-2 py-1 text-sm" />
            <select value={newCol.field_type} onChange={(e) => setNewCol({ ...newCol, field_type: e.target.value })}
              className="border rounded px-2 py-1 text-sm">
              <option value="int">int</option>
              <option value="rating">rating</option>
              <option value="bool">bool</option>
              <option value="text">text</option>
            </select>
            <input value={newCol.min_value} onChange={(e) => setNewCol({ ...newCol, min_value: e.target.value })}
              placeholder="min" className="border rounded px-2 py-1 text-sm" />
            <input value={newCol.max_value} onChange={(e) => setNewCol({ ...newCol, max_value: e.target.value })}
              placeholder="max" className="border rounded px-2 py-1 text-sm" />
            <button type="submit" className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm">Add</button>
          </form>
        )}

        {/* Column list (sorted) */}
        <div className="space-y-1">
          {[...allColumns].sort((a, b) => a.sort_order - b.sort_order).map((col, i) => (
            <div key={col.key} className="flex items-center gap-2 text-sm p-1 rounded hover:bg-gray-50">
              <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
              <input
                type="checkbox"
                checked={col.enabled !== false}
                onChange={() => toggleColumn(col.key, col.enabled !== false)}
                className="rounded"
                title="show/hide on watch"
              />
              <span className="font-medium min-w-0 truncate">{col.label}</span>
              <span className="text-gray-400 text-xs">{col.field_type}</span>
              <label className="flex items-center gap-1 text-xs text-gray-500">
                <span title="Value the watch pre-fills on this question">default</span>
                <input
                  key={col.key + "::" + (col.default_value ?? "")}
                  defaultValue={col.default_value ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v === (col.default_value ?? "")) return
                    authenticatedFetch("/api/columns", {
                      method: "PATCH",
                      body: JSON.stringify({ key: col.key, default_value: v === "" ? null : v }),
                    }).then(fetchData)
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                  placeholder={col.field_type === "bool" ? "true/false" : col.field_type === "text" ? "text" : "e.g. 400"}
                  title="Type a value, then click/tap away or press Enter to save"
                  className="w-20 border rounded px-1 py-0.5 text-xs text-center"
                />
              </label>
              <span className="flex-1" />
              <button onClick={() => moveColumn(col.key, -1)} disabled={i === 0}
                className="px-2 py-0.5 border rounded hover:bg-gray-100 disabled:opacity-30" title="Move up">↑</button>
              <button onClick={() => moveColumn(col.key, 1)} disabled={i === allColumns.length - 1}
                className="px-2 py-0.5 border rounded hover:bg-gray-100 disabled:opacity-30" title="Move down">↓</button>
              <button onClick={() => deleteColumn(col.key)}
                className="px-2 py-0.5 border rounded text-red-600 hover:bg-red-50" title="Delete column">🗑</button>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-2">Reordering and toggles apply to the watch on its next app open. Deleting keeps old data in the DB. Type into a column's <span className="font-mono">default</span> box to set the value the watch pre-fills (numbers for int/rating, true/false for bool, any text for text fields).</p>
        </>)}
      </div>

      {/* Logs Table */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-500">LOGS</h2>
        <button onClick={openAddLog} className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">+ Add Log</button>
      </div>

      {/* Add/Edit log form */}
      {editor && (
        <form onSubmit={saveEditor} className="bg-white rounded-lg shadow p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">{editor.editing ? `Edit log for ${editor.night}` : "Add log"}</h3>
            <button type="button" onClick={() => setEditor(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="block text-xs font-medium text-gray-600">
              Night of
              <input type="date" required value={editor.night} onChange={(e) => setEditor({ ...editor, night: e.target.value })}
                className="block w-full border rounded px-2 py-1 text-sm mt-1" />
            </label>
            {columns.map((c) => (
              <label key={c.key} className="block text-xs font-medium text-gray-600">
                {c.label}
                {c.field_type === "bool" ? (
                  <select value={editor.values[c.key] ?? "false"} onChange={(e) => setEditorValue(c.key, e.target.value)}
                    className="block w-full border rounded px-2 py-1 text-sm mt-1">
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                ) : c.field_type === "rating" ? (
                  <select value={editor.values[c.key] ?? ""} onChange={(e) => setEditorValue(c.key, e.target.value)}
                    className="block w-full border rounded px-2 py-1 text-sm mt-1">
                    {["", ...Array.from({ length: 5 }, (_, i) => String(i + 1))].map((v) => (
                      <option key={v} value={v}>{v === "" ? "—" : v}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={c.field_type === "int" ? "number" : "text"}
                    value={editor.values[c.key] ?? ""}
                    onChange={(e) => setEditorValue(c.key, e.target.value)}
                    min={c.field_type === "int" ? c.min_value ?? undefined : undefined}
                    max={c.field_type === "int" ? c.max_value ?? undefined : undefined}
                    className="block w-full border rounded px-2 py-1 text-sm mt-1"
                  />
                )}
              </label>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm">Save</button>
            <button type="button" onClick={() => setEditor(null)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left font-semibold">Night Of</th>
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3 text-left font-semibold">{col.label}</th>
              ))}
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="px-4 py-8 text-center text-gray-400">
                  No logs yet. Submit from your watch, or add one above.
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{String(log.night_of).slice(0, 10)}</td>
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    {formatValue(log.data[col.key], col.field_type)}
                  </td>
                ))}
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => openEditLog(log)} className="px-2 py-1 border rounded hover:bg-gray-100 text-xs mr-1">Edit</button>
                  <button onClick={() => deleteLog(log)} className="px-2 py-1 border rounded text-red-600 hover:bg-red-50 text-xs">Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && <p className="text-center text-gray-400 mt-4">Loading...</p>}
    </div>
  )
}
