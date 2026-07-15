import { atom } from 'nanostores'

import { Codecs, persistentAtom } from '@/lib/persisted'

// 记忆空间 日记/做梦 (#3). A day's chats are summarized (once, on demand) into a
// first-person diary and a dream, via the kernel's stateless `llm.oneshot` (the
// user's own model/key). Entries are cached in localStorage keyed by local date
// so we never re-spend tokens re-generating a day the user already has.

type RequestGateway = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

export interface MemoryEntry {
  date: string
  diary: string
  dream: string
  sessionCount: number
  generatedAt: number
}

type EntryMap = Record<string, MemoryEntry>

function sanitizeEntries(value: unknown): EntryMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const out: EntryMap = {}

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw && typeof raw === 'object') {
      const e = raw as Record<string, unknown>

      out[key] = {
        date: String(e.date ?? key),
        diary: typeof e.diary === 'string' ? e.diary : '',
        dream: typeof e.dream === 'string' ? e.dream : '',
        sessionCount: typeof e.sessionCount === 'number' ? e.sessionCount : 0,
        generatedAt: typeof e.generatedAt === 'number' ? e.generatedAt : 0
      }
    }
  }

  return out
}

export const $memoryEntries = persistentAtom<EntryMap>(
  'torch.desktop.memory-entries',
  {},
  Codecs.json<EntryMap>(sanitizeEntries)
)

/** Date key currently being generated ('' = idle) — one at a time. */
export const $memoryGenerating = atom<string>('')
export const $memoryError = atom<string>('')

export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')

  return `${y}-${m}-${day}`
}

function dayRange(d: Date): { end: number; start: number } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime() / 1000

  return { start, end: start + 86400 }
}

export function memoryEntryFor(date: Date): MemoryEntry | undefined {
  return $memoryEntries.get()[dateKey(date)]
}

function setEntry(entry: MemoryEntry): void {
  $memoryEntries.set({ ...$memoryEntries.get(), [entry.date]: entry })
}

const diaryPrompt = (enhance: boolean) =>
  `你是用户的 AI 伙伴。下面是用户当天与各位 AI 专家的对话记录。请以第一人称「我」的口吻,为用户写一篇当天的日记:自然温暖、条理清晰,概括今天做了什么、聊了什么、解决了哪些问题、有什么收获或心情。${enhance ? '可以适当加入细节与感受,让日记更生动。' : '简洁为主。'}只输出日记正文,不要标题、不要解释、不要项目符号,控制在 200-350 字。`

const DREAM_PROMPT =
  '你是用户的 AI 伙伴。下面是用户当天与各位 AI 专家的对话记录。请把当天发生的事编织成一段富有想象力的「梦」:用梦境化、隐喻、超现实的笔触重新演绎当天的主题与情绪。只输出梦境正文,不要标题、不要解释,控制在 150-250 字。'

async function oneshot(requestGateway: RequestGateway, instructions: string, input: string): Promise<string> {
  const res = await requestGateway<{ text: string }>('llm.oneshot', {
    instructions,
    input,
    task: 'title_generation',
    max_tokens: 900,
    temperature: 0.8
  })

  return (res?.text ?? '').trim()
}

interface DayDigest {
  session_count: number
  text: string
}

// Generate (and cache) the diary + dream for a day. No-op if already cached
// (unless force), if another generation is in flight, or if the day has no chats.
export async function generateMemoryForDate(
  requestGateway: RequestGateway,
  date: Date,
  opts: { enhance: boolean; force?: boolean }
): Promise<void> {
  const key = dateKey(date)

  if ($memoryGenerating.get()) {
    return
  }

  if (!opts.force && $memoryEntries.get()[key]) {
    return
  }

  const { start, end } = dayRange(date)

  $memoryError.set('')
  $memoryGenerating.set(key)

  try {
    const digest = await requestGateway<DayDigest>('memory.day_digest', { start, end, date: key })

    if (!digest || !digest.session_count || !digest.text.trim()) {
      return
    }

    const [diary, dream] = await Promise.all([
      oneshot(requestGateway, diaryPrompt(opts.enhance), digest.text),
      oneshot(requestGateway, DREAM_PROMPT, digest.text)
    ])

    setEntry({ date: key, diary, dream, sessionCount: digest.session_count, generatedAt: Date.now() })
  } catch (e) {
    $memoryError.set(e instanceof Error ? e.message : String(e))
  } finally {
    $memoryGenerating.set('')
  }
}
