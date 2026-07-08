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

export interface ModelRow {
  id: number
  model: string
  upstream_base_url: string
  upstream_model: string | null
  upstream_api_key: string
  price: number
  enabled: number
  created_at: number
}

export interface UserRow {
  id: number
  username: string
  email: string
  balance: number
  created_at: number
}

export interface ModelUpsert {
  model: string
  upstream_base_url: string
  upstream_model?: string
  upstream_api_key?: string
  price: number
  enabled: boolean
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

export interface PackageRow {
  id: number
  title: string
  amount_fen: number
  credits: number
  sort_order: number
  enabled: number
}

export interface PackageUpsert {
  id?: number
  title: string
  amount_fen: number
  credits: number
  sort_order: number
  enabled: number
}

export interface OrderRow {
  id: number
  out_trade_no: string
  user_id: number
  email: string
  provider: string
  amount_fen: number
  credits: number
  status: string
  transaction_id: string
  created_at: number
  paid_at: number | null
}

export const api = {
  // Validate the admin token by hitting a gated endpoint.
  verifyToken: () => req<{ data: UserRow[] }>('GET', '/admin/users'),

  listModels: () => req<{ data: ModelRow[] }>('GET', '/admin/models'),
  upsertModel: (m: ModelUpsert) => req<{ status: string }>('POST', '/admin/models', m),
  deleteModel: (id: number) => req<{ status: string }>('DELETE', `/admin/models/${id}`),

  listUsers: () => req<{ data: UserRow[] }>('GET', '/admin/users'),
  adjustCredits: (userId: number, delta: number, reason: string) =>
    req<{ status: string; balance: number }>('POST', `/admin/users/${userId}/credits`, { delta, reason }),

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

  getPayment: () => req<Record<string, string>>('GET', '/admin/payment'),
  setPayment: (patch: Record<string, string>) => req<Record<string, string>>('POST', '/admin/payment', patch),

  getWechat: () => req<Record<string, string>>('GET', '/admin/wechat'),
  setWechat: (patch: Record<string, string>) => req<Record<string, string>>('POST', '/admin/wechat', patch),

  listPackages: () => req<{ data: PackageRow[] }>('GET', '/admin/packages'),
  upsertPackage: (p: PackageUpsert) => req<{ ok: boolean }>('POST', '/admin/packages', p),
  deletePackage: (id: number) => req<{ ok: boolean }>('DELETE', `/admin/packages/${id}`),

  listOrders: () => req<{ data: OrderRow[] }>('GET', '/admin/orders')
}
