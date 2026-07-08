import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'

import { $torchLogin } from '@/store/torch-login'
import { $torchModels, loadTorchModels, readSelectedTorchModel } from '@/store/torch-models'

// Torch-native on-demand translation for backend catalog text (skill/toolset/
// MCP/hub names + descriptions) that ships in English. The user flips a toggle;
// visible English strings are sent to the metering proxy's chat endpoint, and
// the Simplified-Chinese result is cached in localStorage so each unique string
// is only ever translated once per machine.

const CACHE_KEY = 'torch_translations_v1'
const ON_KEY = 'torch_translate_on'
const CHUNK_SIZE = 30

function loadCache(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const cache: Record<string, string> = loadCache()

function persistCache() {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage unavailable or over quota — keep the in-memory cache.
  }
}

function readOn(): boolean {
  try {
    return window.localStorage.getItem(ON_KEY) === '1'
  } catch {
    return false
  }
}

export const $translateOn = atom<boolean>(readOn())
export const $translating = atom<boolean>(false)
// Bumped whenever the cache gains entries, so `useTr` consumers re-render and
// pick up freshly translated strings.
export const $translateVersion = atom<number>(0)

export function setTranslateOn(on: boolean): void {
  $translateOn.set(on)
  try {
    window.localStorage.setItem(ON_KEY, on ? '1' : '0')
  } catch {
    // ignore persistence failure
  }
}

/** Translate `text` when the toggle is on and a cached translation exists,
 *  otherwise return the original. Pure/synchronous — safe to call in render. */
export function tr(text: string | null | undefined): string {
  if (!text) {
    return text ?? ''
  }
  if (!$translateOn.get()) {
    return text
  }
  const key = text.trim()
  return cache[key] ?? text
}

/** Reactive `tr`: subscribes to the toggle + cache version so a component
 *  re-renders when translation state changes. */
export function useTr(): (text: string | null | undefined) => string {
  useStore($translateOn)
  useStore($translateVersion)
  return tr
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

function parseTranslations(content: string): string[] | null {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed.map(item => String(item ?? '')) : null
  } catch {
    return null
  }
}

/** Translate a batch of English strings to Simplified Chinese via the metering
 *  proxy, skipping anything already cached. No-ops when logged out. */
export async function translateStrings(texts: (string | null | undefined)[]): Promise<void> {
  const session = $torchLogin.get().session
  if (!session) {
    return
  }

  const seen = new Set<string>()
  const pending: string[] = []
  for (const raw of texts) {
    const key = raw?.trim()
    if (!key || seen.has(key) || key in cache) {
      continue
    }
    seen.add(key)
    pending.push(key)
  }

  if (pending.length === 0) {
    return
  }

  let model = readSelectedTorchModel() || $torchModels.get()[0] || ''
  if (!model) {
    // No model cached yet (e.g. user hasn't opened the picker) — pull the
    // catalog so the translate button doesn't silently no-op.
    const ids = await loadTorchModels()
    model = readSelectedTorchModel() || ids[0] || ''
  }
  if (!model) {
    return
  }

  $translating.set(true)
  let gained = false
  try {
    for (const batch of chunk(pending, CHUNK_SIZE)) {
      try {
        const res = await fetch(`${session.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.apiKey}`
          },
          body: JSON.stringify({
            model,
            stream: false,
            temperature: 0,
            messages: [
              {
                role: 'system',
                content:
                  'You translate short UI catalog strings from English to Simplified Chinese. ' +
                  'Keep product names, tool/skill identifiers, code, and CLI flags unchanged. ' +
                  'Return ONLY a JSON array of strings — the translations in the same order and ' +
                  'the same length as the input array — with no extra commentary or code fences.'
              },
              { role: 'user', content: JSON.stringify(batch) }
            ]
          })
        })
        if (!res.ok) {
          continue
        }
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        const content = data.choices?.[0]?.message?.content ?? ''
        const translations = parseTranslations(content)
        if (!translations || translations.length !== batch.length) {
          continue
        }
        batch.forEach((src, i) => {
          const zh = translations[i]?.trim()
          if (zh) {
            cache[src] = zh
            gained = true
          }
        })
      } catch {
        // Network/parse failure for this batch — leave the strings in English.
      }
    }
  } finally {
    if (gained) {
      persistCache()
    }
    $translating.set(false)
    $translateVersion.set($translateVersion.get() + 1)
  }
}
