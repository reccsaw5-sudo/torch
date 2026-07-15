import { useStore } from '@nanostores/react'
import type * as React from 'react'

import { writeSessionDrag } from '@/app/chat/composer/inline-refs'
import { PlatformAvatar } from '@/app/messaging/platform-icon'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import type { SessionInfo } from '@/hermes'
import { type Translations, useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { triggerHaptic } from '@/lib/haptics'
import { handoffOriginSource, sessionSourceLabel } from '@/lib/session-source'
import { coarseElapsed } from '@/lib/time'
import { cn } from '@/lib/utils'
import { $attentionSessionIds } from '@/store/session'
import { canOpenSessionWindow, openSessionInNewWindow } from '@/store/windows'

import { SidebarRowBody, SidebarRowGrab, SidebarRowLabel, SidebarRowShell } from './chrome'
import { SessionActionsMenu, SessionContextMenu } from './session-actions-menu'

interface SidebarSessionRowProps extends React.ComponentProps<'div'> {
  session: SessionInfo
  /** TUI-style tree stem for branched sessions (`└─ ` / `├─ `). */
  branchStem?: string
  isPinned: boolean
  isSelected: boolean
  isWorking: boolean
  onArchive: () => void
  onBranch?: () => void
  onDelete: () => void
  onPin: () => void
  onResume: () => void
  reorderable?: boolean
  dragging?: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
}

const AGE_KEY = { day: 'ageDay', hour: 'ageHour', minute: 'ageMin' } as const

function formatAge(seconds: number, r: Translations['sidebar']['row']): string {
  const { unit, value } = coarseElapsed(Date.now() - seconds * 1000)

  // Under a minute reads as "now" — the sidebar never shows a seconds tick.
  return unit === 'second' ? r.ageNow : `${value}${r[AGE_KEY[unit]]}`
}

export function SidebarSessionRow({
  session,
  branchStem,
  isPinned,
  isSelected,
  isWorking,
  onArchive,
  onBranch,
  onDelete,
  onPin,
  onResume,
  reorderable = false,
  dragging = false,
  dragHandleProps,
  className,
  style,
  ref,
  ...rest
}: SidebarSessionRowProps) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const title = sessionTitle(session)
  const age = formatAge(session.last_active || session.started_at, r)
  const handleLabel = `Reorder ${title}`
  // QQ/Codex-style second line: the last message snippet from the backend.
  const secondary = session.preview?.trim() || ''
  // Subscribe per-row (the leaf) instead of drilling a set through the list —
  // the atom is tiny and rarely non-empty. True when a clarify prompt in this
  // session is waiting on the user.
  const needsInput = useStore($attentionSessionIds).includes(session.id)

  return (
    <SessionContextMenu
      onArchive={onArchive}
      onBranch={onBranch}
      onDelete={onDelete}
      onPin={onPin}
      pinned={isPinned}
      profile={session.profile}
      sessionId={session.id}
      title={title}
    >
      <SidebarRowShell
        actions={
          <div className="relative z-2 grid w-[1.375rem] place-items-center">
            <SessionActionsMenu
              onArchive={onArchive}
              onBranch={onBranch}
              onDelete={onDelete}
              onPin={onPin}
              pinned={isPinned}
              profile={session.profile}
              sessionId={session.id}
              title={title}
            >
              <Button
                aria-label={r.actionsFor(title)}
                className="size-5 rounded-[4px] bg-transparent text-transparent transition-colors duration-100 hover:bg-(--ui-control-active-background) hover:text-foreground focus-visible:bg-(--ui-control-active-background) focus-visible:text-foreground focus-visible:ring-0 data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground group-hover:text-(--ui-text-tertiary) [&_svg]:size-3.5!"
                size="icon"
                title={r.sessionActions}
                variant="ghost"
              >
                <Codicon name="kebab-vertical" size="0.875rem" />
              </Button>
            </SessionActionsMenu>
          </div>
        }
        className={cn(
          'group row-hover relative min-h-[2.875rem]',
          isSelected && 'bg-primary/10',
          isWorking && 'text-foreground',
          // Opaque surface while lifted so the dragged row erases what's under
          // it (translucency let the rows below bleed through).
          dragging && 'z-10 cursor-grabbing bg-(--ui-sidebar-surface-background)',
          className
        )}
        data-working={isWorking ? 'true' : undefined}
        draggable
        onDragStart={event => {
          // Reorder drags belong to dnd-kit (the grab handle) — cancel the
          // native drag so the two DnD systems don't fight.
          if ((event.target as HTMLElement).closest('[data-reorder-handle]')) {
            event.preventDefault()

            return
          }

          writeSessionDrag(event.dataTransfer, {
            id: session.id,
            profile: session.profile || 'default',
            title
          })
        }}
        ref={ref}
        style={style}
        {...rest}
      >
        {isWorking && !needsInput && <span aria-hidden="true" className="arc-border" />}
        <SidebarRowBody
          className={cn('z-0 items-center gap-2.5 py-1.5 group-hover:pr-10', branchStem && 'pl-3')}
          onClick={event => {
            if (event.shiftKey) {
              event.preventDefault()
              event.stopPropagation()
              triggerHaptic('selection')
              onPin()

              return
            }

            // ⌘-click (mac) / ⌃-click (win/linux) pops the chat into its own
            // window — the universal "open in a new window" gesture. Archive
            // lives in the row's ⋯ and right-click menus. Falls through to a
            // normal resume when standalone windows aren't available (web embed).
            if ((event.metaKey || event.ctrlKey) && canOpenSessionWindow()) {
              event.preventDefault()
              event.stopPropagation()
              triggerHaptic('selection')
              void openSessionInNewWindow(session.id)

              return
            }

            onResume()
          }}
        >
          {reorderable ? (
            <SidebarRowGrab
              ariaLabel={handleLabel}
              className="size-7"
              dragging={dragging}
              dragHandleProps={dragHandleProps}
              leadClassName="overflow-visible"
            >
              <SessionAvatar
                className="transition-opacity group-hover/handle:opacity-0 group-focus-within/handle:opacity-0"
                isWorking={isWorking}
                needsInput={needsInput}
                session={session}
              />
            </SidebarRowGrab>
          ) : (
            <SessionAvatar isWorking={isWorking} needsInput={needsInput} session={session} />
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-baseline gap-2">
              <SidebarRowLabel className="flex-1 font-normal group-hover:text-foreground group-data-[working=true]:text-foreground/90">
                {title}
              </SidebarRowLabel>
              <span className="shrink-0 text-[0.625rem] leading-none text-(--ui-text-quaternary) tabular-nums">
                {age}
              </span>
            </span>
            {secondary ? (
              <span className="min-w-0 truncate text-[0.6875rem] leading-tight text-(--ui-text-tertiary)">
                {secondary}
              </span>
            ) : null}
          </span>
        </SidebarRowBody>
      </SidebarRowShell>
    </SessionContextMenu>
  )
}

// Deterministic hue from the session id so a conversation keeps the same
// avatar tint across reloads (FNV-1a, mod 360).
function sessionHue(seed: string): number {
  let hash = 2166136261

  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0) % 360
}

function sessionInitial(title: string): string {
  const trimmed = title.trim()

  if (!trimmed) {
    return '#'
  }

  return (Array.from(trimmed)[0] ?? '#').toUpperCase()
}

// QQ-style rounded avatar for a session row. Handed-off sessions show their
// origin platform glyph; everyone else gets a deterministic gradient identicon
// with the title's first letter. Working / needs-input surface as a corner
// badge (replacing the old lead dot).
function SessionAvatar({
  session,
  isWorking,
  needsInput,
  className
}: {
  session: SessionInfo
  isWorking: boolean
  needsInput: boolean
  className?: string
}) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const title = sessionTitle(session)
  const handoffSource = handoffOriginSource(session.handoff_state, session.handoff_platform)
  const handoffLabel = handoffSource ? (sessionSourceLabel(handoffSource) ?? handoffSource) : null
  const hue = sessionHue(session.id || title)

  const avatar = (
    <span
      className={cn(
        'relative grid size-7 shrink-0 select-none place-items-center rounded-lg text-[0.8125rem] font-semibold text-white',
        className
      )}
      style={
        handoffSource
          ? undefined
          : { backgroundImage: `linear-gradient(135deg, hsl(${hue} 58% 56%), hsl(${(hue + 26) % 360} 52% 45%))` }
      }
    >
      {handoffSource && handoffLabel ? (
        <PlatformAvatar
          className="size-full overflow-hidden rounded-lg text-[0.625rem] [&_svg]:size-3.5"
          platformId={handoffSource}
          platformName={handoffLabel}
        />
      ) : (
        sessionInitial(title)
      )}
      {needsInput || isWorking ? (
        <span
          aria-label={needsInput ? r.needsInput : r.sessionRunning}
          className={cn(
            'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-(--ui-sidebar-surface-background)',
            needsInput ? 'bg-amber-500' : 'bg-(--ui-accent)'
          )}
          role="status"
        />
      ) : null}
    </span>
  )

  if (handoffSource && handoffLabel) {
    return <Tip label={r.handoffOrigin(handoffLabel)}>{avatar}</Tip>
  }

  return avatar
}
