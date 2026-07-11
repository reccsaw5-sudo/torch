import { atom } from 'nanostores'

import { getActiveTorchKey } from './torch-api-keys'
import { TORCH_INFERENCE_BASE } from './torch-brand'
import { applyTorchModelAssignment, torchModelsUrl } from './torch-routing'

// Torch model catalog: the branded client points Hermes' main model at the
// built-in gateway (TORCH_INFERENCE_BASE, the domain root of a self-hosted
// new-api, baked into the client). The catalog is fetched directly from
// `{root}/v1/models` using the user's own API key — no business-server hop —
// then the chosen model is routed to its native protocol (see torch-routing.ts).
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
  const base = TORCH_INFERENCE_BASE
  const key = getActiveTorchKey()

  if (!base || !key) {
    $torchModels.set([])
    $torchModelsLoaded.set(true)
    return []
  }

  try {
    const res = await fetch(torchModelsUrl(base), {
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

// Persist a model as the profile default, routed through the built-in gateway
// to the model's native protocol (see torch-routing.ts) with the active user
// key. Mirrors the login-time assignment so the choice survives restarts and
// applies to new conversations.
export async function applyTorchModel(model: string) {
  const base = TORCH_INFERENCE_BASE
  const key = getActiveTorchKey()

  if (!base || !key) {
    return
  }

  await applyTorchModelAssignment(model, base, key)
  writeSelectedTorchModel(model)
}
