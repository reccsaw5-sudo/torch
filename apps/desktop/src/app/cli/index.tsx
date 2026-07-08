import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import type { CommandsCatalogLike } from '@/lib/desktop-slash-commands'
import { Terminal } from '@/lib/icons'
import { normalize } from '@/lib/text'
import { $gateway } from '@/store/gateway'

import { PageSearchShell } from '../page-search-shell'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

interface CliViewProps {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

interface CommandEntry {
  name: string
  description: string
  group: string
}

function slashName(name: string): string {
  return name.startsWith('/') ? name : `/${name}`
}

export function CliView({ setStatusbarItemGroup: _setStatusbarItemGroup }: CliViewProps) {
  const gateway = useStore($gateway)
  const [catalog, setCatalog] = useState<CommandsCatalogLike | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<null | string>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!gateway) {
      return
    }

    let cancelled = false

    setLoading(true)
    gateway
      .request<CommandsCatalogLike>('commands.catalog')
      .then(next => {
        if (!cancelled) {
          setCatalog(next)
          setError(null)
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
  }, [gateway])

  const entries = useMemo<CommandEntry[]>(() => {
    if (!catalog) {
      return []
    }

    const rows: CommandEntry[] = []

    const push = (group: string, pairs: [string, string][]) => {
      for (const [name, description] of pairs) {
        rows.push({ name, description, group })
      }
    }

    if (catalog.categories?.length) {
      for (const category of catalog.categories) {
        push(category.name, category.pairs ?? [])
      }
    } else if (catalog.pairs?.length) {
      push('命令', catalog.pairs)
    }

    return rows
  }, [catalog])

  const groups = useMemo(() => {
    const q = normalize(query)

    const filtered = q
      ? entries.filter(entry => normalize(entry.name).includes(q) || normalize(entry.description).includes(q))
      : entries

    const map = new Map<string, CommandEntry[]>()

    for (const entry of filtered) {
      const bucket = map.get(entry.group) ?? []

      bucket.push(entry)
      map.set(entry.group, bucket)
    }

    return [...map.entries()]
  }, [entries, query])

  return (
    <PageSearchShell onSearchChange={setQuery} searchPlaceholder="搜索命令…" searchValue={query}>
      {loading ? (
        <PageLoader />
      ) : error ? (
        <div className="grid h-full place-items-center px-6 text-center text-sm text-destructive">{error}</div>
      ) : (
        <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto px-4 py-4">
          <header className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
              <Terminal className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-(--ui-text-primary)">CLI 工具</h1>
              <p className="text-xs text-muted-foreground">在输入框以「/」开头即可运行这些命令。</p>
            </div>
          </header>

          {groups.length === 0 ? (
            <div className="grid min-h-40 place-items-center rounded-2xl border border-(--ui-stroke-tertiary) text-sm text-muted-foreground">
              没有匹配的命令
            </div>
          ) : (
            groups.map(([group, items]) => (
              <section
                className="space-y-1.5 rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary)/25 p-4"
                key={group}
              >
                <h2 className="text-xs font-semibold text-(--ui-text-tertiary) uppercase">{group}</h2>
                <div className="-mx-1 space-y-0.5">
                  {items.map(command => (
                    <div
                      className="flex items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-(--chrome-action-hover)"
                      key={`${group}:${command.name}`}
                    >
                      <code className="shrink-0 rounded-md bg-(--ui-bg-quaternary)/60 px-1.5 py-0.5 text-xs font-medium text-primary">
                        {slashName(command.name)}
                      </code>
                      <span className="min-w-0 flex-1 text-xs text-(--ui-text-secondary)">{command.description}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}
    </PageSearchShell>
  )
}
