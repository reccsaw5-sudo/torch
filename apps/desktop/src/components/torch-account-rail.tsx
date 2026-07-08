import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { BILLING_ROUTE } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { LogOut, Plus, Zap } from '@/lib/icons'
import { $torchLogin, logoutTorch, refreshTorchCredits } from '@/store/torch-login'

import { TorchProfileDialog } from './torch-profile-dialog'

// Sidebar footer account block: who's logged in, their credit balance, a
// recharge entry, and logout. Renders nothing when logged out (the login gate
// owns that state).
export function TorchAccountRail() {
  const { session } = useStore($torchLogin)
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)

  // Pull fresh credits/username when the rail mounts for a session.
  useEffect(() => {
    if (session) {
      void refreshTorchCredits()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.apiKey])

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
            <div className="flex items-center gap-1 text-[0.6875rem] leading-tight text-muted-foreground">
              <Zap className="size-3 text-primary" /> 积分 {session.credits}
            </div>
          </div>
        </button>
        <Button onClick={() => navigate(BILLING_ROUTE)} size="xs">
          <Plus /> 充值
        </Button>
        <Button aria-label="退出登录" onClick={onLogout} size="icon-xs" title="退出登录" variant="ghost">
          <LogOut />
        </Button>
      </div>
      <TorchProfileDialog onOpenChange={setProfileOpen} open={profileOpen} />
    </div>
  )
}
