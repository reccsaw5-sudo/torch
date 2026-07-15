import { atom } from 'nanostores'

import { Codecs, persistentAtom } from '@/lib/persisted'

// Locally-saved "my experts" (favorites). Backend-less for now — a list of
// expert ids persisted to localStorage; the 我的专家 tab reads this.
const FAVORITES_KEY = 'torch.desktop.expert-favorites'

export const $favoriteExpertIds = persistentAtom<string[]>(FAVORITES_KEY, [], Codecs.stringArray)

export function toggleExpertFavorite(id: string): void {
  const current = $favoriteExpertIds.get()

  $favoriteExpertIds.set(current.includes(id) ? current.filter(x => x !== id) : [id, ...current])
}

// Persona (#1) bound to the NEXT session created from an expert click. It's a
// one-shot: the expert page sets it, session.create consumes it (shipped as the
// per-session `system_prompt`), and any plain "new chat" clears it. Transient —
// never persisted, so it can't leak across app restarts.
export const $pendingExpertPersona = atom<string>('')

export function setPendingExpertPersona(persona: string): void {
  $pendingExpertPersona.set(persona || '')
}

export function takePendingExpertPersona(): string {
  const persona = $pendingExpertPersona.get()

  if (persona) {
    $pendingExpertPersona.set('')
  }

  return persona
}
