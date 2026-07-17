import { type Expert, EXPERT_CATEGORIES, type ExpertCategory } from '@/lib/expert-templates'
import { Codecs, persistentAtom } from '@/lib/persisted'

// User-created experts, stored locally (no backend). They show up in 我的专家 and
// behave exactly like bundled experts on click (skill-grade persona + opener),
// but can be edited/deleted by the user. Persona left blank → the frontend
// synthesizes a skill-grade prompt from the fields (expertSystemPrompt).
const KEY = 'torch.desktop.custom-experts'
const CATEGORIES = new Set<string>(EXPERT_CATEGORIES)

export interface ExpertDraft {
  name: string
  emoji: string
  category: ExpertCategory
  intro: string
  opener: string
  persona: string
}

function coerce(raw: Record<string, unknown>): Expert | null {
  const id = String(raw.id ?? '').trim()
  const name = String(raw.name ?? '').trim()
  const opener = String(raw.opener ?? '').trim()

  if (!id || !name || !opener) {
    return null
  }

  const category = String(raw.category ?? '')

  return {
    id,
    name,
    author: String(raw.author ?? '我').trim() || '我',
    emoji: String(raw.emoji ?? '').trim() || '🤖',
    category: (CATEGORIES.has(category) ? category : '办公协同') as ExpertCategory,
    intro: String(raw.intro ?? '').trim(),
    opener,
    persona: typeof raw.persona === 'string' ? raw.persona : '',
    usage: 0,
    custom: true
  }
}

function sanitize(value: unknown): Expert[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map(coerce)
    .filter((e): e is Expert => e !== null)
}

export const $customExperts = persistentAtom<Expert[]>(KEY, [], Codecs.json<Expert[]>(sanitize))

function newId(): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return `custom-${rand}`
}

// Create (no id) or update (id) a local expert. Returns the saved id, or '' when
// the draft is invalid (missing name/opener).
export function saveCustomExpert(draft: ExpertDraft, id?: string): string {
  const expert = coerce({ ...draft, id: id ?? newId(), custom: true })

  if (!expert) {
    return ''
  }

  const list = $customExperts.get()
  const idx = id ? list.findIndex(e => e.id === id) : -1

  if (idx >= 0) {
    const next = [...list]
    next[idx] = expert
    $customExperts.set(next)
  } else {
    $customExperts.set([expert, ...list])
  }

  return expert.id
}

export function removeCustomExpert(id: string): void {
  $customExperts.set($customExperts.get().filter(e => e.id !== id))
}
