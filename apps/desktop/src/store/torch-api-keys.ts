import { atom } from 'nanostores'

// User-supplied API keys for the brand's built-in inference endpoint
// (torch-brand.apiBaseUrl). Stored locally only — the brand server never sees
// them. The user can save several and pick which one is active; the active key
// is what gets wired into Hermes' main model (provider=custom).
const KEYS_KEY = 'torch_api_keys'
const ACTIVE_KEY = 'torch_api_key_active'

export interface TorchKeysState {
  keys: string[]
  activeIndex: number
}

function read(): TorchKeysState {
  try {
    const raw = window.localStorage.getItem(KEYS_KEY)
    const keys = raw ? (JSON.parse(raw) as string[]).filter(k => typeof k === 'string' && k) : []
    const ai = Number(window.localStorage.getItem(ACTIVE_KEY) ?? '0')
    const activeIndex = keys.length ? Math.min(Math.max(Number.isFinite(ai) ? ai : 0, 0), keys.length - 1) : 0
    return { keys, activeIndex }
  } catch {
    return { keys: [], activeIndex: 0 }
  }
}

function persist(state: TorchKeysState) {
  try {
    window.localStorage.setItem(KEYS_KEY, JSON.stringify(state.keys))
    window.localStorage.setItem(ACTIVE_KEY, String(state.activeIndex))
  } catch {
    // localStorage unavailable — degrade silently.
  }
}

export const $torchApiKeys = atom<TorchKeysState>(read())

function commit(state: TorchKeysState) {
  persist(state)
  $torchApiKeys.set(state)
}

export function addTorchKey(key: string) {
  const k = key.trim()
  if (!k) {
    return
  }
  const cur = $torchApiKeys.get()
  if (cur.keys.includes(k)) {
    return
  }
  const keys = [...cur.keys, k]
  // First key added becomes active.
  commit({ keys, activeIndex: cur.keys.length === 0 ? 0 : cur.activeIndex })
}

export function removeTorchKey(index: number) {
  const cur = $torchApiKeys.get()
  const keys = cur.keys.filter((_, i) => i !== index)
  let activeIndex = cur.activeIndex
  if (index < activeIndex) {
    activeIndex--
  }
  if (activeIndex >= keys.length) {
    activeIndex = Math.max(0, keys.length - 1)
  }
  commit({ keys, activeIndex })
}

export function setActiveTorchKey(index: number) {
  const cur = $torchApiKeys.get()
  if (index < 0 || index >= cur.keys.length) {
    return
  }
  commit({ ...cur, activeIndex: index })
}

/** The key Hermes should use right now (active, else the first, else ''). */
export function getActiveTorchKey(): string {
  const s = $torchApiKeys.get()
  return s.keys[s.activeIndex] ?? s.keys[0] ?? ''
}
