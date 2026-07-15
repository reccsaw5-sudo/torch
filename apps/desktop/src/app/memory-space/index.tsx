import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { NEW_CHAT_ROUTE } from '@/app/routes'
import { Codicon } from '@/components/ui/codicon'
import { Codecs, persistentAtom } from '@/lib/persisted'
import { cn } from '@/lib/utils'
import { $memoryEntries, $memoryError, $memoryGenerating, dateKey, generateMemoryForDate } from '@/store/torch-memory'

// 增强日记 preference: makes the diary richer (more detail + feelings). Persisted
// so the toggle sticks across navigation; read when (re)generating a day.
const $memoryEnhance = persistentAtom('torch.desktop.memory-enhance', true, Codecs.bool)

const TABS = [
  { id: 'diary', label: '日记', icon: 'book' },
  { id: 'dream', label: '做梦', icon: 'color-mode' },
  { id: 'long', label: '长期记忆', icon: 'database' }
] as const

type TabId = (typeof TABS)[number]['id']

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const CN_WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

const EMPTY_COPY: Record<TabId, { title: string; hint: string }> = {
  diary: { title: '你的专家还没写日记哦～', hint: '去聊两句，给 TA 点灵感吧' },
  dream: { title: '你的专家还没做梦哦～', hint: '多聊聊，TA 会在梦里整理今天' },
  long: { title: '还没有长期记忆～', hint: '随着对话积累，这里会记住重要的事' }
}

interface DayCell {
  date: Date
  inMonth: boolean
}

function buildMonth(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7 // Monday-start offset
  const start = new Date(year, month, 1 - lead)
  const cells: DayCell[] = []

  for (let i = 0; i < 42; i++) {
    const date = new Date(start)

    date.setDate(start.getDate() + i)
    cells.push({ date, inMonth: date.getMonth() === month })
  }

  return cells
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function MonthCalendar({
  selected,
  onSelect,
  diaryDates,
  dreamDates
}: {
  selected: Date
  onSelect: (date: Date) => void
  diaryDates: Set<string>
  dreamDates: Set<string>
}) {
  const today = useMemo(() => new Date(), [])
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }))
  const cells = useMemo(() => buildMonth(view.year, view.month), [view])

  const shift = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1)

    setView({ year: d.getFullYear(), month: d.getMonth() })
  }

  return (
    <div className="rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {view.year}年{view.month + 1}月
          <span className="flex items-center gap-2 text-[0.625rem] font-normal text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-primary" />有日记
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-violet-400" />有做梦
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label="上个月"
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={() => shift(-1)}
            type="button"
          >
            <Codicon name="chevron-left" />
          </button>
          <button
            aria-label="下个月"
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={() => shift(1)}
            type="button"
          >
            <Codicon name="chevron-right" />
          </button>
        </div>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[0.625rem] text-muted-foreground">
        {WEEKDAYS.map(w => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map(cell => {
          const isToday = sameDay(cell.date, today)
          const isSelected = sameDay(cell.date, selected)
          const key = dateKey(cell.date)
          const hasDiary = diaryDates.has(key)
          const hasDream = dreamDates.has(key)

          return (
            <button
              className={cn(
                'relative grid aspect-square place-items-center rounded-lg text-xs transition',
                isSelected
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : cn(
                      'hover:bg-(--ui-control-hover-background)',
                      cell.inMonth ? 'text-foreground' : 'text-muted-foreground/40',
                      isToday && 'font-semibold text-primary'
                    )
              )}
              key={cell.date.toISOString()}
              onClick={() => onSelect(cell.date)}
              type="button"
            >
              {cell.date.getDate()}
              {(hasDiary || hasDream) && (
                <span className="absolute bottom-1 flex items-center gap-0.5">
                  {hasDiary && (
                    <span className={cn('size-1 rounded-full', isSelected ? 'bg-primary-foreground' : 'bg-primary')} />
                  )}
                  {hasDream && (
                    <span className={cn('size-1 rounded-full', isSelected ? 'bg-primary-foreground' : 'bg-violet-400')} />
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// 记忆空间 (Beta): the QClaw-style memory surface — 日记 / 做梦 / 长期记忆 tabs, a
// month calendar, and per-day entries. Selecting a day auto-summarizes that
// day's chats into a diary + dream via the kernel (once, cached); the toggle
// enriches the diary. Long-term memory lists everything generated so far.
export function MemorySpaceView(props: React.ComponentProps<'section'>) {
  const navigate = useNavigate()
  const { requestGateway } = useGatewayRequest()
  const enhance = useStore($memoryEnhance)
  const entries = useStore($memoryEntries)
  const generatingKey = useStore($memoryGenerating)
  const error = useStore($memoryError)
  const [tab, setTab] = useState<TabId>('diary')
  const [selected, setSelected] = useState<Date>(() => new Date())

  const selectedKey = dateKey(selected)
  const entry = entries[selectedKey]
  const isGenerating = generatingKey === selectedKey

  // Read the current enhance flag inside the auto-gen effect without making it a
  // dependency (toggling enhance shouldn't silently regenerate every day).
  const enhanceRef = useRef(enhance)

  useEffect(() => {
    enhanceRef.current = enhance
  }, [enhance])

  // Auto-generate on day-select: no-op when cached, in-flight, or the day has no
  // chats (day_digest returns session_count 0 → no LLM spend).
  useEffect(() => {
    void generateMemoryForDate(requestGateway, selected, { enhance: enhanceRef.current })
  }, [requestGateway, selected])

  const diaryDates = useMemo(
    () => new Set(Object.values(entries).filter(e => e.diary.trim()).map(e => e.date)),
    [entries]
  )

  const dreamDates = useMemo(
    () => new Set(Object.values(entries).filter(e => e.dream.trim()).map(e => e.date)),
    [entries]
  )

  const diaryTotal = diaryDates.size

  const dateLabel = `${selected.getFullYear()}年${selected.getMonth() + 1}月${selected.getDate()}日 星期${CN_WEEKDAY[selected.getDay()]}`
  const empty = EMPTY_COPY[tab]
  const body = tab === 'diary' ? entry?.diary?.trim() : tab === 'dream' ? entry?.dream?.trim() : ''

  const regenerate = () => {
    void generateMemoryForDate(requestGateway, selected, { enhance, force: true })
  }

  return (
    <section
      {...props}
      className="flex h-full min-w-0 flex-col overflow-hidden bg-(--ui-chat-surface-background)"
    >
      <div className="shrink-0 px-4 pb-3 pt-[calc(var(--titlebar-height)+0.5rem)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground">记忆</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary">Beta</span>
            </div>
            <div className="flex items-center gap-0.5">
              {TABS.map((entryTab, i) => (
                <div className="flex items-center" key={entryTab.id}>
                  {i > 0 ? <Codicon className="mx-0.5 text-[0.625rem] text-muted-foreground/40" name="chevron-right" /> : null}
                  <button
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition',
                      tab === entryTab.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-(--ui-control-hover-background) hover:text-foreground'
                    )}
                    onClick={() => setTab(entryTab.id)}
                    type="button"
                  >
                    <Codicon name={entryTab.icon} />
                    {entryTab.label}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>日记总数 {diaryTotal}</span>
            <button
              className="flex items-center gap-1.5"
              onClick={() => $memoryEnhance.set(!enhance)}
              type="button"
            >
              增强日记
              <span
                className={cn(
                  'relative h-4 w-7 rounded-full transition',
                  enhance ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-3 rounded-full bg-white transition-all',
                    enhance ? 'left-3.5' : 'left-0.5'
                  )}
                />
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <MonthCalendar diaryDates={diaryDates} dreamDates={dreamDates} onSelect={setSelected} selected={selected} />
            <div className="rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/40 p-3">
              <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">专家分类</div>
              <button
                className="flex w-full items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-left text-sm font-medium text-primary"
                type="button"
              >
                <Codicon name="organization" />
                全部专家
              </button>
            </div>
          </div>

          {tab === 'long' ? (
            <LongMemoryPanel entries={entries} onSelect={setSelected} />
          ) : (
            <div className="rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/40 p-4">
              <div className="mb-4 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{dateLabel}</span>
                {entry && !isGenerating && (
                  <button
                    className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-(--ui-control-hover-background) hover:text-foreground"
                    onClick={regenerate}
                    type="button"
                  >
                    <Codicon name="refresh" />
                    重新生成
                  </button>
                )}
              </div>

              {isGenerating ? (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                  <Codicon className="text-2xl text-primary" name="loading" spinning />
                  <div className="text-sm text-foreground">
                    正在把今天的对话{tab === 'dream' ? '织成一场梦' : '写成日记'}…
                  </div>
                  <div className="text-xs text-muted-foreground">用你自己的模型生成,请稍候</div>
                </div>
              ) : body ? (
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{body}</div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                  <Codicon className="text-3xl text-muted-foreground/50" name={tab === 'dream' ? 'color-mode' : 'book'} />
                  <div className="text-sm text-foreground">{empty.title}</div>
                  <div className="text-xs text-muted-foreground">{error || empty.hint}</div>
                  <button
                    className="mt-1 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-110"
                    onClick={() => (entry ? regenerate() : navigate(NEW_CHAT_ROUTE))}
                    type="button"
                  >
                    {entry ? '重新生成' : '去聊天'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// 长期记忆: a reverse-chronological timeline of every day that has a diary. Each
// row jumps back to that day's diary/dream.
function LongMemoryPanel({
  entries,
  onSelect
}: {
  entries: Record<string, { date: string; diary: string; dream: string }>
  onSelect: (date: Date) => void
}) {
  const rows = useMemo(
    () =>
      Object.values(entries)
        .filter(e => e.diary.trim() || e.dream.trim())
        .sort((a, b) => b.date.localeCompare(a.date)),
    [entries]
  )

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/40 p-4">
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <Codicon className="text-3xl text-muted-foreground/50" name="database" />
          <div className="text-sm text-foreground">{EMPTY_COPY.long.title}</div>
          <div className="text-xs text-muted-foreground">{EMPTY_COPY.long.hint}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map(row => {
        const [y, m, d] = row.date.split('-').map(Number)

        return (
          <button
            className="rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/40 p-4 text-left transition hover:border-primary/40"
            key={row.date}
            onClick={() => onSelect(new Date(y, m - 1, d))}
            type="button"
          >
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-primary">
              <Codicon name="book" />
              {row.date}
            </div>
            <div className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {row.diary.trim() || row.dream.trim()}
            </div>
          </button>
        )
      })}
    </div>
  )
}
