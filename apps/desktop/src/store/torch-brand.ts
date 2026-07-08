import { atom } from 'nanostores'

const ENV = import.meta.env as Record<string, string | undefined>
export const TORCH_SERVER = (ENV.VITE_TORCH_SERVER ?? 'http://127.0.0.1:8080').replace(/\/$/, '')

export interface TorchBrand {
  displayName: string
  iconUrl: string
  primaryColor: string
  loaded: boolean
}

export const $torchBrand = atom<TorchBrand>({
  displayName: 'Torch',
  iconUrl: '',
  primaryColor: '#2563eb',
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
      loaded: true
    })
  } catch {
    $torchBrand.set({ ...$torchBrand.get(), loaded: true })
  }
}
