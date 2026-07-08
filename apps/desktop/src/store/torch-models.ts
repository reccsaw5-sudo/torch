import { atom } from 'nanostores'

import { setModelAssignment } from '@/hermes'

import { $torchLogin } from './torch-login'

// Torch-native model catalog: the branded client only ever offers the models
// the admin console publishes via the metering proxy (`GET /v1/models`). No
// upstream Hermes provider universe is surfaced.
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

// Fetch the enabled model catalog from the metering proxy using the logged-in
// session's key. Safe to call repeatedly (e.g. every dropdown open).
export async function loadTorchModels(): Promise<string[]> {
  const session = $torchLogin.get().session
  if (!session) {
    $torchModels.set([])
    $torchModelsLoaded.set(true)
    return []
  }
  try {
    const res = await fetch(`${session.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${session.apiKey}` }
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

// Persist a model as the profile default, routed through the metering proxy
// (provider=custom + proxy base_url/key). Mirrors the login-time assignment so
// the choice survives restarts and applies to new conversations.
export async function applyTorchModel(model: string) {
  const session = $torchLogin.get().session
  if (!session) {
    return
  }
  await setModelAssignment({
    scope: 'main',
    provider: 'custom',
    model,
    base_url: session.baseUrl,
    api_key: session.apiKey
  })
  writeSelectedTorchModel(model)
}
