import { useCallback, useEffect, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { getHermesConfigRecord, type HermesConfigRecord, saveHermesConfig } from '@/hermes'
import { Brain } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'

import { PageSearchShell } from '../page-search-shell'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

interface MemoryViewProps {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

// Sentinel for the "default / auto" provider — Radix Select can't hold an
// empty-string value, and config maps blank provider to the built-in default.
const DEFAULT_PROVIDER = '__default__'

const PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: DEFAULT_PROVIDER, label: '默认(自动)' },
  { value: 'builtin', label: '内置记忆' },
  { value: 'hindsight', label: 'Hindsight' },
  { value: 'honcho', label: 'Honcho' }
]

function asBool(value: unknown): boolean {
  return value === true
}

function asNumberText(value: unknown): string {
  if (typeof value === 'number') {
    return String(value)
  }

  return typeof value === 'string' ? value : ''
}

export function MemoryView({ setStatusbarItemGroup: _setStatusbarItemGroup }: MemoryViewProps) {
  const [record, setRecord] = useState<HermesConfigRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<null | string>(null)

  useEffect(() => {
    let cancelled = false

    getHermesConfigRecord()
      .then(next => {
        if (!cancelled) {
          setRecord(next)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => void (cancelled = true)
  }, [])

  const memory = (record?.memory ?? {}) as Record<string, unknown>

  const commit = useCallback(async (next: HermesConfigRecord) => {
    setRecord(next)

    try {
      await saveHermesConfig(next)
      notify({ kind: 'success', message: '记忆设置已保存' })
    } catch (err) {
      notifyError(err, '保存失败')
    }
  }, [])

  const updateMemory = useCallback(
    (changes: Record<string, unknown>) => {
      setRecord(prev => {
        if (!prev) {
          return prev
        }

        const next = { ...prev, memory: { ...((prev.memory as Record<string, unknown> | undefined) ?? {}), ...changes } }

        void commit(next)

        return next
      })
    },
    [commit]
  )

  const providerValue =
    typeof memory.provider === 'string' && memory.provider ? String(memory.provider) : DEFAULT_PROVIDER

  return (
    <PageSearchShell onSearchChange={() => undefined} searchHidden searchPlaceholder="" searchValue="">
      {loading ? (
        <PageLoader />
      ) : error ? (
        <div className="grid h-full place-items-center px-6 text-center text-sm text-destructive">{error}</div>
      ) : (
        <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto px-4 py-4">
          <header className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
              <Brain className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-(--ui-text-primary)">记忆</h1>
              <p className="text-xs text-muted-foreground">让助手跨会话记住重要信息与你的偏好。</p>
            </div>
          </header>

          <Section description="保存有用的长期记忆,供未来会话参考。" title="持久记忆">
            <ToggleRow
              checked={asBool(memory.memory_enabled)}
              label="启用持久记忆"
              onChange={value => updateMemory({ memory_enabled: value })}
            />
            <ToggleRow
              checked={asBool(memory.user_profile_enabled)}
              label="维护用户画像"
              onChange={value => updateMemory({ user_profile_enabled: value })}
            />
            <FieldRow label="记忆提供方">
              <Select
                onValueChange={value => updateMemory({ provider: value === DEFAULT_PROVIDER ? '' : value })}
                value={providerValue}
              >
                <SelectTrigger className="h-9 w-48 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </Section>

          <Section description="限制注入到上下文中的记忆与画像字符数。" title="预算">
            <NumberRow
              label="记忆字符预算"
              onCommit={value => updateMemory({ memory_char_limit: value })}
              value={asNumberText(memory.memory_char_limit)}
            />
            <NumberRow
              label="画像字符预算"
              onCommit={value => updateMemory({ user_char_limit: value })}
              value={asNumberText(memory.user_char_limit)}
            />
          </Section>
        </div>
      )}
    </PageSearchShell>
  )
}

function Section({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary)/25 p-4">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold text-(--ui-text-primary)">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-1 text-sm">
      <span className="text-(--ui-text-primary)">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-1 text-sm">
      <span className="text-(--ui-text-primary)">{label}</span>
      {children}
    </div>
  )
}

function NumberRow({ label, value, onCommit }: { label: string; value: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  return (
    <FieldRow label={label}>
      <Input
        className="h-9 w-48 rounded-xl text-sm"
        inputMode="numeric"
        onBlur={() => {
          const parsed = Number(draft)

          if (Number.isFinite(parsed) && String(parsed) !== value) {
            onCommit(parsed)
          }
        }}
        onChange={event => setDraft(event.target.value)}
        value={draft}
      />
    </FieldRow>
  )
}
