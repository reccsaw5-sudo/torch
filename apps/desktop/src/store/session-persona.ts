import { atom } from 'nanostores'

// Skill-grade persona bound to the NEXT session created from an expert or an
// inspiration card (option "B": each plaza item behaves like a skill by loading
// a role + working-method system prompt for the whole conversation). One-shot:
// the plaza page sets it, session.create consumes it (shipped as the per-session
// `system_prompt`, baked into the kernel overlay before the first API call so
// prompt caching stays intact), and a plain "new chat" leaves nothing behind.
// Transient — never persisted, so it can't leak across app restarts.
export const $pendingSessionPersona = atom<string>('')

export function setPendingSessionPersona(persona: string): void {
  $pendingSessionPersona.set(persona || '')
}

export function takePendingSessionPersona(): string {
  const persona = $pendingSessionPersona.get()

  if (persona) {
    $pendingSessionPersona.set('')
  }

  return persona
}
