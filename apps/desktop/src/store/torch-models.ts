import { atom } from 'nanostores'

import { setModelAssignment } from '@/hermes'

import { getActiveTorchKey } from './torch-api-keys'
import { $torchBrand, loadTorchBrand } from './torch-brand'

// Torch model catalog: the branded client points Hermes' main model at the
// admin-configured built-in inference endpoint (brand.api_base_url, an
// OpenAI-compatible base). The catalog is fetched from `${base}/models` using
// the user's own API key — no upstream Hermes provider universe is surfaced.
const SELECTED_KEY = 'torch_selected_model'

export const $torchModels = atom<string[]>([])
export const $torchModelsLoaded = atom(false)

export function readSelectedTorchModel(): string {
  try {
    return window.localStorage.getItem(SELECTED_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeSelectedTorchModel(model: string) {
  try {
    window.localStorage.setItem(SELECTED_KEY, model)
  } catch {
    // localStorage unavailable — degrade silently.
  }
}

// Fetch the model catalog from the built-in endpoint using the active user key.
// Safe to call repeatedly (e.g. every dropdown open).
export async function loadTorchModels(): Promise<string[]> {
  await loadTorchBrand()
  const base = $torchBrand.get().apiBaseUrl
  const key = getActiveTorchKey()

  if (!base || !key) {
    $torchModels.set([])
    $torchModelsLoaded.set(true)
    return []
  }

  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` }
    })
    const data = (await res.json()) as { data?: { id: string }[] }
    const ids = (data.data ?? []).map(m => m.id).filter(Boolean)
    $torchModels.set(ids)
    $torchModelsLoaded.set(true)
    return ids
  } catch {
    $torchModelsLoaded.set(true)
    return $torchModels.get()
  }
}

// Persist a model as the profile default, routed through the built-in endpoint
// (provider=custom + brand base_url + active user key). Mirrors the login-time
// assignment so the choice survives restarts and applies to new conversations.
export async function applyTorchModel(model: string) {
  const base = $torchBrand.get().apiBaseUrl
  const key = getActiveTorchKey()

  if (!base || !key) {
    return
  }

  await setModelAssignment({
    scope: 'main',
    provider: 'custom',
    model,
    base_url: base,
    api_key: key
  })
  writeSelectedTorchModel(model)
}
