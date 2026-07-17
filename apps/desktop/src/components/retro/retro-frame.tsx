import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Codicon } from '@/components/ui/codicon'
import { $projects, enterProject } from '@/store/projects'
import { $retroMode } from '@/store/retro-mode'
import { $sessions } from '@/store/session'
import { isSecondaryWindow } from '@/store/windows'

import {
  AGENTS_ROUTE,
  CRON_ROUTE,
  EXPERTS_ROUTE,
  MESSAGING_ROUTE,
  NEW_CHAT_ROUTE,
  sessionRoute,
  SKILLS_ROUTE
} from '../../app/routes'

// ── XP "Luna" gradients (inline so they don't depend on theme tokens) ──────────
const RAIL_BG = 'linear-gradient(180deg,#EAF3FF 0%,#D3E6FF 55%,#C3DBFF 100%)'
const RAIL_HEADER_BG = 'linear-gradient(180deg,#3A93FF 0%,#1E6FE0 100%)'
const TASKBAR_BG = 'linear-gradient(180deg,#3A93FF 0%,#1E6FE0 8%,#1A5FC6 55%,#124EA8 100%)'
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
  { icon: 'organization', label: '智能体', title: '智能体', to: AGENTS_ROUTE },
  { icon: 'hubot', label: '专家', title: '专家广场', to: EXPERTS_ROUTE }
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

function TreeRow({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[0.75rem] text-[#123] hover:bg-white/70"
      onClick={onClick}
      title={label}
      type="button"
    >
      <Codicon className="shrink-0 text-[0.875rem] text-[#1E6FE0]" name={icon} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function GroupLabel({ text }: { text: string }) {
  return <div className="mb-0.5 mt-2 px-1 text-[0.6875rem] font-semibold text-[#1B3B66]">{text}</div>
}

// The right rail is a real 项目区: live projects + recent sessions, styled as an
// XP tree. Clicking a project scopes new work to it; clicking a session resumes
// it (same as the left sidebar's onResumeSession → navigate(sessionRoute)).
function ProjectsRail() {
  const navigate = useNavigate()
  const projects = useStore($projects)
  const sessions = useStore($sessions)

  const activeProjects = useMemo(() => projects.filter(p => !p.archived), [projects])

  const recentSessions = useMemo(
    () => [...sessions].sort((a, b) => (b.started_at || 0) - (a.started_at || 0)).slice(0, 16),
    [sessions]
  )

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
        <Codicon className="text-[0.9375rem]" name="folder-library" />
        项目区
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <GroupLabel text={`项目 (${activeProjects.length})`} />
        {activeProjects.length === 0 ? (
          <div className="px-1.5 py-1 text-[0.6875rem] text-[#5B7391]">暂无项目</div>
        ) : (
          activeProjects.map(project => (
            <TreeRow
              icon="folder"
              key={project.id}
              label={project.name}
              onClick={() => {
                enterProject(project.id)
                navigate(NEW_CHAT_ROUTE)
              }}
            />
          ))
        )}

        <GroupLabel text="最近会话" />
        {recentSessions.length === 0 ? (
          <div className="px-1.5 py-1 text-[0.6875rem] text-[#5B7391]">暂无会话</div>
        ) : (
          recentSessions.map(session => (
            <TreeRow
              icon="comment"
              key={session.id}
              label={session.title?.trim() || session.preview?.trim() || '未命名会话'}
              onClick={() => navigate(sessionRoute(session.id))}
            />
          ))
        )}
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

// Retro shell decorations. Renders only in 怀旧模式 and never in compact
// secondary windows (pop-outs). The title/toolbar/rail/taskbar footprint is
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
      <ProjectsRail />
      <Taskbar />
    </>
  )
}
