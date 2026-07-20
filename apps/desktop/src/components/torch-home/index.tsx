import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { BrandMark } from '@/components/brand-mark'
import { Codicon } from '@/components/ui/codicon'
import { MessageCircle, RefreshCw } from '@/lib/icons'
import { INSPIRATION_CARDS } from '@/lib/inspiration-templates'
import { $torchBrand, loadTorchBrand } from '@/store/torch-brand'
import {
  $torchSuggestions,
  loadTorchSkills,
  loadTorchSuggestions,
  openTorchMarket,
  type TorchSuggestion
} from '@/store/torch-market'

const BATCH = 3

// Local quick-start cards, used when the server returns no suggestions so the
// home always has something inviting to click.
const FALLBACK_CARDS: TorchSuggestion[] = INSPIRATION_CARDS.slice(0, 6).map((card, i) => ({
  id: -(i + 1),
  title: card.title,
  subtitle: card.desc,
  prompt: card.prompt
}))

// Branded empty-state home: brand logo + greeting + quick-start task cards
// (server-driven, local fallback) + an entry into 技能市场.
export function TorchHome() {
  const brand = useStore($torchBrand)
  const suggestions = useStore($torchSuggestions)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    void loadTorchBrand()
    void loadTorchSuggestions()
    void loadTorchSkills()
  }, [])

  const source = suggestions.length > 0 ? suggestions : FALLBACK_CARDS

  const batch = useMemo(() => {
    if (source.length === 0) {
      return [] as TorchSuggestion[]
    }

    const out: TorchSuggestion[] = []

    for (let i = 0; i < Math.min(BATCH, source.length); i++) {
      out.push(source[(offset + i) % source.length])
    }

    return out
  }, [source, offset])

  const pickCard = (s: TorchSuggestion) => {
    requestComposerInsert(s.prompt, { mode: 'block', target: 'main' })
    requestComposerFocus('main')
  }

  const entries = [{ label: '技能市场', icon: 'zap', onClick: () => openTorchMarket() }]

  return (
    <div className="pointer-events-auto flex w-full max-w-3xl flex-col items-center px-6 py-8 text-center">
      <BrandMark className="size-14 rounded-full shadow-md ring-1 ring-border/50" />
      <h1 className="mt-6 text-[1.7rem] font-semibold tracking-tight text-foreground">
        Hi，我是 {brand.displayName}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">随时随地，帮您高效干活</p>

      {batch.length > 0 && (
        <div className="mt-10 w-full">
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">选一个任务，快速开始</span>
            {source.length > BATCH && (
              <button
                className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent/60 hover:text-foreground"
                onClick={() => setOffset(o => o + BATCH)}
                type="button"
              >
                <RefreshCw className="size-3" />
                换一批
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {batch.map(s => (
              <button
                className="group flex flex-col rounded-2xl border border-border/70 bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-border hover:shadow-md"
                key={s.id}
                onClick={() => pickCard(s)}
                type="button"
              >
                <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <MessageCircle className="size-3.5" style={{ color: brand.primaryColor }} />
                  <span className="truncate">{brand.displayName}</span>
                </div>
                <div className="text-sm font-semibold text-foreground">{s.title}</div>
                {s.subtitle && (
                  <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{s.subtitle}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {entries.map(entry => (
          <button
            className="flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-4 py-2 text-xs font-medium text-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            key={entry.label}
            onClick={entry.onClick}
            type="button"
          >
            <Codicon name={entry.icon} style={{ color: brand.primaryColor }} />
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  )
}
