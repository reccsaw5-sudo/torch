import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { LogOut } from '@/lib/icons'
import { $torchLogin, logoutTorch } from '@/store/torch-login'

import { TorchProfileDialog } from './torch-profile-dialog'

// The logged-in Torch account: avatar + name + logout. Renders nothing when
// logged out (the login gate owns that state). Variants:
//   - 'top'       QQ-style header chip (avatar + name + logout, borderless)
//   - 'collapsed' avatar-only button for the slim icon rail
//   - 'full'      bordered card (avatar + name + email + logout)
export function TorchAccountRail({ variant = 'full' }: { variant?: 'collapsed' | 'full' | 'top' }) {
  const { session } = useStore($torchLogin)
  const [profileOpen, setProfileOpen] = useState(false)

  if (!session) {
    return null
  }

  const label = session.username || session.email || '账户'
  const initial = label.slice(0, 1).toUpperCase()

  function onLogout() {
    if (window.confirm('确定退出登录？')) {
      logoutTorch()
    }
  }

  if (variant === 'collapsed') {
    return (
      <>
        <button
          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 text-[0.8125rem] font-semibold text-primary transition-colors [-webkit-app-region:no-drag] hover:bg-primary/25"
          onClick={() => setProfileOpen(true)}
          title={label}
          type="button"
        >
          {initial}
        </button>
        <TorchProfileDialog onOpenChange={setProfileOpen} open={profileOpen} />
      </>
    )
  }

  if (variant === 'top') {
    return (
      <>
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 pr-1 text-left transition-colors [-webkit-app-region:no-drag] hover:bg-(--chrome-action-hover)"
          onClick={() => setProfileOpen(true)}
          title="查看个人资料"
          type="button"
        >
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-[0.75rem] font-semibold text-primary">
            {initial}
          </div>
          <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold text-(--ui-text-primary)">{label}</span>
        </button>
        <Button
          aria-label="退出登录"
          className="[-webkit-app-region:no-drag]"
          onClick={onLogout}
          size="icon-xs"
          title="退出登录"
          variant="ghost"
        >
          <LogOut />
        </Button>
        <TorchProfileDialog onOpenChange={setProfileOpen} open={profileOpen} />
      </>
    )
  }

  return (
    <div className="rounded-md border border-(--sidebar-edge-border) bg-(--ui-bg-quaternary)/40 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors hover:bg-(--chrome-action-hover)"
          onClick={() => setProfileOpen(true)}
          title="查看个人资料"
          type="button"
        >
          <div className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-[0.6875rem] font-semibold text-primary">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.8125rem] font-medium leading-tight text-(--ui-text-primary)">{label}</div>
            {session.email && (
              <div className="truncate text-[0.6875rem] leading-tight text-muted-foreground">{session.email}</div>
            )}
          </div>
        </button>
        <Button aria-label="退出登录" onClick={onLogout} size="icon-xs" title="退出登录" variant="ghost">
          <LogOut />
        </Button>
      </div>
      <TorchProfileDialog onOpenChange={setProfileOpen} open={profileOpen} />
    </div>
  )
}
