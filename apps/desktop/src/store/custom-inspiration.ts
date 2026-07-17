import { INSPIRATION_CATEGORIES, type InspirationCard, type InspirationCategory } from '@/lib/inspiration-templates'
import { Codecs, persistentAtom } from '@/lib/persisted'

// User-created inspiration cards, stored locally (no backend). They appear in the
// 灵感广场 grid and behave like bundled cards on click (skill-grade role by
// category + prompt prefill), but can be edited/deleted by the user.
const KEY = 'torch.desktop.custom-inspiration'
const CATEGORIES = new Set<string>(INSPIRATION_CATEGORIES)

export interface InspirationDraft {
  emoji: string
  title: string
  category: InspirationCategory
  desc: string
  prompt: string
}

function coerce(raw: Record<string, unknown>): InspirationCard | null {
  const id = String(raw.id ?? '').trim()
  const title = String(raw.title ?? '').trim()
  const prompt = String(raw.prompt ?? '').trim()

  if (!id || !title || !prompt) {
    return null
  }

  const category = String(raw.category ?? '')

  return {
    id,
    category: (CATEGORIES.has(category) ? category : '办公提效') as InspirationCategory,
    emoji: String(raw.emoji ?? '').trim() || '💡',
    title,
    desc: String(raw.desc ?? '').trim(),
    prompt,
    custom: true
  }
}

function sanitize(value: unknown): InspirationCard[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
    .map(coerce)
    .filter((c): c is InspirationCard => c !== null)
}

export const $customInspiration = persistentAtom<InspirationCard[]>(KEY, [], Codecs.json<InspirationCard[]>(sanitize))

function newId(): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return `custom-${rand}`
}

// Create (no id) or update (id) a local inspiration card. Returns the saved id,
// or '' when the draft is invalid (missing title/prompt).
export function saveCustomInspiration(draft: InspirationDraft, id?: string): string {
  const card = coerce({ ...draft, id: id ?? newId(), custom: true })

  if (!card) {
    return ''
  }

  const list = $customInspiration.get()
  const idx = id ? list.findIndex(c => c.id === id) : -1

  if (idx >= 0) {
    const next = [...list]
    next[idx] = card
    $customInspiration.set(next)
  } else {
    $customInspiration.set([card, ...list])
  }

  return card.id
}

export function removeCustomInspiration(id: string): void {
  $customInspiration.set($customInspiration.get().filter(c => c.id !== id))
}
