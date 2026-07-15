import { atom } from 'nanostores'

import { type Expert, type ExpertCategory, EXPERTS } from '@/lib/expert-templates'

import { TORCH_SERVER } from './torch-brand'

// Expert catalog. Seeded with the local bundle so the plaza has data instantly
// and works offline; loadTorchExperts() swaps in the server catalog when the
// backend responds (so experts can be managed server-side without a repackage).
export const $torchExperts = atom<Expert[]>(EXPERTS)

interface ServerExpert {
  id: string
  name: string
  author?: string
  emoji?: string
  category?: string
  intro?: string
  opener?: string
  persona?: string
  usage?: number
  featured?: boolean
  isNew?: boolean
}

function toExpert(e: ServerExpert): Expert {
  return {
    id: e.id,
    name: e.name,
    author: e.author ?? '',
    emoji: e.emoji || '🤖',
    category: (e.category || '办公协同') as ExpertCategory,
    intro: e.intro ?? '',
    opener: e.opener ?? '',
    persona: e.persona ?? '',
    usage: e.usage ?? 0,
    featured: e.featured,
    isNew: e.isNew
  }
}

export async function loadTorchExperts(): Promise<void> {
  try {
    const res = await fetch(`${TORCH_SERVER}/experts`)
    const data = (await res.json()) as { data?: ServerExpert[] }
    const list = (data.data ?? []).filter(e => e && e.id && e.name).map(toExpert)

    if (list.length > 0) {
      $torchExperts.set(list)
    }
  } catch {
    // Keep the local seed — offline / server down just shows the bundled experts.
  }
}
