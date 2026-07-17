import type * as React from 'react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { NEW_CHAT_ROUTE } from '@/app/routes'
import { triggerHaptic } from '@/lib/haptics'
import {
  INSPIRATION_CARDS,
  INSPIRATION_CATEGORIES,
  type InspirationCard,
  inspirationSystemPrompt
} from '@/lib/inspiration-templates'
import { cn } from '@/lib/utils'
import { stashSessionDraft } from '@/store/composer'
import { setPendingSessionPersona } from '@/store/session-persona'

import { PageSearchShell } from '../page-search-shell'

const ALL = '全部灵感'

// Paired gradient tints for the featured hero banners (cycled by index).
const HERO_TINTS = ['from-emerald-400/25 to-emerald-500/5', 'from-sky-400/25 to-blue-500/5']

// 灵感广场: a gallery of preset use-cases. Clicking a card drops its prompt into
// the composer of a fresh chat (the user reviews, then sends).
export function InspirationView(props: React.ComponentProps<'section'>) {
  const navigate = useNavigate()
  const [category, setCategory] = useState<string>(ALL)

  const featured = useMemo(() => INSPIRATION_CARDS.filter(card => card.featured), [])

  const grid = useMemo(
    () => (category === ALL ? INSPIRATION_CARDS : INSPIRATION_CARDS.filter(card => card.category === category)),
    [category]
  )

  const tabs = useMemo(() => [{ id: ALL, label: ALL }, ...INSPIRATION_CATEGORIES.map(c => ({ id: c, label: c }))], [])

  const use = (card: InspirationCard) => {
    triggerHaptic('selection')
    // Bind the skill-grade role to the next-created session (option "B"):
    // session.create ships it as `system_prompt`, so the kernel bakes it into
    // this chat's overlay before the first API call (persistent, cache-safe).
    setPendingSessionPersona(inspirationSystemPrompt(card))
    // Stash the prompt as the new-chat draft (scope __new__) so the freshly
    // mounted composer loads it via takeSessionDraft — reliable across the
    // full-page → chat route swap (the event bus fired before the composer
    // subscribed, so the insert was lost = the blank conversation bug).
    stashSessionDraft(null, card.prompt, [])
    navigate(NEW_CHAT_ROUTE)
  }

  return (
    <PageSearchShell
      {...props}
      activeTab={category}
      onSearchChange={() => {}}
      onTabChange={setCategory}
      searchHidden
      searchPlaceholder=""
      searchValue=""
      tabs={tabs}
    >
      <div className="h-full overflow-y-auto px-4 pb-8 pt-2">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          {category === ALL && featured.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {featured.map((card, i) => (
                <button
                  className={cn(
                    'group relative flex items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-left transition hover:brightness-[1.02]',
                    HERO_TINTS[i % HERO_TINTS.length]
                  )}
                  key={card.id}
                  onClick={() => use(card)}
                  type="button"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.95rem] font-semibold text-foreground">{card.title}</div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{card.desc}</p>
                  </div>
                  <span className="shrink-0 text-4xl leading-none transition group-hover:scale-110">{card.emoji}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grid.map(card => (
              <button
                className="group flex flex-col items-start gap-2 rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/40 p-4 text-left transition hover:border-primary/30 hover:bg-primary/[0.04]"
                key={card.id}
                onClick={() => use(card)}
                type="button"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-xl">{card.emoji}</span>
                <span className="text-[0.875rem] font-semibold text-foreground">{card.title}</span>
                <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{card.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </PageSearchShell>
  )
}
