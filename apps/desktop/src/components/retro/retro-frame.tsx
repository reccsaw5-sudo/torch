import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Codicon } from '@/components/ui/codicon'
import { $retroMode } from '@/store/retro-mode'
import { isSecondaryWindow } from '@/store/windows'

import { AGENTS_ROUTE, CRON_ROUTE, MESSAGING_ROUTE, NEW_CHAT_ROUTE, SKILLS_ROUTE } from '../../app/routes'

// ── XP "Luna" gradients (inline so they don't depend on theme tokens) ──────────
const TITLEBAR_BG = 'linear-gradient(180deg,#3A93FF 0%,#1E6FE0 10%,#1A5FC6 60%,#124EA8 100%)'
const TOOLBAR_BG = 'linear-gradient(180deg,#FBFDFF 0%,#E4EEFB 45%,#CFE0F7 100%)'
const START_BG = 'linear-gradient(180deg,#7Bce5c 0%,#4FA83A 45%,#3E8E2E 100%)'

// Decorative XP title band across the top. Sits behind the real control
// clusters (z-70) and the rail (z-55), tinting the titlebar strip blue.
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

// Below-the-title XP toolbar row. Each button navigates to a real Torch view —
// no dead chrome. Labels keep the QQ-2007 flavor; `title` names the destination.
const TOOLBAR_ITEMS: { icon: string; label: string; title: string; to: string }[] = [
  { icon: 'add', label: '新建任务', title: '新对话', to: NEW_CHAT_ROUTE },
  { icon: 'checklist', label: '已安排', title: '定时任务', to: CRON_ROUTE },
  { icon: 'plug', label: '插件', title: 'MCP', to: `${SKILLS_ROUTE}?tab=mcp` },
  { icon: 'comment-discussion', label: '消息', title: '消息渠道', to: MESSAGING_ROUTE },
  { icon: 'organization', label: '智能体', title: '智能体', to: AGENTS_ROUTE }
]

function Toolbar() {
  const navigate = useNavigate()

  return (
    <div
      className="fixed inset-x-0 z-[44] flex h-[var(--retro-toolbar-height)] items-center gap-0.5 border-b border-[#9DB9E0] px-2 text-[#12325a] [-webkit-app-region:no-drag]"
      style={{ background: TOOLBAR_BG, top: 'var(--titlebar-height)' }}
    >
      {TOOLBAR_ITEMS.map(item => (
        <button
          className="flex items-center gap-1.5 rounded border border-transparent px-2 py-1 text-[0.75rem] font-medium hover:border-[#7FA8DE] hover:bg-white/70"
          key={item.label}
          onClick={() => navigate(item.to)}
          title={item.title}
          type="button"
        >
          <Codicon className="text-[0.9375rem] text-[#1E6FE0]" name={item.icon} />
          {item.label}
        </button>
      ))}
    </div>
  )
}

// XP taskbar ends. The bar itself is the app's own status bar (retro.css paints
// it Luna-blue and pads both ends); RetroFrame only overlays the Start button
// (left) and the tray + live clock (right) onto those reserved gaps, so the
// gateway / agent / scheduler / session / version status items sit in between —
// one fused bar instead of a status strip stacked above a separate taskbar.
function Taskbar() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000)

    return () => window.clearInterval(id)
  }, [])

  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', hour12: false, minute: '2-digit' })

  return (
    <>
      <button
        className="fixed bottom-0 left-0 z-[60] flex h-[var(--retro-taskbar-height)] items-center gap-1.5 rounded-r-xl pl-2.5 pr-4 text-[0.8125rem] font-bold italic text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)] [text-shadow:0_1px_1px_rgba(0,0,0,0.35)] [-webkit-app-region:no-drag]"
        style={{ background: START_BG }}
        type="button"
      >
        <span className="grid size-4 place-items-center rounded bg-white/30 font-mono text-[0.625rem] not-italic">
          {'>_'}
        </span>
        Torch
      </button>

      <div className="fixed bottom-0 right-0 z-[60] flex h-[var(--retro-taskbar-height)] items-center gap-2 border-l border-white/25 bg-[#1656B8] px-2.5 text-[0.75rem] text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.25)] [-webkit-app-region:no-drag]">
        <span aria-hidden className="text-[0.75rem]">🔊</span>
        <span aria-hidden className="text-[0.75rem]">📶</span>
        <span className="tabular-nums [text-shadow:0_1px_1px_rgba(0,0,0,0.3)]">{time}</span>
      </div>
    </>
  )
}

// Retro shell decorations. Renders only in 怀旧模式 and never in compact
// secondary windows (pop-outs). The title band + toolbar are fixed at the top
// (space reserved via retro.css padding on <main>); the bottom taskbar is the
// app's own status bar restyled by retro.css, with the Start button + clock
// overlaid here. The right-side project area is the app's own right-sidebar
// (未打开项目 / 文件树) — toggle it from the titlebar's panel button.
export function RetroFrame() {
  const retro = useStore($retroMode)

  if (!retro || isSecondaryWindow()) {
    return null
  }

  return (
    <>
      <TitleBar />
      <Toolbar />
      <Taskbar />
    </>
  )
}
