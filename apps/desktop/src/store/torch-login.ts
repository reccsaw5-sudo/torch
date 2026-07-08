import { atom } from 'nanostores'

import { setModelAssignment } from '@/hermes'

// The brand server (business backend + metering proxy). Baked into the branded
// client; override at build time with VITE_TORCH_SERVER.
const ENV = import.meta.env as Record<string, string | undefined>
const SERVER = (ENV.VITE_TORCH_SERVER ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const SESSION_KEY = 'torch_client_session'

/** Brand-server root (business API), i.e. the inference base without `/v1`. */
export function torchServerBase(): string {
  const session = $torchLogin.get().session

  if (session?.baseUrl) {
    return session.baseUrl.replace(/\/v1\/?$/, '')
  }

  return SERVER
}

export interface TorchSession {
  apiKey: string
  baseUrl: string
  credits: number
  username: string
  email: string
}

export type TorchLoginStatus = 'idle' | 'submitting' | 'configuring' | 'error'

export interface TorchLoginState {
  session: null | TorchSession
  status: TorchLoginStatus
  error: null | string
}

function readSession(): null | TorchSession {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)

    return raw ? (JSON.parse(raw) as TorchSession) : null
  } catch {
    return null
  }
}

function writeSession(session: null | TorchSession) {
  try {
    if (session) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } else {
      window.localStorage.removeItem(SESSION_KEY)
    }
  } catch {
    // localStorage unavailable — degrade silently.
  }
}

export const $torchLogin = atom<TorchLoginState>({
  session: readSession(),
  status: 'idle',
  error: null
})

const patch = (update: Partial<TorchLoginState>) => $torchLogin.set({ ...$torchLogin.get(), ...update })

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface AuthResult {
  api_key: string
  base_url: string
  credits: number
  user?: { username?: string; email?: string }
}

async function resolveModel(baseUrl: string, apiKey: string): Promise<string> {
  // Honor a previously chosen model (torch-models.ts writes this key) so a
  // user's pick survives restarts; otherwise fall back to the first catalog
  // entry. Read inline to avoid a torch-login <-> torch-models import cycle.
  let saved = ''

  try {
    saved = window.localStorage.getItem('torch_selected_model') ?? ''
  } catch {
    // localStorage unavailable — ignore.
  }

  try {
    const res = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
    const data = (await res.json()) as { data?: { id: string }[] }
    const ids = (data.data ?? []).map(m => m.id).filter(Boolean)

    if (saved && ids.includes(saved)) {
      return saved
    }

    if (ids[0]) {
      return ids[0]
    }
  } catch {
    // Keep the default model if the catalog can't be read.
  }

  return 'torch-mock'
}

// Point Hermes' main model at the metering proxy (provider=custom, same wiring
// as the local-endpoint path). Re-applied on every startup so the branded
// client survives any Hermes-side config reset.
async function applyModel(baseUrl: string, apiKey: string) {
  const model = await resolveModel(baseUrl, apiKey)
  await setModelAssignment({ scope: 'main', provider: 'custom', model, base_url: baseUrl, api_key: apiKey })
}

async function configure(result: AuthResult, onDone?: () => void) {
  patch({ status: 'configuring' })
  const baseUrl = result.base_url ?? ''
  const apiKey = result.api_key ?? ''

  await applyModel(baseUrl, apiKey)

  const session: TorchSession = {
    apiKey,
    baseUrl,
    credits: result.credits ?? 0,
    username: result.user?.username ?? '',
    email: result.user?.email ?? ''
  }

  writeSession(session)
  patch({ session, status: 'idle', error: null })
  onDone?.()
}

// On startup: validate the stored session against the server. An invalid key
// (e.g. the account was removed) clears the session so the login gate shows;
// a valid key refreshes credits and re-points the model at the proxy.
export async function restoreTorchSession(onDone?: () => void) {
  const session = $torchLogin.get().session

  if (!session) {
    return
  }

  try {
    const res = await fetch(`${SERVER}/account/info`, { headers: { Authorization: `Bearer ${session.apiKey}` } })

    if (res.status === 401 || res.status === 404) {
      logoutTorch()

      return
    }

    if (res.ok) {
      const data = (await res.json()) as { credits?: number; user?: { username?: string; email?: string } }

      const updated: TorchSession = {
        ...session,
        credits: data.credits ?? session.credits,
        username: data.user?.username ?? session.username,
        email: data.user?.email ?? session.email
      }

      writeSession(updated)
      patch({ session: updated })
    }
  } catch {
    // Server unreachable — keep the session and still try to re-apply below.
  }

  try {
    await applyModel(session.baseUrl, session.apiKey)
    onDone?.()
  } catch {
    // Gateway not ready yet — a later restore attempt will re-apply.
  }
}

async function submit(path: '/auth/login' | '/auth/register', body: Record<string, string>, onDone?: () => void) {
  patch({ status: 'submitting', error: null })

  try {
    const res = await fetch(`${SERVER}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    const data = (await res.json().catch(() => ({}))) as AuthResult & { detail?: string }

    if (!res.ok) {
      patch({ status: 'error', error: data.detail || `请求失败 (${res.status})` })

      return
    }

    await configure(data, onDone)
  } catch (e) {
    patch({ status: 'error', error: `无法连接服务器：${errMessage(e)}` })
  }
}

export function loginTorch(email: string, password: string, onDone?: () => void) {
  return submit('/auth/login', { email, password }, onDone)
}

export function registerTorch(email: string, password: string, onDone?: () => void) {
  return submit('/auth/register', { email, password }, onDone)
}

export function logoutTorch() {
  writeSession(null)
  patch({ session: null, status: 'idle', error: null })
}

// --- WeChat scan-to-login (微信扫码登录) -----------------------------------
// The QR flow is server-mediated: the client asks for a login session (state +
// authorize URL / QR), shows the QR, then polls until the server-side OAuth2
// callback resolves the scan into a Torch session. All endpoints degrade
// gracefully (enabled:false / thrown error) until the brand server has WeChat
// Open-Platform credentials configured.

export interface WechatLoginSession {
  state: string
  authorize_url?: string
  qr_image?: string
}

export interface WechatPollResult {
  status: 'done' | 'expired' | 'pending'
  result?: AuthResult
}

export async function fetchWechatLoginConfig(): Promise<{ enabled: boolean }> {
  try {
    const res = await fetch(`${SERVER}/auth/wechat/config`)

    if (!res.ok) {
      return { enabled: false }
    }

    const data = (await res.json()) as { enabled?: boolean }

    return { enabled: Boolean(data.enabled) }
  } catch {
    return { enabled: false }
  }
}

export async function createWechatLoginSession(): Promise<WechatLoginSession> {
  const res = await fetch(`${SERVER}/auth/wechat/qr`, { method: 'POST' })

  if (!res.ok) {
    throw new Error(`无法创建微信登录会话 (${res.status})`)
  }

  return (await res.json()) as WechatLoginSession
}

export async function pollWechatLogin(state: string): Promise<WechatPollResult> {
  try {
    const res = await fetch(`${SERVER}/auth/wechat/poll/${encodeURIComponent(state)}`)

    if (!res.ok) {
      return { status: 'expired' }
    }

    return (await res.json()) as WechatPollResult
  } catch {
    return { status: 'pending' }
  }
}

export async function completeWechatLogin(result: AuthResult, onDone?: () => void) {
  await configure(result, onDone)
}

// Lightweight credits/username refresh (no model re-apply) — used by the
// account rail on mount and right after a successful top-up.
export async function refreshTorchCredits() {
  const session = $torchLogin.get().session

  if (!session) {
    return
  }

  try {
    const res = await fetch(`${SERVER}/account/info`, {
      headers: { Authorization: `Bearer ${session.apiKey}` }
    })

    if (!res.ok) {
      return
    }

    const data = (await res.json()) as { credits?: number; user?: { username?: string; email?: string } }

    const updated: TorchSession = {
      ...session,
      credits: data.credits ?? session.credits,
      username: data.user?.username ?? session.username,
      email: data.user?.email ?? session.email
    }

    writeSession(updated)
    patch({ session: updated })
  } catch {
    // Server unreachable — keep the cached values.
  }
}

export interface LedgerEntry {
  delta: number
  reason: string
  created_at: number
}

export interface AccountInfo {
  user: { username: string; email: string }
  credits: number
  ledger: LedgerEntry[]
}

async function accountError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: unknown }

    if (typeof data.detail === 'string') {
      return data.detail
    }
  } catch {
    // non-JSON error body
  }

  return `请求失败 (${res.status})`
}

export async function fetchAccountInfo(): Promise<AccountInfo> {
  const session = $torchLogin.get().session

  if (!session) {
    throw new Error('未登录')
  }

  const res = await fetch(`${SERVER}/account/info`, { headers: { Authorization: `Bearer ${session.apiKey}` } })

  if (!res.ok) {
    throw new Error(await accountError(res))
  }

  return (await res.json()) as AccountInfo
}

export async function changeTorchPassword(oldPassword: string, newPassword: string): Promise<void> {
  const session = $torchLogin.get().session

  if (!session) {
    throw new Error('未登录')
  }

  const res = await fetch(`${SERVER}/account/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.apiKey}` },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
  })

  if (!res.ok) {
    throw new Error(await accountError(res))
  }
}

export async function changeTorchUsername(username: string): Promise<void> {
  const session = $torchLogin.get().session

  if (!session) {
    throw new Error('未登录')
  }

  const res = await fetch(`${SERVER}/account/username`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.apiKey}` },
    body: JSON.stringify({ username })
  })

  if (!res.ok) {
    throw new Error(await accountError(res))
  }

  const updated: TorchSession = { ...session, username: username.trim() }

  writeSession(updated)
  patch({ session: updated })
}
