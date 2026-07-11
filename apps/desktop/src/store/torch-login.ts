import { atom } from 'nanostores'

import { getActiveTorchKey } from './torch-api-keys'
import { $torchBrand, loadTorchBrand } from './torch-brand'
import { applyTorchModelAssignment, torchModelsUrl } from './torch-routing'

// The brand account server (business backend: login + account management).
// Baked into the branded client; override at build time with VITE_TORCH_SERVER.
const ENV = import.meta.env as Record<string, string | undefined>
const SERVER = (ENV.VITE_TORCH_SERVER ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const SESSION_KEY = 'torch_client_session'

/** Brand account server root (login + account management API). */
export function torchServerBase(): string {
  return SERVER
}

export interface TorchSession {
  // Account token from /auth/*, used only for /account/* management calls.
  // Inference no longer flows through the brand server — it goes straight to
  // the built-in endpoint (brand.api_base_url) with the user's own key.
  apiKey: string
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
    const res = await fetch(torchModelsUrl(baseUrl), { headers: { Authorization: `Bearer ${apiKey}` } })
    const data = (await res.json()) as { data?: { id: string }[] }
    const ids = (data.data ?? []).map(m => m.id).filter(Boolean)

    if (saved && ids.includes(saved)) {
      return saved
    }

    if (ids[0]) {
      return ids[0]
    }
  } catch {
    // Keep the saved model if the catalog can't be read.
  }

  return saved
}

// Point Hermes' main model at the built-in gateway, routed to the model's
// native protocol (see torch-routing.ts) with the user's active key. Re-applied
// on every startup so the branded client survives any Hermes-side config reset.
// No-op until the brand's api_base_url is loaded AND the user has added at least
// one key.
export async function reapplyTorchModel() {
  await loadTorchBrand()
  const base = $torchBrand.get().apiBaseUrl
  const key = getActiveTorchKey()

  if (!base || !key) {
    return
  }

  const model = await resolveModel(base, key)

  if (!model) {
    return
  }

  await applyTorchModelAssignment(model, base, key)
}

async function configure(result: AuthResult, onDone?: () => void) {
  patch({ status: 'configuring' })

  const session: TorchSession = {
    apiKey: result.api_key ?? '',
    username: result.user?.username ?? '',
    email: result.user?.email ?? ''
  }

  writeSession(session)

  // Best-effort: wire the model if a key is already configured. New users add
  // their key in Settings, which re-applies then.
  await reapplyTorchModel().catch(() => {})

  patch({ session, status: 'idle', error: null })
  onDone?.()
}

// On startup: validate the stored session against the server. An invalid key
// (e.g. the account was removed) clears the session so the login gate shows;
// a valid session refreshes the username/email and re-applies the model.
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
      const data = (await res.json()) as { user?: { username?: string; email?: string } }

      const updated: TorchSession = {
        ...session,
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
    await reapplyTorchModel()
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

// --- WeChat 订阅号登录 (关注 + 发送 6 位验证码) ------------------------------
// The flow is server-mediated: the client asks for a login session (state +
// 6-digit code + the account's follow-QR), shows both, then polls until the
// user follows the account and sends the code to it — the server's message
// webhook resolves that into a Torch session. All endpoints degrade gracefully
// (enabled:false / thrown error) until the brand server has the 订阅号
// configured.

export interface WechatLoginSession {
  state: string
  code?: string
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

export interface AccountInfo {
  user: { username: string; email: string }
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
