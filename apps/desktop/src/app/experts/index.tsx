import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { NEW_CHAT_ROUTE } from '@/app/routes'
import { Codicon } from '@/components/ui/codicon'
import { type Expert, EXPERT_CATEGORIES } from '@/lib/expert-templates'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $favoriteExpertIds, toggleExpertFavorite } from '@/store/experts'
import { $torchExperts, loadTorchExperts } from '@/store/torch-experts'

import { PageSearchShell } from '../page-search-shell'

const ALL = '全部'
const PLAZA = 'plaza'
const MINE = 'mine'

const BOARD_META = [
  { id: 'recommended', title: '推荐榜', icon: 'sparkle', tint: 'from-amber-300/25 to-orange-200/5' },
  { id: 'hot', title: '热门榜', icon: 'flame', tint: 'from-rose-300/25 to-red-200/5' },
  { id: 'new', title: '新品榜', icon: 'rocket', tint: 'from-emerald-300/25 to-teal-200/5' }
] as const

// Ranking boards derived from the live catalog so adding an expert just works.
function buildBoards(experts: Expert[]): { id: string; title: string; icon: string; tint: string; experts: Expert[] }[] {
  const picks: Record<string, Expert[]> = {
    recommended: experts.filter(e => e.featured).slice(0, 3),
    hot: [...experts].sort((a, b) => b.usage - a.usage).slice(0, 3),
    new: experts.filter(e => e.isNew).slice(0, 3)
  }

  return BOARD_META.map(meta => ({ ...meta, experts: picks[meta.id] ?? [] }))
}

const RANK_BADGE = ['bg-amber-400/90 text-white', 'bg-slate-300/90 text-slate-700', 'bg-orange-400/80 text-white']

function formatUsage(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}w` : String(n)
}

function matches(expert: Expert, q: string): boolean {
  if (!q) {
    return true
  }

  const needle = q.trim().toLowerCase()

  return (
    expert.name.toLowerCase().includes(needle) ||
    expert.intro.toLowerCase().includes(needle) ||
    expert.author.toLowerCase().includes(needle) ||
    expert.category.includes(needle)
  )
}

function ExpertAvatar({ emoji, className }: { emoji: string; className?: string }) {
  return <span className={cn('grid place-items-center rounded-xl bg-primary/10 text-2xl', className)}>{emoji}</span>
}

function ExpertCard({
  expert,
  favorite,
  onUse,
  onToggleFavorite
}: {
  expert: Expert
  favorite: boolean
  onUse: () => void
  onToggleFavorite: () => void
}) {
  return (
    <div className="group relative rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/40 transition hover:border-primary/30 hover:bg-primary/[0.04]">
      <button className="flex w-full flex-col gap-3 p-4 text-left" onClick={onUse} type="button">
        <div className="flex items-start gap-3">
          <ExpertAvatar className="size-11 shrink-0" emoji={expert.emoji} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">{expert.name}</span>
              {expert.isNew ? (
                <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[0.625rem] font-medium text-emerald-600">
                  新
                </span>
              ) : null}
            </div>
            <div className="truncate text-xs text-muted-foreground">{expert.author}</div>
          </div>
        </div>
        <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">{expert.intro}</p>
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-emerald-600">免费</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Codicon className="text-[0.75rem]" name="eye" />
            {formatUsage(expert.usage)}
          </span>
        </div>
      </button>
      <button
        aria-label={favorite ? '取消收藏' : '收藏专家'}
        className={cn(
          'absolute right-3 top-3 grid size-6 place-items-center rounded-full text-sm transition',
          favorite ? 'text-amber-400' : 'text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-amber-400'
        )}
        onClick={onToggleFavorite}
        type="button"
      >
        <Codicon name={favorite ? 'star-full' : 'star-empty'} />
      </button>
    </div>
  )
}

// 专家广场: a marketplace of preset AI experts. Clicking one opens a fresh chat
// with the expert's opener prefilled into the composer (user reviews, then sends).
export function ExpertsView(props: React.ComponentProps<'section'>) {
  const navigate = useNavigate()
  const experts = useStore($torchExperts)
  const favoriteIds = useStore($favoriteExpertIds)
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const [tab, setTab] = useState<string>(PLAZA)
  const [category, setCategory] = useState<string>(ALL)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void loadTorchExperts()
  }, [])

  const byId = useMemo(() => new Map(experts.map(e => [e.id, e])), [experts])
  const boards = useMemo(() => buildBoards(experts), [experts])

  const use = (expert: Expert) => {
    triggerHaptic('selection')
    navigate(NEW_CHAT_ROUTE)
    // Deferred insert lands after the fresh composer mounts (same bus TorchHome
    // / startWorkSession use). setComposerDraft was a dead atom nothing reads.
    requestComposerInsert(expert.opener, { mode: 'block', target: 'main' })
    requestComposerFocus('main')
  }

  const plazaExperts = useMemo(
    () => experts.filter(e => (category === ALL || e.category === category) && matches(e, query)),
    [experts, category, query]
  )

  const mineExperts = useMemo(
    () => favoriteIds.map(id => byId.get(id)).filter((e): e is Expert => Boolean(e) && matches(e as Expert, query)),
    [favoriteIds, byId, query]
  )

  const showBoards = tab === PLAZA && category === ALL && !query.trim()

  const publishSoon = () => {
    setNotice('专家上架功能将在后端上线后开放,敬请期待')
    window.setTimeout(() => setNotice(null), 2600)
  }

  const categoryFilters =
    tab === PLAZA ? (
      <div className="flex flex-wrap items-center gap-1.5">
        {[ALL, ...EXPERT_CATEGORIES].map(c => (
          <button
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition',
              c === category
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-(--ui-control-hover-background) hover:text-foreground'
            )}
            key={c}
            onClick={() => setCategory(c)}
            type="button"
          >
            {c}
          </button>
        ))}
      </div>
    ) : undefined

  return (
    <PageSearchShell
      {...props}
      activeTab={tab}
      filters={categoryFilters}
      onSearchChange={setQuery}
      onTabChange={setTab}
      searchPlaceholder="搜索专家"
      searchTrailingAction={
        <button
          className="flex items-center gap-1 rounded-full border border-(--ui-stroke-tertiary) px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
          onClick={publishSoon}
          type="button"
        >
          上架平台
          <Codicon className="text-[0.75rem]" name="link-external" />
        </button>
      }
      searchValue={query}
      tabs={[
        { id: PLAZA, label: '专家广场' },
        { id: MINE, label: '我的专家', meta: favoriteIds.length || undefined }
      ]}
    >
      <div className="relative h-full overflow-y-auto px-4 pb-8 pt-2">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          {showBoards ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {boards.map(board => (
                <div
                  className={cn('rounded-2xl bg-gradient-to-br p-3', board.tint)}
                  key={board.id}
                >
                  <div className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold text-foreground">
                    <Codicon name={board.icon} />
                    {board.title}
                  </div>
                  <ol className="flex flex-col gap-0.5">
                    {board.experts.map((expert, i) => (
                      <li key={expert.id}>
                        <button
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-background/50"
                          onClick={() => use(expert)}
                          type="button"
                        >
                          <span
                            className={cn(
                              'grid size-4 shrink-0 place-items-center rounded text-[0.625rem] font-bold',
                              RANK_BADGE[i] ?? 'bg-muted text-muted-foreground'
                            )}
                          >
                            {i + 1}
                          </span>
                          <span className="text-base leading-none">{expert.emoji}</span>
                          <span className="truncate text-xs font-medium text-foreground">{expert.name}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          ) : null}

          {tab === MINE && mineExperts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <Codicon className="text-3xl text-muted-foreground/50" name="star-empty" />
              <div className="text-sm text-muted-foreground">还没有收藏的专家</div>
              <button
                className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-110"
                onClick={() => setTab(PLAZA)}
                type="button"
              >
                去专家广场逛逛
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(tab === PLAZA ? plazaExperts : mineExperts).map(expert => (
                <ExpertCard
                  expert={expert}
                  favorite={favoriteSet.has(expert.id)}
                  key={expert.id}
                  onToggleFavorite={() => toggleExpertFavorite(expert.id)}
                  onUse={() => use(expert)}
                />
              ))}
            </div>
          )}
        </div>

        {notice ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
            <div className="rounded-full bg-foreground/85 px-4 py-2 text-xs font-medium text-background shadow-lg">
              {notice}
            </div>
          </div>
        ) : null}
      </div>
    </PageSearchShell>
  )
}
