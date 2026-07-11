// Backend base. In dev, vite proxies /api -> http://127.0.0.1:8080 (see
// vite.config.ts). Override at build time with VITE_API_BASE if the admin UI
// is served from a different origin than the backend.
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

const TOKEN_KEY = 'torch_admin_token'

export function getToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // ignore
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': getToken()
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  if (!res.ok) {
    let detail = `${res.status}`
    try {
      const j = await res.json()
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j)
    } catch {
      // non-json error
    }
    throw new Error(detail)
  }

  return (await res.json()) as T
}

export interface UserRow {
  id: number
  username: string
  email: string
  created_at: number
}

export interface SuggestionRow {
  id: number
  title: string
  subtitle: string
  prompt: string
  sort_order: number
  enabled: number
}

export interface SuggestionUpsert {
  id?: number
  title: string
  subtitle: string
  prompt: string
  sort_order: number
  enabled: number
}

export interface SkillRow {
  id: number
  slug: string
  name: string
  description: string
  category: string
  content: string
  sort_order: number
  enabled: number
}

export interface SkillUpsert {
  id?: number
  slug: string
  name: string
  description: string
  category: string
  content: string
  sort_order: number
  enabled: number
}

export interface BuildRun {
  id: number
  status: string
  conclusion: string | null
  event: string
  created_at: string
  html_url: string
}

export interface BuildFile {
  platform: string
  name: string
  url: string
}

export const api = {
  // Validate the admin token by hitting a gated endpoint.
  verifyToken: () => req<{ data: UserRow[] }>('GET', '/admin/users'),

  listUsers: () => req<{ data: UserRow[] }>('GET', '/admin/users'),

  getBrand: () => req<Record<string, string>>('GET', '/admin/brand'),
  setBrand: (patch: Record<string, string>) => req<Record<string, string>>('POST', '/admin/brand', patch),
  uploadLogo: (content_type: string, data_base64: string) =>
    req<Record<string, string>>('POST', '/admin/brand/logo', { content_type, data_base64 }),

  listSuggestions: () => req<{ data: SuggestionRow[] }>('GET', '/admin/suggestions'),
  upsertSuggestion: (s: SuggestionUpsert) => req<{ ok: boolean }>('POST', '/admin/suggestions', s),
  deleteSuggestion: (id: number) => req<{ ok: boolean }>('DELETE', `/admin/suggestions/${id}`),

  listSkills: () => req<{ data: SkillRow[] }>('GET', '/admin/skills'),
  upsertSkill: (s: SkillUpsert) => req<{ ok: boolean }>('POST', '/admin/skills', s),
  deleteSkill: (id: number) => req<{ ok: boolean }>('DELETE', `/admin/skills/${id}`),

  getWechat: () => req<Record<string, string>>('GET', '/admin/wechat'),
  setWechat: (patch: Record<string, string>) => req<Record<string, string>>('POST', '/admin/wechat', patch),

  getBuildConfig: () => req<Record<string, string>>('GET', '/admin/build/config'),
  setBuildConfig: (patch: Record<string, string>) =>
    req<Record<string, string>>('POST', '/admin/build/config', patch),
  triggerBuild: (platforms: string[]) =>
    req<{ ok: boolean; platforms: string[] }>('POST', '/admin/build/trigger', { platforms }),
  getBuildStatus: () => req<{ configured: boolean; runs: BuildRun[] }>('GET', '/admin/build/status'),
  getBuildDownloads: () =>
    req<{ configured: boolean; files: BuildFile[]; note?: string; generated_at?: number }>(
      'GET',
      '/admin/build/downloads'
    )
}
