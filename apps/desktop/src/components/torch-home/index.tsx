import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { BrandMark } from '@/components/brand-mark'
import { MessageCircle, RefreshCw, Zap } from '@/lib/icons'
import { $torchBrand, loadTorchBrand } from '@/store/torch-brand'
import {
  $torchSuggestions,
  loadTorchSkills,
  loadTorchSuggestions,
  openTorchMarket,
  type TorchSuggestion
} from '@/store/torch-market'

const BATCH = 3

// Branded empty-state home (replaces the stock wordmark intro): brand logo +
// greeting + server-driven task cards + a skill-marketplace entry.
export function TorchHome() {
  const brand = useStore($torchBrand)
  const suggestions = useStore($torchSuggestions)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    void loadTorchBrand()
    void loadTorchSuggestions()
    void loadTorchSkills()
  }, [])

  const batch = useMemo(() => {
    if (suggestions.length === 0) {
      return [] as TorchSuggestion[]
    }
    const out: TorchSuggestion[] = []
    for (let i = 0; i < Math.min(BATCH, suggestions.length); i++) {
      out.push(suggestions[(offset + i) % suggestions.length])
    }
    return out
  }, [suggestions, offset])

  const pickCard = (s: TorchSuggestion) => {
    requestComposerInsert(s.prompt, { mode: 'block', target: 'main' })
    requestComposerFocus('main')
  }

  return (
    <div className="pointer-events-auto flex w-full max-w-3xl flex-col items-center px-6 py-8 text-center">
      <BrandMark className="size-14 rounded-full shadow-md ring-1 ring-border/50" />
      <h1 className="mt-6 text-[1.7rem] font-semibold tracking-tight text-foreground">你好，准备就绪</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        开始与 {brand.displayName} 对话。提问、获取代码帮助或探索想法。
      </p>

      {batch.length > 0 && (
        <div className="mt-10 w-full">
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">选一个任务，快速开始</span>
            {suggestions.length > BATCH && (
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

      <button
        className="mt-8 flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-4 py-2 text-xs font-medium text-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        onClick={() => openTorchMarket()}
        type="button"
      >
        <Zap className="size-3.5" style={{ color: brand.primaryColor }} />
        浏览技能市场
      </button>
    </div>
  )
}
