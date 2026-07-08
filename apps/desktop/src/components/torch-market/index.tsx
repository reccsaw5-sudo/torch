import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { requestComposerInsert, requestComposerSubmit } from '@/app/chat/composer/focus'
import {
  $torchMarketOpen,
  $torchSkills,
  closeTorchMarket,
  fetchSkillContent,
  loadTorchSkills,
  type TorchSkill
} from '@/store/torch-market'

// Skill marketplace overlay: browse server-published skills, insert a usage
// prompt ("使用"), or have the agent create the skill locally ("安装").
export function TorchMarket() {
  const open = useStore($torchMarketOpen)
  const skills = useStore($torchSkills)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      void loadTorchSkills()
    }
  }, [open])

  if (!open) {
    return null
  }

  const use = (s: TorchSkill) => {
    requestComposerInsert(`请使用「${s.name}」技能：`, { mode: 'block', target: 'main' })
    closeTorchMarket()
  }

  const install = async (s: TorchSkill) => {
    setBusy(s.slug)
    try {
      const content = await fetchSkillContent(s.slug)
      requestComposerSubmit(
        `请为我安装一个名为 ${s.slug} 的技能（写入我的技能目录），技能内容如下：\n\n${content}`,
        { target: 'main' }
      )
      closeTorchMarket()
    } catch {
      // Swallow — the market stays open so the user can retry.
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/40 p-6"
      onClick={closeTorchMarket}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">技能市场</h2>
            <p className="text-xs text-muted-foreground">浏览并添加官方技能</p>
          </div>
          <button
            className="rounded-md px-2 py-1 text-sm text-muted-foreground transition hover:bg-accent/50 hover:text-foreground"
            onClick={closeTorchMarket}
            type="button"
          >
            关闭
          </button>
        </div>

        <div className="grid gap-2 overflow-y-auto p-4">
          {skills.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">暂无技能</p>}
          {skills.map(s => (
            <div className="flex items-center gap-3 rounded-xl border border-border p-3" key={s.id}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
                  {s.category && (
                    <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted-foreground">
                      {s.category}
                    </span>
                  )}
                </div>
                {s.description && <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.description}</div>}
              </div>
              <button
                className="shrink-0 rounded-md border border-border px-3 py-1 text-xs text-foreground transition hover:bg-accent/50"
                onClick={() => use(s)}
                type="button"
              >
                使用
              </button>
              <button
                className="shrink-0 rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background transition disabled:opacity-60"
                disabled={busy === s.slug}
                onClick={() => void install(s)}
                type="button"
              >
                {busy === s.slug ? '安装中…' : '安装'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
