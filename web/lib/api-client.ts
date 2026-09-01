/**
 * Client-side auth + fetch helpers (prengine pattern).
 *
 * Login goes straight to ORC: POST /api/v1/auth with email+password
 * returns a token which is stored in localStorage and attached to every
 * subsequent API call as `Authorization: Bearer <token>`.
 */

const ORC_AUTH_URL = "https://orca.distark.com/api/v1/auth"
const ORC_ME_URL = "https://orca.distark.com/api/v1/me.json"

const TOKEN_KEY = "distark_token"
const USER_KEY = "distark_user"

export interface User {
  id: number
  email: string
  name: string
  roles: string[]
}

/** Login with email + password via ORC. Returns true on success. */
export async function login(email: string, password: string): Promise<boolean> {
  try {
    const formData = new URLSearchParams()
    formData.append("email", email)
    formData.append("password", password)

    const response = await fetch(ORC_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData,
    })

    if (!response.ok) return false

    const data = await response.json()
    if (!data.token) return false

    localStorage.setItem(TOKEN_KEY, data.token)
    document.cookie = `distark_token=${data.token}; domain=.distark.com; path=/; SameSite=Lax; Secure`

    // Fetch user profile so the UI can show who's logged in
    try {
      const userRes = await fetch(ORC_ME_URL, {
        headers: { Accept: "application/json", Authorization: `Bearer ${data.token}` },
      })
      if (userRes.ok) {
        const userData = await userRes.json()
        const user: User = {
          id: userData.id,
          email: userData.email || email,
          name: userData.name || userData.email?.split("@")[0] || "User",
          roles: Array.isArray(userData.roles) ? userData.roles : [],
        }
        localStorage.setItem(USER_KEY, JSON.stringify(user))
        return true
      }
    } catch {
      // Profile fetch is non-fatal; token is what matters
    }

    localStorage.setItem(
      USER_KEY,
      JSON.stringify({ id: 0, email, name: email.split("@")[0], roles: [] } as User)
    )
    return true
  } catch {
    return false
  }
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  document.cookie = "distark_token=; domain=.distark.com; path=/; max-age=0"
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Fetch wrapper that attaches the stored Bearer token. */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url, { ...options, headers })
}
