import { atom } from 'nanostores'

const ENV = import.meta.env as Record<string, string | undefined>
export const TORCH_SERVER = (ENV.VITE_TORCH_SERVER ?? 'http://127.0.0.1:8080').replace(/\/$/, '')

// Built-in inference gateway (new-api) domain root — baked into the client at
// build time. Model listing + inference talk to it directly, so the model
// path never depends on the business server. Override at build time with
// VITE_TORCH_INFERENCE_BASE; change requires a repackage.
export const TORCH_INFERENCE_BASE = (ENV.VITE_TORCH_INFERENCE_BASE ?? 'https://torchai.ai').replace(/\/+$/, '')

export interface TorchBrand {
  displayName: string
  iconUrl: string
  primaryColor: string
  /** Built-in inference base URL (new-api domain root). Baked into the client
   *  (TORCH_INFERENCE_BASE) — the user only supplies their own API key(s). */
  apiBaseUrl: string
  loaded: boolean
}

export const $torchBrand = atom<TorchBrand>({
  displayName: 'Torch',
  iconUrl: '',
  primaryColor: '#2563eb',
  apiBaseUrl: TORCH_INFERENCE_BASE,
  loaded: false
})

let started = false

// Fetch the brand config once. Cheap and safe to call from multiple mounts.
export async function loadTorchBrand() {
  if (started) {
    return
  }
  started = true
  try {
    const res = await fetch(`${TORCH_SERVER}/brand`)
    const b = (await res.json()) as Record<string, string>
    $torchBrand.set({
      displayName: b.app_display_name || b.app_name || 'Torch',
      iconUrl: b.app_icon_url || '',
      primaryColor: b.primary_color || '#2563eb',
      // Inference base is baked into the client, not driven by the server.
      apiBaseUrl: TORCH_INFERENCE_BASE,
      loaded: true
    })
  } catch {
    $torchBrand.set({ ...$torchBrand.get(), loaded: true })
  }
}
