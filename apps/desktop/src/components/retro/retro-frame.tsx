import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { $retroMode } from '@/store/retro-mode'
import { isSecondaryWindow } from '@/store/windows'

// ── XP "Luna" gradients (inline so they don't depend on theme tokens) ──────────
const RAIL_BG = 'linear-gradient(180deg,#EAF3FF 0%,#D3E6FF 55%,#C3DBFF 100%)'
const RAIL_HEADER_BG = 'linear-gradient(180deg,#3A93FF 0%,#1E6FE0 100%)'
const TASKBAR_BG = 'linear-gradient(180deg,#3A93FF 0%,#1E6FE0 8%,#1A5FC6 55%,#124EA8 100%)'
const TITLEBAR_BG = 'linear-gradient(180deg,#3A93FF 0%,#1E6FE0 10%,#1A5FC6 60%,#124EA8 100%)'
const TOOLBAR_BG = 'linear-gradient(180deg,#FBFDFF 0%,#E4EEFB 45%,#CFE0F7 100%)'
const START_BG = 'linear-gradient(180deg,#7Bce5c 0%,#4FA83A 45%,#3E8E2E 100%)'
const MASCOT_BG = 'linear-gradient(160deg,#5AA6FF 0%,#2A6FD6 60%,#1C56B0 100%)'

// Below-the-title XP toolbar row, mirroring the reference (新建任务 / 已安排 /
// 插件 / 站点 / 拉取请求 / 聊天). Reserved by --retro-toolbar-height (retro.css).
const TOOLBAR_ITEMS = [
  { icon: 'add', label: '新建任务' },
  { icon: 'checklist', label: '已安排' },
  { icon: 'plug', label: '插件' },
  { icon: 'globe', label: '站点' },
  { icon: 'git-pull-request', label: '拉取请求' },
  { icon: 'comment-discussion', label: '聊天' }
] as const

function Toolbar() {
  return (
    <div
      className="fixed inset-x-0 z-[44] flex h-[var(--retro-toolbar-height)] items-center gap-0.5 border-b border-[#9DB9E0] px-2 text-[#12325a] [-webkit-app-region:no-drag]"
      style={{ background: TOOLBAR_BG, top: 'var(--titlebar-height)' }}
    >
      {TOOLBAR_ITEMS.map(item => (
        <button
          className="flex items-center gap-1.5 rounded border border-transparent px-2 py-1 text-[0.75rem] font-medium hover:border-[#7FA8DE] hover:bg-white/70"
          key={item.label}
          type="button"
        >
          <Codicon className="text-[0.9375rem] text-[#1E6FE0]" name={item.icon} />
          {item.label}
        </button>
      ))}
    </div>
  )
}

// Decorative XP title band across the top. Sits behind the real control
// clusters (z-70) and the buddy rail (z-55), tinting the titlebar strip blue.
// Draggable like the native titlebar; the no-drag control clusters win hit-test.
function TitleBar() {
  return (
    <div
      className="fixed inset-x-0 top-0 z-[45] flex h-[var(--titlebar-height)] items-center justify-center gap-1.5 border-b border-[#0A3A8A] text-white [-webkit-app-region:drag]"
      style={{ background: TITLEBAR_BG }}
    >
      <span className="grid size-4 place-items-center rounded bg-white/25 font-mono text-[0.625rem]">{'>_'}</span>
      <span className="text-[0.8125rem] font-semibold [text-shadow:0_1px_1px_rgba(0,0,0,0.35)]">
        Torch · 智能工作台
      </span>
    </div>
  )
}

function Mascot() {
  return (
    <div
      className="grid size-16 shrink-0 place-items-center rounded-2xl text-white shadow-[inset_0_1px_2px_rgba(255,255,255,0.5),0_2px_4px_rgba(0,0,0,0.25)]"
      style={{ background: MASCOT_BG }}
    >
      <span className="font-mono text-lg font-bold tracking-tight [text-shadow:0_1px_1px_rgba(0,0,0,0.35)]">
        {'>_'}
      </span>
    </div>
  )
}

function Buddy({ name, initial, online }: { name: string; initial: string; online?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-white/60">
      <div className="relative">
        <div className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-[#5AA6FF] to-[#2A6FD6] text-[0.625rem] font-semibold text-white">
          {initial}
        </div>
        <span
          className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-white ${online ? 'bg-emerald-500' : 'bg-slate-400'}`}
        />
      </div>
      <span className="truncate text-[0.75rem] text-[#123]">{name}</span>
    </div>
  )
}

// The QQ-2007 buddy rail: a decorative right column (mascot 小蓝 + friend list)
// that gives 怀旧模式 its signature IM look. Purely visual — no live data.
function BuddyRail() {
  return (
    <aside
      className="fixed right-0 z-[55] flex w-[var(--retro-rail-width)] flex-col overflow-hidden border-l border-[#7FA8DE] text-[#123]"
      style={{
        background: RAIL_BG,
        bottom: 'var(--retro-taskbar-height)',
        top: 'calc(var(--titlebar-height) + var(--retro-toolbar-height))'
      }}
    >
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[0.8125rem] font-semibold text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.3)]"
        style={{ background: RAIL_HEADER_BG }}
      >
        <span className="grid size-4 place-items-center rounded bg-white/25 font-mono text-[0.625rem]">{'>_'}</span>
        Codex 好友
      </div>

      <div className="flex flex-col items-center gap-2 border-b border-[#A9C3E8] bg-white/50 px-3 py-4">
        <Mascot />
        <div className="flex items-center gap-1.5">
          <span className="text-[0.8125rem] font-bold text-[#1B3B66]">Codex 小蓝</span>
          <span className="rounded bg-[#FF8A00] px-1 text-[0.5625rem] font-bold text-white">LV.07</span>
        </div>
        <div className="rounded-md border border-[#A9C3E8] bg-white px-2.5 py-1.5 text-[0.6875rem] leading-relaxed text-[#345]">
          代码有问题?找我!我是你的智能伙伴 Codex，陪你写代码、改 Bug、查文档，超可靠哒~
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-1 px-1 text-[0.6875rem] font-semibold text-[#1B3B66]">我的好友 (2/8)</div>
        <Buddy initial="蓝" name="Codex 小蓝" online />
        <Buddy initial="R" name="Randy Lu" online />
        <Buddy initial="T" name="Torch 团队" />
      </div>
    </aside>
  )
}

// XP-style taskbar pinned to the bottom edge: start button, active task, tray +
// live clock. Reserves its own height via --retro-taskbar-height (retro.css).
function Taskbar() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000)

    return () => window.clearInterval(id)
  }, [])

  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', hour12: false, minute: '2-digit' })

  return (
    <footer
      className="fixed inset-x-0 bottom-0 z-[60] flex h-[var(--retro-taskbar-height)] items-stretch gap-1 pr-1 text-white [-webkit-app-region:no-drag]"
      style={{ background: TASKBAR_BG }}
    >
      <button
        className="flex items-center gap-1.5 rounded-r-xl pl-2.5 pr-4 text-[0.8125rem] font-bold italic text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)] [text-shadow:0_1px_1px_rgba(0,0,0,0.35)]"
        style={{ background: START_BG }}
        type="button"
      >
        <span className="grid size-4 place-items-center rounded bg-white/30 font-mono text-[0.625rem] not-italic">
          {'>_'}
        </span>
        Torch
      </button>

      <div className="flex flex-1 items-center overflow-hidden py-1">
        <div className="flex h-full max-w-56 items-center gap-1.5 rounded border border-white/25 bg-white/15 px-2 text-[0.75rem] shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)]">
          <span className="grid size-3.5 place-items-center rounded-sm bg-white/25 font-mono text-[0.5rem]">{'>_'}</span>
          <span className="truncate">Torch 工作台</span>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded border border-white/25 bg-[#1656B8] px-2.5 text-[0.75rem] shadow-[inset_0_1px_1px_rgba(255,255,255,0.25)]">
        <span aria-hidden className="text-[0.75rem]">🔊</span>
        <span aria-hidden className="text-[0.75rem]">📶</span>
        <span className="tabular-nums [text-shadow:0_1px_1px_rgba(0,0,0,0.3)]">{time}</span>
      </div>
    </footer>
  )
}

// Retro shell decorations (buddy rail + taskbar). Renders only in 怀旧模式 and
// never in compact secondary windows (pop-outs). The rail/taskbar footprint is
// reserved by retro.css padding on <main>, so they don't cover chat content.
export function RetroFrame() {
  const retro = useStore($retroMode)

  if (!retro || isSecondaryWindow()) {
    return null
  }

  return (
    <>
      <TitleBar />
      <Toolbar />
      <BuddyRail />
      <Taskbar />
    </>
  )
}
